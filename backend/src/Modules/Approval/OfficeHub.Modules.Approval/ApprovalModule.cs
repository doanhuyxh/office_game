using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OfficeHub.BuildingBlocks.Modules;
using OfficeHub.BuildingBlocks.Persistence;
using OfficeHub.Modules.Approval.Contracts;
using OfficeHub.Modules.Approval.Features;
using OfficeHub.Modules.Approval.Infrastructure;

namespace OfficeHub.Modules.Approval;

/// <summary>Luồng phê duyệt dùng chung (nghỉ phép, giải trình chấm công…). Module sở hữu đơn đăng ký IApprovalHandler.</summary>
public sealed class ApprovalModule : IModule
{
    public string Name => "approval";

    public void Register(IServiceCollection services, IConfiguration config)
    {
        services.AddModuleDbContext<ApprovalDbContext>(config, ApprovalDbContext.Schema);
        services.AddScoped<ApprovalNotifications>();
        services.AddScoped<IApprovalService, ApprovalService>();
        services.AddHostedService<ApprovalMigrator>();
    }

    public void MapEndpoints(IEndpointRouteBuilder api) =>
        ApprovalEndpoints.Map(api.MapGroup("/approval").WithTags("Approval").RequireAuthorization());
}
