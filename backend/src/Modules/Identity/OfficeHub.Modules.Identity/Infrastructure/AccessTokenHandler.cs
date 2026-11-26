using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.Modules.Identity.Domain;

namespace OfficeHub.Modules.Identity.Infrastructure;

public static class AccessTokens
{
    /// <summary>ohk_ + 32 byte ngẫu nhiên (base64url) ≈ 47 ký tự.</summary>
    public static string Generate() =>
        AccessTokenAuth.TokenPrefix + Base64Url(RandomNumberGenerator.GetBytes(32));

    public static string Hash(string token) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    public static string DisplayPrefix(string token) => token[..Math.Min(token.Length, AccessTokenAuth.TokenPrefix.Length + 4)];

    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}

/// <summary>
/// Xác thực <c>Authorization: Bearer ohk_…</c>. Token + tài khoản đọc qua <see cref="AuthCache"/> (TEST-244): mọi chỗ thu hồi token,
/// khoá tài khoản, đổi vai trò, cấp mật khẩu tạm… xoá cache ngay khi ghi DB nên vẫn có hiệu lực ở request kế tiếp.
/// Công tắc "Kết nối AI" toàn công ty đọc <see cref="IOptionsMonitor{T}"/> mỗi request (không cache).
/// Route ngoài <see cref="AccessTokenAuth.IsAllowed"/> → 403 dù token hợp lệ.
/// </summary>
public sealed class AccessTokenHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder,
    OfficeIdentityDbContext db, AuthCache cache, AuthCacheInvalidator invalidator, TimeProvider clock,
    IOptionsMonitor<AccessTokenSettings> settings)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    /// <summary>Ghi LastUsedAt tối đa mỗi 5 phút để không UPDATE ở mọi request.</summary>
    private static readonly TimeSpan TouchInterval = TimeSpan.FromMinutes(5);
    private const string ForbiddenRouteKey = "officehub.access_token.forbidden_route";

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var header = Request.Headers.Authorization.ToString();
        if (!AccessTokenAuth.HasBearerToken(header)) return AuthenticateResult.NoResult();
        if (!settings.CurrentValue.Enabled) return AuthenticateResult.Fail("Kết nối AI đang tạm tắt cho toàn công ty");
        var raw = header["Bearer ".Length..].Trim();

        var hash = AccessTokens.Hash(raw);
        var now = clock.GetUtcNow();
        var ct = Context.RequestAborted;
        var token = await cache.GetTokenAsync(hash, ct);
        if (token is null || !token.IsUsable(now)) return AuthenticateResult.Fail("Token không hợp lệ, đã hết hạn hoặc đã bị thu hồi");
        if (token.GrantRevoked) return AuthenticateResult.Fail("Ứng dụng đã bị thu hồi quyền truy cập");

        var user = await cache.GetUserAsync(token.UserId, ct);
        if (user is not { IsActive: true }) return AuthenticateResult.Fail("Tài khoản đã bị khoá");
        if (user.MustChangePassword) return AuthenticateResult.Fail("Tài khoản cần đổi mật khẩu trên web trước");
        if (user.IsLockedOut(now)) return AuthenticateResult.Fail("Tài khoản đang tạm khoá");
        // Admin / HR chưa bật 2FA: token cũ ngừng hoạt động tới khi bật trên web (tạo token mới cũng bị chặn ở TwoFactorGate).
        if (!user.TwoFactorEnabled && TwoFactorPolicy.IsRequiredFor(user.Roles))
            return AuthenticateResult.Fail(TwoFactorPolicy.TokenBlockedMessage);

        // Từ đây biết chắc ai gọi → audit ghi được cả lần bị chặn route.
        Context.Items[AccessTokenAuth.CallerItemKey] = new AccessTokenCaller(user.UserId, token.TokenId, token.Name, token.GrantId is not null);

        if (!AccessTokenAuth.IsAllowed(Request.Method, Request.Path.Value))
        {
            Context.Items[ForbiddenRouteKey] = true;
            return AuthenticateResult.Fail("Token AI không được dùng cho chức năng này");
        }

        if (token.LastUsedAt is null || now - token.LastUsedAt > TouchInterval)
        {
            await db.AccessTokens.Where(t => t.Id == token.TokenId).ExecuteUpdateAsync(s => s.SetProperty(t => t.LastUsedAt, now), ct);
            if (token.GrantId is { } gid)
                await db.OAuthGrants.Where(g => g.Id == gid).ExecuteUpdateAsync(s => s.SetProperty(g => g.LastUsedAt, now), ct);
            // Đọc lại ảnh chụp ở request sau để có LastUsedAt mới (không tự ghi đè: có thể vừa bị thu hồi song song).
            await invalidator.RemoveKeyAsync(AuthCacheTags.TokenKey(hash));
        }

        var claims = user.ToIdentity(AccessTokenAuth.Scheme, ClaimTypes.Name, ClaimTypes.Role);
        claims.AddClaim(new Claim(AccessTokenAuth.TokenIdClaim, token.TokenId.ToString()));
        return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(claims), AccessTokenAuth.Scheme));
    }

    protected override async Task HandleChallengeAsync(AuthenticationProperties properties)
    {
        var result = await HandleAuthenticateOnceSafeAsync();
        if (Context.Items.ContainsKey(ForbiddenRouteKey))
        {
            await WriteProblem(StatusCodes.Status403Forbidden, result.Failure?.Message ?? "Không có quyền");
            return;
        }
        Response.Headers.WWWAuthenticate = "Bearer";
        await WriteProblem(StatusCodes.Status401Unauthorized, result.Failure?.Message ?? "Thiếu token truy cập");
    }

    protected override Task HandleForbiddenAsync(AuthenticationProperties properties) =>
        WriteProblem(StatusCodes.Status403Forbidden, "Bạn không có quyền thực hiện thao tác này");

    private Task WriteProblem(int status, string detail)
    {
        Response.StatusCode = status;
        return Response.WriteAsJsonAsync(new { status, detail }, options: null, contentType: "application/problem+json");
    }
}
