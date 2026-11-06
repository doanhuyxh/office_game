using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OfficeHub.BuildingBlocks.Modules;
using OfficeHub.Modules.Reporting.Features;
using OfficeHub.Modules.Reporting.Infrastructure;

namespace OfficeHub.Modules.Reporting;

/// <summary>
/// Báo cáo: bảng công tháng (Excel), tiền tăng ca, tiền phép năm khi nghỉ việc. Không có DB riêng — đọc dữ liệu
/// các module khác qua *.Contracts (Organization, Attendance, Leave, LaborContracts) rồi tính theo Domain/PayRules.
/// </summary>
public sealed class ReportingModule : IModule
{
    public string Name => "reports";

    public void Register(IServiceCollection services, IConfiguration config) => services.AddScoped<ReportService>();

    public void MapEndpoints(IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/reports").WithTags("Reporting").RequireAuthorization();
        g.MapGet("/_status", () => TypedResults.Ok(new { module = "Reporting", status = "ok" }));
        ReportEndpoints.Map(g);
    }
}
