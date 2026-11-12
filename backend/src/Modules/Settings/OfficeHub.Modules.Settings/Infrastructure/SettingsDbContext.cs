using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.Modules.Settings.Domain;

namespace OfficeHub.Modules.Settings.Infrastructure;

public sealed class SettingsDbContext(DbContextOptions<SettingsDbContext> options) : DbContext(options)
{
    public const string Schema = "settings";
    public DbSet<SystemSetting> Settings => Set<SystemSetting>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasDefaultSchema(Schema);
        b.Entity<SystemSetting>(e =>
        {
            e.ToTable("system_settings");
            e.HasKey(x => x.Group);
            e.Property(x => x.Group).HasMaxLength(40);
            e.Property(x => x.Name).HasMaxLength(100);
            e.Property(x => x.ValuesJson).HasColumnType("jsonb");
            e.Property(x => x.UpdatedByName).HasMaxLength(200);
        });
    }
}

public sealed class DesignTimeFactory : IDesignTimeDbContextFactory<SettingsDbContext>
{
    public SettingsDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<SettingsDbContext>()
            .UseNpgsql("Host=localhost;Database=design_time", o => o.MigrationsHistoryTable("__ef_migrations", SettingsDbContext.Schema))
            .Options);
}

/// <summary>Chạy migration rồi xoá cache <see cref="RuntimeConfig"/> (lần đọc trước có thể đã gặp bảng chưa tồn tại).</summary>
internal sealed class SettingsMigrator(IServiceProvider sp, IConfiguration config, RuntimeConfig runtime) : IHostedService
{
    public async Task StartAsync(CancellationToken ct)
    {
        if (config.GetValue("Database:MigrateOnStartup", true))
        {
            using var scope = sp.CreateScope();
            await scope.ServiceProvider.GetRequiredService<SettingsDbContext>().Database.MigrateAsync(ct);
        }
        runtime.Invalidate();
    }

    public Task StopAsync(CancellationToken ct) => Task.CompletedTask;
}
