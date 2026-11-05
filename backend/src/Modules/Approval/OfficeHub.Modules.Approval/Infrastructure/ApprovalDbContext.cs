using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using OfficeHub.Modules.Approval.Domain;

namespace OfficeHub.Modules.Approval.Infrastructure;

public sealed class ApprovalDbContext(DbContextOptions<ApprovalDbContext> options) : DbContext(options)
{
    public const string Schema = "approval";
    public DbSet<ApprovalRequest> Requests => Set<ApprovalRequest>();
    public DbSet<ApprovalStep> Steps => Set<ApprovalStep>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasDefaultSchema(Schema);
        b.Entity<ApprovalRequest>(e =>
        {
            e.ToTable("requests");
            e.Property(x => x.Type).HasMaxLength(50);
            e.Property(x => x.Title).HasMaxLength(200);
            e.Property(x => x.Summary).HasMaxLength(1000);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.HasIndex(x => new { x.Type, x.SubjectId }).IsUnique();
            e.HasIndex(x => new { x.RequesterEmployeeId, x.Status });
            e.HasMany(x => x.Steps).WithOne().HasForeignKey(s => s.RequestId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<ApprovalStep>(e =>
        {
            e.ToTable("steps");
            e.Property(x => x.Kind).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.DecidedByName).HasMaxLength(200);
            e.Property(x => x.Comment).HasMaxLength(1000);
            e.HasIndex(x => new { x.RequestId, x.Order }).IsUnique();
            e.HasIndex(x => new { x.Status, x.Kind, x.ApproverEmployeeId });
        });
    }
}

public sealed class DesignTimeFactory : IDesignTimeDbContextFactory<ApprovalDbContext>
{
    public ApprovalDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<ApprovalDbContext>()
            .UseNpgsql("Host=localhost;Database=design_time", o => o.MigrationsHistoryTable("__ef_migrations", ApprovalDbContext.Schema)).Options);
}

internal sealed class ApprovalMigrator(IServiceProvider sp, IConfiguration config) : IHostedService
{
    public async Task StartAsync(CancellationToken ct)
    {
        if (!config.GetValue("Database:MigrateOnStartup", true)) return;
        using var scope = sp.CreateScope();
        await scope.ServiceProvider.GetRequiredService<ApprovalDbContext>().Database.MigrateAsync(ct);
    }
    public Task StopAsync(CancellationToken ct) => Task.CompletedTask;
}
