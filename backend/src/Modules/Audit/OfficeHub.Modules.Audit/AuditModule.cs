using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OfficeHub.BuildingBlocks.Modules;
using OfficeHub.BuildingBlocks.Persistence;
using OfficeHub.Modules.Audit.Features;
using OfficeHub.Modules.Audit.Infrastructure;

namespace OfficeHub.Modules.Audit;

/// <summary>Nhật ký. Hiện có: mọi request của trợ lý AI (token cá nhân / ứng dụng OAuth). Lịch sử sửa dữ liệu nhân sự: chưa làm.</summary>
public sealed class AuditModule : IModule
{
    public string Name => "audit";

    public void Register(IServiceCollection services, IConfiguration config)
    {
        services.AddModuleDbContext<AuditDbContext>(config, AuditDbContext.Schema);
        services.AddSingleton<AiAuditQueue>();
        services.AddTransient<IStartupFilter, AiAuditStartupFilter>();
        services.AddHostedService<AuditMigrator>();
        services.AddHostedService<AiAuditWriter>();
    }

    public void MapEndpoints(IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/audit").WithTags("Audit").RequireAuthorization();
        g.MapGet("/_status", () => TypedResults.Ok(new { module = "Audit", status = "nhật ký AI" }));
        AiRequestEndpoints.Map(g);
    }
}
