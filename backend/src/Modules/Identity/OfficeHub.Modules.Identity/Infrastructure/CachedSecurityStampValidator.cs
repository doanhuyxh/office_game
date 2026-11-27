using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.Modules.Identity.Domain;

namespace OfficeHub.Modules.Identity.Infrastructure;

/// <summary>
/// Thay <c>SecurityStampValidator</c> với <c>ValidationInterval = 0</c> (TEST-244): vẫn so security stamp trong cookie ở MỌI request,
/// nhưng stamp + claim dựng principal lấy từ <see cref="AuthCache"/> thay vì đọc users / user_claims / user_roles / roles / role_claims.
/// Stamp đổi (đăng xuất, đăng nhập thiết bị khác, đổi / cấp mật khẩu, 2FA, khoá tài khoản, đổi vai trò) → cache đã bị xoá khi ghi DB
/// → request kế tiếp đọc stamp mới → cookie cũ bị từ chối ngay. Hành vi còn lại giữ như bản gốc: thay principal bằng claim mới nhất
/// (vai trò, họ tên, cờ mật khẩu tạm / chưa bật 2FA), gia hạn cookie, stamp sai → đăng xuất.
/// </summary>
public sealed class CachedSecurityStampValidator(
    AuthCache cache, SignInManager<AppUser> signIn, IOptions<IdentityOptions> identity, RuntimeConfig runtime, TimeProvider clock) : ISecurityStampValidator
{
    public async Task ValidateAsync(CookieValidatePrincipalContext context)
    {
        var o = identity.Value.ClaimsIdentity;
        var principal = context.Principal;
        var snapshot = Guid.TryParse(principal?.FindFirst(o.UserIdClaimType)?.Value, out var userId)
            ? await cache.GetUserAsync(userId, context.HttpContext.RequestAborted)
            : null;
        if (snapshot is null || snapshot.SecurityStamp != principal?.FindFirst(o.SecurityStampClaimType)?.Value)
        {
            context.RejectPrincipal();
            await signIn.SignOutAsync();
            await context.HttpContext.SignOutAsync(IdentityConstants.TwoFactorRememberMeScheme);
            return;
        }

        context.ReplacePrincipal(new(snapshot.ToIdentity(IdentityConstants.ApplicationScheme, o.UserNameClaimType, o.RoleClaimType, runtime.TwoFactor)));
        context.ShouldRenew = true;
        if (!context.Options.SlidingExpiration) context.Properties.IssuedUtc = clock.GetUtcNow();
    }
}
