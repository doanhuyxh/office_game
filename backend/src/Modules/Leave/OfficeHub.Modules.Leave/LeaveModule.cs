using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OfficeHub.BuildingBlocks.Modules;
using OfficeHub.BuildingBlocks.Persistence;
using OfficeHub.Modules.Approval.Contracts;
using OfficeHub.Modules.Leave.Contracts;
using OfficeHub.Modules.Leave.Features;
using OfficeHub.Modules.Leave.Infrastructure;

namespace OfficeHub.Modules.Leave;

/// <summary>Nghỉ phép: loại phép, quỹ phép năm (cộng dồn, không hết hạn), đơn nghỉ qua luồng duyệt, điều chỉnh của HR.</summary>
public sealed class LeaveModule : IModule
{
    public string Name => "leave";

    public void Register(IServiceCollection services, IConfiguration config)
    {
        services.AddModuleDbContext<LeaveDbContext>(config, LeaveDbContext.Schema);
        services.AddScoped<LeaveBalanceService>();
        services.AddScoped<ILeaveCalendar, LeaveCalendar>();
        services.AddScoped<IApprovalHandler, LeaveApprovalHandler>();
        services.AddHostedService<LeaveSeeder>();
    }

    public void MapEndpoints(IEndpointRouteBuilder api) =>
        LeaveEndpoints.Map(api.MapGroup("/leave").WithTags("Leave").RequireAuthorization());
}
