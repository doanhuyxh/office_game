using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Routing;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.Modules.Identity.Domain;
using OfficeHub.Modules.Identity.Infrastructure;

namespace OfficeHub.Modules.Identity.Features.Auth;

public sealed record LoginRequest([Required] string Login, [Required] string Password, bool RememberMe = true);
public sealed record ChangePasswordRequest([Required] string CurrentPassword, [Required] string NewPassword);
/// <summary>
/// Avatar = ngoại hình nhân vật 3D (JSON, xem AvatarRules); null = nhân vật mặc định. Realtime đọc trường này khi vào văn phòng.
/// MustSetupTwoFactor = admin / hr chưa bật xác thực 2 lớp → FE chuyển sang trang bật 2FA, API khác trả 403 (TwoFactorPolicy).
/// IsBot = tài khoản do bot vận hành (HR đánh dấu) — OfficeHub.Mcp dựa vào đây để hiện bot trong văn phòng 3D.
/// </summary>
public sealed record MeResponse(Guid Id, string UserName, string? Email, string FullName, string[] Roles, bool MustChangePassword,
    JsonElement? Avatar = null, bool TwoFactorEnabled = false, bool MustSetupTwoFactor = false, bool IsBot = false);

internal static class AuthEndpoints
{
    public static void Map(IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/auth").WithTags("Auth");

        g.MapPost("/login", LoginAsync).AllowAnonymous().RequireRateLimiting(Infrastructure.RateLimits.Auth);
        g.MapPost("/logout", LogoutAsync).RequireAuthorization();
        g.MapGet("/me", MeAsync).RequireAuthorization();
        g.MapPost("/change-password", ChangePasswordAsync).RequireAuthorization().RequireRateLimiting(Infrastructure.RateLimits.Auth);
    }

    /// <summary>
    /// Mọi lần đăng nhập thất bại (sai mật khẩu, không có tài khoản, tài khoản khoá / tạm khoá, bị <see cref="LoginThrottle"/> chặn) trả
    /// CÙNG một phản hồi → không dò được tài khoản nào tồn tại (TEST-20). Thông điệp nhắc khả năng bị tạm chặn để người thật hiểu.
    /// </summary>
    internal const string LoginFailedMessage = "Sai tài khoản hoặc mật khẩu. Sai nhiều lần liên tiếp sẽ bị tạm chặn 15 phút.";
    private static ProblemHttpResult LoginFailed() => TypedResults.Problem(LoginFailedMessage, statusCode: StatusCodes.Status401Unauthorized);

    /// <summary>Hash giả để tài khoản không tồn tại cũng tốn thời gian băm như tài khoản thật (không dò được bằng thời gian phản hồi).</summary>
    private static readonly Lazy<string> DummyHash = new(() => new PasswordHasher<AppUser>().HashPassword(new AppUser(), Guid.NewGuid().ToString()));

    /// <summary>Đăng nhập bằng email HOẶC tên đăng nhập (mã nhân viên).</summary>
    private static async Task<Results<Ok<MeResponse>, ProblemHttpResult>> LoginAsync(
        LoginRequest req, HttpContext ctx, UserManager<AppUser> users, SignInManager<AppUser> signIn, OfficeIdentityDbContext db,
        TimeProvider clock, LoginThrottle throttle)
    {
        var login = (req.Login ?? "").Trim();
        var user = login.Length == 0 ? null : await users.FindByNameAsync(login) ?? await users.FindByEmailAsync(login);
        // Đếm theo id tài khoản (đổi qua lại email / tên đăng nhập không nhân đôi lượt thử); không có tài khoản → theo chuỗi nhập.
        var account = user?.Id.ToString() ?? "?" + login.ToLowerInvariant();
        var ip = ctx.Connection.RemoteIpAddress?.ToString() ?? "?";
        if (throttle.IsBlocked(account, ip)) return LoginFailed();

        if (user is null || !user.IsActive)
        {
            users.PasswordHasher.VerifyHashedPassword(new AppUser(), DummyHash.Value, req.Password ?? "");
            throttle.Fail(account, ip);
            return LoginFailed();
        }

        // lockoutOnFailure: false — sai mật khẩu không khoá cả tài khoản (người khác cố tình khoá được); LoginThrottle chặn theo IP.
        // Tài khoản vẫn có thể bị khoá bởi lần sai mã 2FA / xác nhận tạo token → IsLockedOut trả cùng phản hồi.
        var result = await signIn.PasswordSignInAsync(user, req.Password ?? "", req.RememberMe, lockoutOnFailure: false);
        if (result.IsLockedOut) return LoginFailed();
        // Đã bật 2FA: Identity cấp cookie tạm officehub.2fa (5 phút) → FE gửi mã qua POST /auth/login/2fa. Chỉ tới đây khi ĐÚNG mật khẩu.
        if (result.RequiresTwoFactor)
        {
            throttle.Succeed(account, ip);
            return TypedResults.Problem("Cần mã xác thực 2 lớp", statusCode: StatusCodes.Status403Forbidden, title: "2fa_required");
        }
        if (!result.Succeeded)
        {
            throttle.Fail(account, ip);
            return LoginFailed();
        }
        throttle.Succeed(account, ip);

        // Mỗi lúc chỉ 1 thiết bị: đổi security stamp → cookie ở thiết bị khác (nếu có) bị từ chối ở request kế tiếp
        // (giống cơ chế khoá tài khoản / đổi mật khẩu); cấp lại cookie cho CHÍNH thiết bị này theo stamp mới.
        // KHÔNG dùng RefreshSignInAsync: nó chỉ cấp lại khi request đã có cookie đăng nhập — request /login thì chưa có, nên cookie
        // vừa cấp (stamp cũ) bị chính lệnh đổi stamp vô hiệu → 401 ngay request sau. Đăng nhập lại: phản hồi có 2 Set-Cookie
        // officehub.auth, trình duyệt giữ cái sau (stamp mới).
        await users.UpdateSecurityStampAsync(user);
        await signIn.SignInAsync(user, req.RememberMe);

        user.LastLoginAt = clock.GetUtcNow();
        await users.UpdateAsync(user);
        return TypedResults.Ok(await ToMe(user, users, db));
    }

    /// <summary>
    /// Đổi security stamp TRƯỚC khi xoá cookie: bản sao cookie (bị chép / còn trong máy khác) cũng hết hiệu lực ở request kế tiếp
    /// (ValidationInterval = 0). Token AI không bị ảnh hưởng — đăng xuất web không ngắt trợ lý AI đã kết nối.
    /// </summary>
    private static async Task<NoContent> LogoutAsync(HttpContext ctx, UserManager<AppUser> users, SignInManager<AppUser> signIn)
    {
        if (!ctx.User.IsAccessToken() && await users.GetUserAsync(ctx.User) is { } user) await users.UpdateSecurityStampAsync(user);
        await signIn.SignOutAsync();
        return TypedResults.NoContent();
    }

    private static async Task<Results<Ok<MeResponse>, UnauthorizedHttpResult>> MeAsync(HttpContext ctx, UserManager<AppUser> users,
        OfficeIdentityDbContext db)
    {
        var user = await users.GetUserAsync(ctx.User);
        return user is { IsActive: true } ? TypedResults.Ok(await ToMe(user, users, db)) : TypedResults.Unauthorized();
    }

    private static async Task<Results<NoContent, ValidationProblem, UnauthorizedHttpResult>> ChangePasswordAsync(
        ChangePasswordRequest req, HttpContext ctx, UserManager<AppUser> users, SignInManager<AppUser> signIn, OfficeIdentityDbContext db,
        TimeProvider clock, CancellationToken ct)
    {
        var user = await users.GetUserAsync(ctx.User);
        if (user is null) return TypedResults.Unauthorized();
        // Thiếu trường → 400 (UserManager ném ArgumentNullException → 500 nếu để lọt)
        var missing = new Dictionary<string, string[]>();
        if (string.IsNullOrEmpty(req.CurrentPassword)) missing["currentPassword"] = ["Nhập mật khẩu hiện tại"];
        if (string.IsNullOrEmpty(req.NewPassword)) missing["newPassword"] = ["Nhập mật khẩu mới"];
        if (missing.Count > 0) return TypedResults.ValidationProblem(missing);

        if (await users.IsLockedOutAsync(user))
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["currentPassword"] = ["Tạm khoá do nhập sai nhiều lần, thử lại sau 15 phút"] });
        var result = await users.ChangePasswordAsync(user, req.CurrentPassword, req.NewPassword);
        // Sai mật khẩu hiện tại → tính vào khoá tài khoản (phiên bị chiếm không dò được mật khẩu thật bằng endpoint này).
        if (!result.Succeeded && result.Errors.Any(e => e.Code == "PasswordMismatch")) await users.AccessFailedAsync(user);
        if (!result.Succeeded)
            return TypedResults.ValidationProblem(result.Errors.GroupBy(e => e.Code).ToDictionary(g => g.Key, g => g.Select(e => e.Description).ToArray()));

        user.MustChangePassword = false;
        await users.UpdateAsync(user);
        // ChangePasswordAsync đã đổi security stamp (phiên ở nơi khác hết hiệu lực); token AI / ứng dụng OAuth thu hồi riêng.
        await AiAccessRevoker.RevokeAllAsync(db, user.Id, clock.GetUtcNow(), ct);
        await signIn.RefreshSignInAsync(user); // cấp lại cookie không còn cờ must_change_password
        return TypedResults.NoContent();
    }

    internal static async Task<MeResponse> ToMe(AppUser u, UserManager<AppUser> users, OfficeIdentityDbContext db)
    {
        var look = await db.UserAvatars.AsNoTracking().Where(a => a.UserId == u.Id).Select(a => a.Look).FirstOrDefaultAsync();
        var roles = await users.GetRolesAsync(u);
        return new(u.Id, u.UserName!, u.Email, u.FullName, [.. roles], u.MustChangePassword,
            look is null ? null : JsonDocument.Parse(look).RootElement.Clone(),
            u.TwoFactorEnabled, !u.TwoFactorEnabled && TwoFactorPolicy.IsRequiredFor(roles), u.IsBot);
    }
}
