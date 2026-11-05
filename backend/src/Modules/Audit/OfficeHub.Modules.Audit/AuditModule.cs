using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OfficeHub.BuildingBlocks.Modules;

namespace OfficeHub.Modules.Audit;

/// <summary>Ghi lịch sử mọi thay đổi dữ liệu nhân sự.</summary>
/// <remarks>
/// Cấu trúc: Domain/ (entity, quy tắc) · Features/ (mỗi use case một thư mục: Endpoint + Handler + Validator)
/// · Infrastructure/ (DbContext schema riêng, migrations) · Contracts/ (sự kiện, interface công khai). Khi module khác cần dùng: tách thành project OfficeHub.Modules.X.Contracts.
/// </remarks>
public sealed class AuditModule : IModule
{
    public string Name => "audit";

    public void Register(IServiceCollection services, IConfiguration config)
    {
        // TODO: services.AddModuleDbContext<AuditDbContext>(config, "audit");
    }

    public void MapEndpoints(IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/audit").WithTags("Audit").RequireAuthorization();
        g.MapGet("/_status", () => TypedResults.Ok(new { module = "Audit", status = "chưa triển khai" }));
    }
}
