using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using OfficeHub.BuildingBlocks.Configuration;

namespace OfficeHub.BuildingBlocks.Auth;

/// <summary>
/// Xác thực 2 lớp (TOTP) bắt buộc: admin / HR luôn bắt buộc (chủ dự án chốt 2026-11-07); admin mở rộng cho quản lý / mọi người ở
/// Hệ thống → Cấu hình → Bảo mật (<see cref="TwoFactorSettings"/>, TEST-258). Bot chỉ bắt buộc khi có vai trò admin / HR.
/// Tài khoản bắt buộc mà chưa bật 2FA vẫn đăng nhập được nhưng phiên mang claim <see cref="ClaimNames.MustSetupTwoFactor"/>
/// → mọi API (trừ <see cref="IsExempt"/>) trả 403 <see cref="SetupRequiredTitle"/> tới khi bật xong. Realtime hub từ chối kết nối.
/// Token AI của tài khoản này bị từ chối ở <c>AccessTokenHandler</c> (giống "cần đổi mật khẩu").
/// </summary>
public static class TwoFactorPolicy
{
    public const string SetupRequiredTitle = "2fa_setup_required";
    public const string SetupRequiredMessage = "Cần bật xác thực 2 lớp trước khi tiếp tục (bắt buộc với tài khoản của bạn)";
    public const string TokenBlockedMessage = "Tài khoản cần bật xác thực 2 lớp trên web trước khi dùng kết nối AI (bắt buộc với tài khoản của bạn)";
    public const string CannotDisableMessage = "Tài khoản của bạn bắt buộc dùng xác thực 2 lớp, không thể tắt. Đổi điện thoại: nhờ admin / HR đặt lại.";

    /// <summary>Vai trò luôn bắt buộc bật 2FA (mọi phạm vi, kể cả bot).</summary>
    public static readonly string[] AlwaysRequiredRoles = [Roles.Admin, Roles.Hr];

    /// <summary>Tài khoản có các vai trò này có bắt buộc bật 2FA theo chính sách hiện hành không.</summary>
    public static bool IsRequiredFor(IEnumerable<string> roles, bool isBot, TwoFactorSettings settings)
    {
        var list = roles as ICollection<string> ?? [.. roles];
        bool Has(string r) => list.Contains(r, StringComparer.OrdinalIgnoreCase);
        if (AlwaysRequiredRoles.Any(Has)) return true;
        if (isBot) return false;
        return settings.Scope switch
        {
            TwoFactorScopes.All => true,
            TwoFactorScopes.Managers => Has(Roles.Manager),
            _ => false,
        };
    }

    // Đúng các route cần để tự bật 2FA / thoát ra. Thêm route vào đây = cho phép dùng khi CHƯA bật 2FA.
    private static readonly string[] Exempt =
    [
        "/api/auth/me",
        "/api/auth/logout",
        "/api/auth/login",
        "/api/auth/login/2fa",
        "/api/auth/change-password",
        "/api/auth/forgot-password",
        "/api/auth/reset-password",
        "/api/auth/2fa/status",
        "/api/auth/2fa/setup",
        "/api/auth/2fa/enable",
    ];

    /// <summary>Path ngoài /api (health, SPA…) không bị chặn; trong /api chỉ khớp chính xác danh sách miễn.</summary>
    public static bool IsExempt(string? path)
    {
        if (string.IsNullOrEmpty(path)) return true;
        if (!path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase) && !path.Equals("/api", StringComparison.OrdinalIgnoreCase)) return true;
        var p = path.TrimEnd('/');
        return Exempt.Any(e => string.Equals(e, p, StringComparison.OrdinalIgnoreCase));
    }

    public static bool MustSetup(this System.Security.Claims.ClaimsPrincipal user) =>
        user.HasClaim(ClaimNames.MustSetupTwoFactor, "true");

    /// <summary>Đặt sau <c>UseAuthentication</c>: phiên bắt buộc 2FA mà chưa bật chỉ dùng được các route miễn.</summary>
    public static IApplicationBuilder UseTwoFactorEnrollmentGate(this IApplicationBuilder app) => app.Use(async (ctx, next) =>
    {
        if (ctx.User.Identity?.IsAuthenticated == true && ctx.User.MustSetup() && !IsExempt(ctx.Request.Path.Value))
        {
            await Results.Problem(SetupRequiredMessage, statusCode: StatusCodes.Status403Forbidden, title: SetupRequiredTitle).ExecuteAsync(ctx);
            return;
        }
        await next(ctx);
    });
}

/// <summary>
/// Mật khẩu tạm (HR cấp / tài khoản mới): cookie mang claim <see cref="ClaimNames.MustChangePassword"/> → mọi API trừ
/// <see cref="TwoFactorPolicy.IsExempt"/> trả 403 <see cref="RequiredTitle"/> tới khi đổi mật khẩu. Trước đây chỉ guard FE chặn,
/// gọi API thẳng bằng cookie mật khẩu tạm vẫn dùng được mọi chức năng. Token AI của tài khoản này đã bị chặn ở <c>AccessTokenHandler</c>.
/// </summary>
public static class PasswordChangePolicy
{
    public const string RequiredTitle = "password_change_required";
    public const string RequiredMessage = "Cần đổi mật khẩu tạm trước khi tiếp tục";

    public static bool MustChangePassword(this System.Security.Claims.ClaimsPrincipal user) =>
        user.HasClaim(ClaimNames.MustChangePassword, "true");

    /// <summary>Đặt sau <c>UseAuthentication</c>. Dùng chung danh sách route miễn với cổng 2FA (đổi mật khẩu, đăng xuất, me…).</summary>
    public static IApplicationBuilder UsePasswordChangeGate(this IApplicationBuilder app) => app.Use(async (ctx, next) =>
    {
        if (ctx.User.Identity?.IsAuthenticated == true && !ctx.User.IsAccessToken() && ctx.User.MustChangePassword()
            && !TwoFactorPolicy.IsExempt(ctx.Request.Path.Value))
        {
            await Results.Problem(RequiredMessage, statusCode: StatusCodes.Status403Forbidden, title: RequiredTitle).ExecuteAsync(ctx);
            return;
        }
        await next(ctx);
    });
}
