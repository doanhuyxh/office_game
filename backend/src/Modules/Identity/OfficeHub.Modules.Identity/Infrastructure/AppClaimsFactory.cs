using System.Security.Claims;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.Modules.Identity.Domain;

namespace OfficeHub.Modules.Identity.Infrastructure;

/// <summary>Thêm họ tên vào cookie để Realtime hiển thị tên trên avatar mà không phải truy vấn DB.</summary>
public sealed class AppClaimsFactory(UserManager<AppUser> users, RoleManager<IdentityRole<Guid>> roles, IOptions<IdentityOptions> options)
    : UserClaimsPrincipalFactory<AppUser, IdentityRole<Guid>>(users, roles, options)
{
    protected override async Task<ClaimsIdentity> GenerateClaimsAsync(AppUser user)
    {
        var id = await base.GenerateClaimsAsync(user);
        id.AddClaim(new Claim(ClaimNames.FullName, user.FullName));
        if (user.MustChangePassword) id.AddClaim(new Claim(ClaimNames.MustChangePassword, "true"));
        return id;
    }
}
