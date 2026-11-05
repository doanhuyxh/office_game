using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OfficeHub.BuildingBlocks.Modules;
using OfficeHub.BuildingBlocks.Persistence;
using OfficeHub.Modules.Organization.Contracts;
using OfficeHub.Modules.Organization.Features.Departments;
using OfficeHub.Modules.Organization.Features.Employees;
using OfficeHub.Modules.Organization.Features.Positions;
using OfficeHub.Modules.Organization.Infrastructure;

namespace OfficeHub.Modules.Organization;

/// <summary>Phòng ban, chức vụ, hồ sơ nhân viên, cấp tài khoản cho nhân viên.</summary>
public sealed class OrganizationModule : IModule
{
    public string Name => "org";

    public void Register(IServiceCollection services, IConfiguration config)
    {
        services.AddModuleDbContext<OrgDbContext>(config, OrgDbContext.Schema);
        services.AddScoped<IEmployeeDirectory, EmployeeDirectory>();
        services.AddHostedService<OrgMigrator>();
    }

    public void MapEndpoints(IEndpointRouteBuilder api)
    {
        var org = api.MapGroup("/org").RequireAuthorization();
        DepartmentEndpoints.Map(org);
        PositionEndpoints.Map(org);
        EmployeeEndpoints.Map(org);
        AccountEndpoints.Map(org);
    }
}
