using System.Security.Claims;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.Modules.Identity.Domain;

namespace OfficeHub.Modules.Identity.Infrastructure;

/// <summary>
/// Thêm họ tên vào cookie để Realtime hiển thị tên trên avatar mà không phải truy vấn DB; cờ mật khẩu tạm / chưa bật 2FA (vai trò bắt buộc theo <see cref="TwoFactorPolicy"/>).
/// Security stamp được kiểm ở mọi request → claim tạo lại mỗi request, đổi vai trò / bật 2FA có hiệu lực ngay.
/// </summary>
public sealed class AppClaimsFactory(UserManager<AppUser> users, RoleManager<IdentityRole<Guid>> roles, IOptions<IdentityOptions> options,
    RuntimeConfig runtime)
    : UserClaimsPrincipalFactory<AppUser, IdentityRole<Guid>>(users, roles, options)
{
    protected override async Task<ClaimsIdentity> GenerateClaimsAsync(AppUser user)
    {
        var id = await base.GenerateClaimsAsync(user);
        id.AddClaim(new Claim(ClaimNames.FullName, user.FullName));
        if (user.MustChangePassword) id.AddClaim(new Claim(ClaimNames.MustChangePassword, "true"));
        if (!user.TwoFactorEnabled && TwoFactorPolicy.IsRequiredFor(id.FindAll(id.RoleClaimType).Select(c => c.Value), user.IsBot, runtime.TwoFactor))
            id.AddClaim(new Claim(ClaimNames.MustSetupTwoFactor, "true"));
        return id;
    }
}
