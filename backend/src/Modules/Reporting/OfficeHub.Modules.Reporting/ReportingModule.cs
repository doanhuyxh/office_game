using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OfficeHub.BuildingBlocks.Modules;

namespace OfficeHub.Modules.Reporting;

/// <summary>Bảng công tháng, tổng hợp phép, xuất Excel.</summary>
/// <remarks>
/// Cấu trúc: Domain/ (entity, quy tắc) · Features/ (mỗi use case một thư mục: Endpoint + Handler + Validator)
/// · Infrastructure/ (DbContext schema riêng, migrations) · Contracts/ (sự kiện, interface công khai). Khi module khác cần dùng: tách thành project OfficeHub.Modules.X.Contracts.
/// </remarks>
public sealed class ReportingModule : IModule
{
    public string Name => "reports";

    public void Register(IServiceCollection services, IConfiguration config)
    {
        // TODO: services.AddModuleDbContext<ReportingDbContext>(config, "reports");
    }

    public void MapEndpoints(IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/reports").WithTags("Reporting").RequireAuthorization();
        g.MapGet("/_status", () => TypedResults.Ok(new { module = "Reporting", status = "chưa triển khai" }));
    }
}
