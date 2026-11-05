using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OfficeHub.BuildingBlocks.Modules;

namespace OfficeHub.Modules.Leave;

/// <summary>Loại phép, chính sách cộng phép, quỹ phép, đơn nghỉ.</summary>
/// <remarks>
/// Cấu trúc: Domain/ (entity, quy tắc) · Features/ (mỗi use case một thư mục: Endpoint + Handler + Validator)
/// · Infrastructure/ (DbContext schema riêng, migrations) · Contracts/ (sự kiện, interface công khai). Khi module khác cần dùng: tách thành project OfficeHub.Modules.X.Contracts.
/// </remarks>
public sealed class LeaveModule : IModule
{
    public string Name => "leave";

    public void Register(IServiceCollection services, IConfiguration config)
    {
        // TODO: services.AddModuleDbContext<LeaveDbContext>(config, "leave");
    }

    public void MapEndpoints(IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/leave").WithTags("Leave").RequireAuthorization();
        g.MapGet("/_status", () => TypedResults.Ok(new { module = "Leave", status = "chưa triển khai" }));
    }
}
