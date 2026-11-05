using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace OfficeHub.Modules.Organization.Infrastructure;

/// <summary>Chạy migration schema "org" khi khởi động (nếu Database__MigrateOnStartup=true).</summary>
internal sealed class OrgMigrator(IServiceProvider sp, IConfiguration config) : IHostedService
{
    public async Task StartAsync(CancellationToken ct)
    {
        if (!config.GetValue("Database:MigrateOnStartup", true)) return;
        using var scope = sp.CreateScope();
        await scope.ServiceProvider.GetRequiredService<OrgDbContext>().Database.MigrateAsync(ct);
    }

    public Task StopAsync(CancellationToken ct) => Task.CompletedTask;
}
