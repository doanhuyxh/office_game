using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OfficeHub.BuildingBlocks.Modules;

namespace OfficeHub.Modules.LaborContracts;

/// <summary>Hợp đồng lao động, phụ lục, mẫu, file S3, nhắc hết hạn.</summary>
/// <remarks>
/// Cấu trúc: Domain/ (entity, quy tắc) · Features/ (mỗi use case một thư mục: Endpoint + Handler + Validator)
/// · Infrastructure/ (DbContext schema riêng, migrations) · Contracts/ (sự kiện, interface công khai). Khi module khác cần dùng: tách thành project OfficeHub.Modules.X.Contracts.
/// </remarks>
public sealed class LaborContractsModule : IModule
{
    public string Name => "contracts";

    public void Register(IServiceCollection services, IConfiguration config)
    {
        // TODO: services.AddModuleDbContext<LaborContractsDbContext>(config, "contracts");
    }

    public void MapEndpoints(IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/contracts").WithTags("LaborContracts").RequireAuthorization();
        g.MapGet("/_status", () => TypedResults.Ok(new { module = "LaborContracts", status = "chưa triển khai" }));
    }
}
