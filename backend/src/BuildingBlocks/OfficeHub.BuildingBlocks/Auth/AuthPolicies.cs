using System.Security.Claims;
using Microsoft.Extensions.DependencyInjection;

namespace OfficeHub.BuildingBlocks.Auth;

/// <summary>Chính sách phân quyền dùng chung. Dùng: .RequireAuthorization(AuthPolicies.Hr)</summary>
public static class AuthPolicies
{
    /// <summary>admin hoặc hr: quản lý nhân sự.</summary>
    public const string Hr = "hr";
    /// <summary>admin, hr hoặc manager: xem/duyệt cho cấp dưới.</summary>
    public const string Manager = "manager";

    public static IServiceCollection AddOfficeHubAuthorization(this IServiceCollection services)
    {
        services.AddAuthorizationBuilder()
            .AddPolicy(Hr, p => p.RequireRole(Roles.Admin, Roles.Hr))
            .AddPolicy(Manager, p => p.RequireRole(Roles.Admin, Roles.Hr, Roles.Manager));
        return services;
    }

    public static Guid? GetUserId(this ClaimsPrincipal user) =>
        Guid.TryParse(user.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : null;

    public static bool IsHr(this ClaimsPrincipal user) => user.IsInRole(Roles.Admin) || user.IsInRole(Roles.Hr);
}
