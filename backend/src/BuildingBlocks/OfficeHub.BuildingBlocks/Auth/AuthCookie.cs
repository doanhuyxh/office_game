using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Http;

namespace OfficeHub.BuildingBlocks.Auth;

/// <summary>
/// Cookie đăng nhập dùng chung giữa OfficeHub.Api (cấp cookie) và OfficeHub.Realtime (đọc cookie).
/// Hai service phải dùng chung: tên scheme, tên cookie và thư mục khoá DataProtection.
/// </summary>
public static class AuthCookie
{
    /// <summary>Trùng với IdentityConstants.ApplicationScheme để Realtime giải mã được cookie do Identity cấp.</summary>
    public const string Scheme = "Identity.Application";
    public const string CookieName = "officehub.auth";

    public static void Configure(CookieAuthenticationOptions o)
    {
        o.Cookie.Name = CookieName;
        o.Cookie.HttpOnly = true;
        o.Cookie.SameSite = SameSiteMode.Lax;
        o.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
        o.ExpireTimeSpan = TimeSpan.FromDays(7);
        o.SlidingExpiration = true;
        // API trả 401/403 thay vì redirect sang trang login.
        o.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = StatusCodes.Status401Unauthorized; return Task.CompletedTask; };
        o.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = StatusCodes.Status403Forbidden; return Task.CompletedTask; };
    }
}

public static class Roles
{
    public const string Admin = "admin";
    public const string Hr = "hr";
    public const string Manager = "manager";
    public const string Employee = "employee";
    public static readonly string[] All = [Admin, Hr, Manager, Employee];
}

public static class ClaimNames
{
    public const string FullName = "full_name";
    public const string MustChangePassword = "must_change_password";
}
