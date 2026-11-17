using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using OfficeHub.BuildingBlocks.Ai;
using OfficeHub.Modules.Audit.Domain;

namespace OfficeHub.Modules.Audit.Infrastructure;

public sealed class AuditDbContext(DbContextOptions<AuditDbContext> options) : DbContext(options)
{
    public const string Schema = "audit";
    public DbSet<AiRequestLog> AiRequests => Set<AiRequestLog>();
    public DbSet<ChangeLog> Changes => Set<ChangeLog>();
    public DbSet<AiAlert> AiAlerts => Set<AiAlert>();
    public DbSet<AiSessionUsage> AiUsageSessions => Set<AiSessionUsage>();
    public DbSet<AiSessionModel> AiUsageModels => Set<AiSessionModel>();
    public DbSet<AgentTranscript> AgentTranscripts => Set<AgentTranscript>();

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
            e.Property(x => x.RequestSummary).HasColumnType("jsonb");
            e.HasIndex(x => x.OccurredAt).HasDatabaseName("ix_ai_requests_time");
            e.HasIndex(x => new { x.UserId, x.OccurredAt }).HasDatabaseName("ix_ai_requests_user_time");
        });
        // Mức dùng AI theo phiên agent (TEST-134): runner gửi qua /mcp/usage, duy nhất theo (UserId, SourceId).
        b.Entity<AiSessionUsage>(e =>
        {
            e.ToTable("ai_usage_sessions");
            e.Property(x => x.SourceId).HasMaxLength(AiUsageRoute.MaxSourceId).IsRequired();
            e.Property(x => x.Kind).HasMaxLength(10).IsRequired();
            e.Property(x => x.TaskCode).HasMaxLength(AiUsageRoute.MaxTaskCode);
            e.Property(x => x.Executor).HasMaxLength(AiUsageRoute.MaxExecutor).IsRequired();
            e.Property(x => x.Status).HasMaxLength(10).IsRequired();
            e.Property(x => x.CostUsd).HasPrecision(12, 6);
            e.HasIndex(x => new { x.UserId, x.SourceId }).IsUnique().HasDatabaseName("ux_ai_usage_sessions_source");
            e.HasIndex(x => new { x.UserId, x.FinishedAt }).HasDatabaseName("ix_ai_usage_sessions_user_time");
            e.HasIndex(x => x.FinishedAt).HasDatabaseName("ix_ai_usage_sessions_time");
            e.HasMany(x => x.Models).WithOne().HasForeignKey(x => x.SessionId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<AiSessionModel>(e =>
        {
            e.ToTable("ai_usage_models");
            e.Property(x => x.Model).HasMaxLength(AiUsageRoute.MaxModel).IsRequired();
            e.Property(x => x.CostUsd).HasPrecision(12, 6);
            e.HasIndex(x => new { x.SessionId, x.Model }).IsUnique().HasDatabaseName("ux_ai_usage_models_session_model");
        });
        // Transcript phiên agent (TEST-144): một bản / (UserId, Key); nội dung mã hoá trên S3.
        b.Entity<AgentTranscript>(e =>
        {
            e.ToTable("agent_transcripts");
            e.Property(x => x.Key).HasMaxLength(AgentTranscriptRoute.MaxKey).IsRequired();
            e.Property(x => x.Kind).HasMaxLength(10).IsRequired();
            e.Property(x => x.SessionId).HasMaxLength(AgentTranscriptRoute.MaxSessionId).IsRequired();
            e.Property(x => x.Cwd).HasMaxLength(AgentTranscriptRoute.MaxCwd);
            e.Property(x => x.Branch).HasMaxLength(AgentTranscriptRoute.MaxBranch);
            e.Property(x => x.Sha256).HasMaxLength(64).IsRequired();
            e.Property(x => x.StorageKey).HasMaxLength(300).IsRequired();
            e.HasIndex(x => new { x.UserId, x.Key }).IsUnique().HasDatabaseName("ux_agent_transcripts_user_key");
            e.HasIndex(x => x.UpdatedAt).HasDatabaseName("ix_agent_transcripts_updated");
            e.HasIndex(x => x.ExpiresAt).HasDatabaseName("ix_agent_transcripts_expires");
        });
        b.Entity<AiAlert>(e =>
        {
            e.ToTable("ai_alerts");
            e.Property(x => x.Rule).HasMaxLength(30).IsRequired();
            e.HasIndex(x => x.CreatedAt).HasDatabaseName("ix_ai_alerts_time");
            e.HasIndex(x => new { x.UserId, x.Rule, x.CreatedAt }).HasDatabaseName("ix_ai_alerts_user_rule");
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
