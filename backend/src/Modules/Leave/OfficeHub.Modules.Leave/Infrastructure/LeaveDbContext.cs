using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using OfficeHub.Modules.Leave.Domain;

namespace OfficeHub.Modules.Leave.Infrastructure;

public sealed class LeaveDbContext(DbContextOptions<LeaveDbContext> options) : DbContext(options)
{
    public const string Schema = "leave";
    public DbSet<LeaveType> Types => Set<LeaveType>();
    public DbSet<LeaveRequest> Requests => Set<LeaveRequest>();
    public DbSet<LeaveAdjustment> Adjustments => Set<LeaveAdjustment>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasDefaultSchema(Schema);
        b.Entity<LeaveType>(e =>
        {
            e.ToTable("types");
            e.Property(x => x.Code).HasMaxLength(30);
            e.Property(x => x.Name).HasMaxLength(100);
            e.HasIndex(x => x.Code).IsUnique();
        });
        b.Entity<LeaveRequest>(e =>
        {
            e.ToTable("requests");
            e.Property(x => x.Period).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Days).HasPrecision(6, 2);
            e.Property(x => x.Reason).HasMaxLength(500);
            e.Property(x => x.RejectReason).HasMaxLength(1000);
            e.HasIndex(x => new { x.EmployeeId, x.StartDate });
            e.HasIndex(x => new { x.Status, x.StartDate, x.EndDate });
            e.HasOne<LeaveType>().WithMany().HasForeignKey(x => x.LeaveTypeId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<LeaveAdjustment>(e =>
        {
            e.ToTable("adjustments");
            e.Property(x => x.Days).HasPrecision(6, 2);
            e.Property(x => x.Reason).HasMaxLength(500);
            e.Property(x => x.CreatedByName).HasMaxLength(200);
            e.HasIndex(x => x.EmployeeId);
        });
    }
}

public sealed class DesignTimeFactory : IDesignTimeDbContextFactory<LeaveDbContext>
{
    public LeaveDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<LeaveDbContext>()
            .UseNpgsql("Host=localhost;Database=design_time", o => o.MigrationsHistoryTable("__ef_migrations", LeaveDbContext.Schema)).Options);
}

/// <summary>Migration + 4 loại phép mặc định lần đầu.</summary>
internal sealed class LeaveSeeder(IServiceProvider sp, IConfiguration config) : IHostedService
{
    public async Task StartAsync(CancellationToken ct)
    {
        using var scope = sp.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<LeaveDbContext>();
        if (config.GetValue("Database:MigrateOnStartup", true)) await db.Database.MigrateAsync(ct);
        if (await db.Types.AnyAsync(ct)) return;
        db.Types.AddRange(
            new LeaveType { Code = "annual", Name = "Phép năm", IsPaid = true, UsesAnnualBalance = true, SortOrder = 0 },
            new LeaveType { Code = "sick", Name = "Nghỉ ốm", IsPaid = false, SortOrder = 1 },
            new LeaveType { Code = "personal_paid", Name = "Việc riêng có lương (cưới, tang…)", IsPaid = true, SortOrder = 2 },
            new LeaveType { Code = "unpaid", Name = "Nghỉ không lương", IsPaid = false, SortOrder = 3 });
        await db.SaveChangesAsync(ct);
    }
    public Task StopAsync(CancellationToken ct) => Task.CompletedTask;
}
