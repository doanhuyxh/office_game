using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace OfficeHub.Modules.Notification.Infrastructure;

public sealed class NotificationDbContext(DbContextOptions<NotificationDbContext> options) : DbContext(options)
{
    public const string Schema = "notifications";

    public DbSet<Domain.Notification> Notifications => Set<Domain.Notification>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasDefaultSchema(Schema);
        b.Entity<Domain.Notification>(e =>
        {
            e.ToTable("notifications");
            e.Property(x => x.Category).HasMaxLength(50);
            e.Property(x => x.Title).HasMaxLength(300);
            e.Property(x => x.Body).HasMaxLength(2000);
            e.Property(x => x.Link).HasMaxLength(300);
            e.Property(x => x.EmailTo).HasMaxLength(256);
            e.Property(x => x.EmailToName).HasMaxLength(200);
            e.Property(x => x.EmailStatus).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.EmailError).HasMaxLength(1000);
            e.HasIndex(x => new { x.UserId, x.CreatedAt });
            // Worker chỉ quét hàng đợi email đang chờ.
            e.HasIndex(x => x.EmailNextAttemptAt).HasFilter("\"EmailStatus\" = 'Pending'");
        });
    }
}

public sealed class DesignTimeFactory : IDesignTimeDbContextFactory<NotificationDbContext>
{
    public NotificationDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<NotificationDbContext>()
            .UseNpgsql("Host=localhost;Database=design_time", o => o.MigrationsHistoryTable("__ef_migrations", NotificationDbContext.Schema))
            .Options);
}
