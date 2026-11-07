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
/// Xác thực <c>Authorization: Bearer ohk_…</c>. Mỗi request đọc lại token + user từ DB nên thu hồi token,
/// khoá tài khoản, đổi vai trò có hiệu lực ngay (giống cookie với ValidationInterval = 0).
/// Route ngoài <see cref="AccessTokenAuth.IsAllowed"/> → 403 dù token hợp lệ.
/// </summary>
public sealed class AccessTokenHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder,
    OfficeIdentityDbContext db, UserManager<AppUser> users, IUserClaimsPrincipalFactory<AppUser> principals, TimeProvider clock,
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
        var token = await db.AccessTokens.FirstOrDefaultAsync(t => t.TokenHash == hash, Context.RequestAborted);
        if (token is null || !token.IsUsable(now)) return AuthenticateResult.Fail("Token không hợp lệ, đã hết hạn hoặc đã bị thu hồi");

        OAuthGrant? grant = null;
        if (token.GrantId is { } gid)
        {
            grant = await db.OAuthGrants.FirstOrDefaultAsync(g => g.Id == gid, Context.RequestAborted);
            if (grant is null || grant.RevokedAt is not null) return AuthenticateResult.Fail("Ứng dụng đã bị thu hồi quyền truy cập");
        }

        var user = await users.FindByIdAsync(token.UserId.ToString());
        if (user is not { IsActive: true }) return AuthenticateResult.Fail("Tài khoản đã bị khoá");
        if (user.MustChangePassword) return AuthenticateResult.Fail("Tài khoản cần đổi mật khẩu trên web trước");
        if (await users.IsLockedOutAsync(user)) return AuthenticateResult.Fail("Tài khoản đang tạm khoá");
        // Admin / HR chưa bật 2FA: token cũ ngừng hoạt động tới khi bật trên web (tạo token mới cũng bị chặn ở TwoFactorGate).
        if (!user.TwoFactorEnabled && TwoFactorPolicy.IsRequiredFor(await users.GetRolesAsync(user)))
            return AuthenticateResult.Fail(TwoFactorPolicy.TokenBlockedMessage);

        // Từ đây biết chắc ai gọi → audit ghi được cả lần bị chặn route.
        Context.Items[AccessTokenAuth.CallerItemKey] = new AccessTokenCaller(user.Id, token.Id, token.Name, token.GrantId is not null);

        if (!AccessTokenAuth.IsAllowed(Request.Method, Request.Path.Value))
        {
            Context.Items[ForbiddenRouteKey] = true;
            return AuthenticateResult.Fail("Token AI không được dùng cho chức năng này");
        }

        if (token.LastUsedAt is null || now - token.LastUsedAt > TouchInterval)
        {
            token.LastUsedAt = now;
            if (grant is not null) grant.LastUsedAt = now;
            await db.SaveChangesAsync(Context.RequestAborted);
        }

        var basePrincipal = await principals.CreateAsync(user);
        var identity = new ClaimsIdentity(basePrincipal.Claims, AccessTokenAuth.Scheme, ClaimTypes.Name, ClaimTypes.Role);
        identity.AddClaim(new Claim(AccessTokenAuth.TokenIdClaim, token.Id.ToString()));
        return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), AccessTokenAuth.Scheme));
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
