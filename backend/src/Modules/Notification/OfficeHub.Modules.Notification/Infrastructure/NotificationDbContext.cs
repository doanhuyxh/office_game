using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace OfficeHub.Modules.Notification.Infrastructure;

public sealed class NotificationDbContext(DbContextOptions<NotificationDbContext> options) : DbContext(options)
{
    public const string Schema = "notifications";

    public DbSet<Domain.Notification> Notifications => Set<Domain.Notification>();
    public DbSet<Domain.PushToken> PushTokens => Set<Domain.PushToken>();
    public DbSet<Domain.NotificationPreference> Preferences => Set<Domain.NotificationPreference>();
    public DbSet<Domain.Webhook> Webhooks => Set<Domain.Webhook>();
    public DbSet<Domain.WebhookDelivery> WebhookDeliveries => Set<Domain.WebhookDelivery>();
    public DbSet<Domain.TelegramMessage> TelegramMessages => Set<Domain.TelegramMessage>();

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
        b.Entity<Domain.NotificationPreference>(e =>
        {
            e.ToTable("preferences");
            e.HasKey(x => x.UserId);
            e.Property(x => x.UserId).ValueGeneratedNever();
        });
        b.Entity<Domain.Webhook>(e =>
        {
            e.ToTable("webhooks");
            e.HasKey(x => x.UserId);
            e.Property(x => x.UserId).ValueGeneratedNever();
            e.Property(x => x.Url).HasMaxLength(Domain.WebhookRules.MaxUrlLength);
            e.Property(x => x.SecretEncrypted).HasMaxLength(300);
            e.Property(x => x.LastError).HasMaxLength(500);
        });
        b.Entity<Domain.WebhookDelivery>(e =>
        {
            e.ToTable("webhook_deliveries");
            e.Property(x => x.Event).HasMaxLength(40);
            e.Property(x => x.DataJson).HasColumnType("jsonb");
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Error).HasMaxLength(500);
            e.HasIndex(x => x.NextAttemptAt).HasFilter("\"Status\" = 'Pending'").HasDatabaseName("ix_webhook_deliveries_due");
            e.HasIndex(x => new { x.UserId, x.CreatedAt }).HasDatabaseName("ix_webhook_deliveries_user");
        });
        b.Entity<Domain.TelegramMessage>(e =>
        {
            e.ToTable("telegram_messages");
            e.Property(x => x.Kind).HasMaxLength(40);
            e.Property(x => x.ChatId).HasMaxLength(40);
            e.Property(x => x.Text).HasMaxLength(4096);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Error).HasMaxLength(500);
            e.HasIndex(x => x.NextAttemptAt).HasFilter("\"Status\" = 'Pending'").HasDatabaseName("ix_telegram_messages_due");
            e.HasIndex(x => x.CreatedAt).HasDatabaseName("ix_telegram_messages_created");
        });
        b.Entity<Domain.PushToken>(e =>
        {
            e.ToTable("push_tokens");
            e.Property(x => x.Token).HasMaxLength(400);
            e.HasIndex(x => x.Token).IsUnique();
            e.HasIndex(x => x.UserId);
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
