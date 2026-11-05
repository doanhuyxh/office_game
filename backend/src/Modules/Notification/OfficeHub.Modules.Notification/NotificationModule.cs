using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OfficeHub.BuildingBlocks.Modules;

namespace OfficeHub.Modules.Notification;

/// <summary>Email, thông báo in-app.</summary>
/// <remarks>
/// Cấu trúc: Domain/ (entity, quy tắc) · Features/ (mỗi use case một thư mục: Endpoint + Handler + Validator)
/// · Infrastructure/ (DbContext schema riêng, migrations) · Contracts/ (sự kiện, interface công khai). Khi module khác cần dùng: tách thành project OfficeHub.Modules.X.Contracts.
/// </remarks>
public sealed class NotificationModule : IModule
{
    public string Name => "notifications";

    public void Register(IServiceCollection services, IConfiguration config)
    {
        // TODO: services.AddModuleDbContext<NotificationDbContext>(config, "notifications");
    }

    public void MapEndpoints(IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/notifications").WithTags("Notification").RequireAuthorization();
        g.MapGet("/_status", () => TypedResults.Ok(new { module = "Notification", status = "chưa triển khai" }));
    }
}
