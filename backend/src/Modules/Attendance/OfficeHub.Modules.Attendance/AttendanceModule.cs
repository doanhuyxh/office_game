using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OfficeHub.BuildingBlocks.Modules;
using OfficeHub.BuildingBlocks.Persistence;
using OfficeHub.Modules.Approval.Contracts;
using OfficeHub.Modules.Attendance.Contracts;
using OfficeHub.Modules.Attendance.Features.Check;
using OfficeHub.Modules.Attendance.Features.Corrections;
using OfficeHub.Modules.Attendance.Features.Shifts;
using OfficeHub.Modules.Attendance.Features.Timesheets;
using OfficeHub.Modules.Attendance.Infrastructure;

namespace OfficeHub.Modules.Attendance;

/// <summary>Chấm công: nút chấm công (web / 3D), ca làm, lịch tuần, ngày lễ, bảng công (tính trực tiếp từ sự kiện), giải trình.</summary>
public sealed class AttendanceModule : IModule
{
    public string Name => "attendance";

    public void Register(IServiceCollection services, IConfiguration config)
    {
        services.AddModuleDbContext<AttendanceDbContext>(config, AttendanceDbContext.Schema);
        services.AddScoped<AttendanceService>();
        services.AddScoped<IWorkCalendar, WorkCalendar>();
        services.AddScoped<IApprovalHandler, CorrectionApprovalHandler>();
        services.AddHostedService<AttendanceSeeder>();
    }

    public void MapEndpoints(IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/attendance").WithTags("Attendance").RequireAuthorization();
        CheckEndpoints.Map(g);
        TimesheetEndpoints.Map(g);
        ShiftEndpoints.Map(g);
        CorrectionEndpoints.Map(g);
    }
}
