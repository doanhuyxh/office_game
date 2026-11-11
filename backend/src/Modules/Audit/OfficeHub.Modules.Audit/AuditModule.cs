using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OfficeHub.BuildingBlocks.Auditing;
using OfficeHub.BuildingBlocks.Modules;
using OfficeHub.BuildingBlocks.Persistence;
using OfficeHub.Modules.Audit.Features;
using OfficeHub.Modules.Audit.Infrastructure;

namespace OfficeHub.Modules.Audit;

/// <summary>Nhật ký: mọi request của trợ lý AI + lịch sử sửa dữ liệu nhân sự (entity [Audited] ở các module, đổi vai trò).</summary>
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
        // Lịch sử sửa: thay NullChangeAuditSink mặc định (BuildingBlocks) bằng hàng đợi ghi DB.
        services.AddSingleton<ChangeAuditQueue>();
        services.AddSingleton<IChangeAuditSink>(sp => sp.GetRequiredService<ChangeAuditQueue>());
        services.AddHostedService<ChangeAuditWriter>();
    }

    public void MapEndpoints(IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/audit").WithTags("Audit").RequireAuthorization();
        g.MapGet("/_status", () => TypedResults.Ok(new { module = "Audit", status = "nhật ký AI" }));
        AiRequestEndpoints.Map(g);
        AiUsageEndpoints.Map(g);
        ChangeEndpoints.Map(g);
    }
}
