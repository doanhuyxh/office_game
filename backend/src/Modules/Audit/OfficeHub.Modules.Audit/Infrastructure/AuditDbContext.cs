using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using OfficeHub.Modules.Audit.Domain;

namespace OfficeHub.Modules.Audit.Infrastructure;

public sealed class AuditDbContext(DbContextOptions<AuditDbContext> options) : DbContext(options)
{
    public const string Schema = "audit";
    public DbSet<AiRequestLog> AiRequests => Set<AiRequestLog>();
    public DbSet<ChangeLog> Changes => Set<ChangeLog>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasDefaultSchema(Schema);
        b.Entity<AiRequestLog>(e =>
        {
            e.ToTable("ai_requests");
            e.Property(x => x.ClientName).HasMaxLength(100).IsRequired();
            e.Property(x => x.Tool).HasMaxLength(64);
            e.Property(x => x.Method).HasMaxLength(10).IsRequired();
            e.Property(x => x.Path).HasMaxLength(300).IsRequired();
            e.Property(x => x.Ip).HasMaxLength(64);
            e.HasIndex(x => x.OccurredAt).HasDatabaseName("ix_ai_requests_time");
            e.HasIndex(x => new { x.UserId, x.OccurredAt }).HasDatabaseName("ix_ai_requests_user_time");
        });
        b.Entity<ChangeLog>(e =>
        {
            e.ToTable("changes");
            e.Property(x => x.Source).HasMaxLength(10);
            e.Property(x => x.UserName).HasMaxLength(200);
            e.Property(x => x.Module).HasMaxLength(30);
            e.Property(x => x.Entity).HasMaxLength(60);
            e.Property(x => x.EntityId).HasMaxLength(100);
            e.Property(x => x.EntityLabel).HasMaxLength(200);
            e.Property(x => x.Action).HasMaxLength(10);
            e.Property(x => x.ChangesJson).HasColumnType("jsonb");
            e.HasIndex(x => x.OccurredAt).HasDatabaseName("ix_changes_time");
            e.HasIndex(x => new { x.Entity, x.EntityId, x.OccurredAt }).HasDatabaseName("ix_changes_entity");
            e.HasIndex(x => new { x.UserId, x.OccurredAt }).HasDatabaseName("ix_changes_user");
        });
    }
}

public sealed class DesignTimeFactory : IDesignTimeDbContextFactory<AuditDbContext>
{
    public AuditDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<AuditDbContext>()
            .UseNpgsql("Host=localhost;Database=design_time", o => o.MigrationsHistoryTable("__ef_migrations", AuditDbContext.Schema))
            .Options);
}

internal sealed class AuditMigrator(IServiceProvider sp, IConfiguration config) : IHostedService
{
    public async Task StartAsync(CancellationToken ct)
    {
        if (!config.GetValue("Database:MigrateOnStartup", true)) return;
        using var scope = sp.CreateScope();
        await scope.ServiceProvider.GetRequiredService<AuditDbContext>().Database.MigrateAsync(ct);
    }

    public Task StopAsync(CancellationToken ct) => Task.CompletedTask;
}
