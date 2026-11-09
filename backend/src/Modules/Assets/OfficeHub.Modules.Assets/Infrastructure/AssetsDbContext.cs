using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using OfficeHub.Modules.Assets.Domain;

namespace OfficeHub.Modules.Assets.Infrastructure;

public sealed class AssetsDbContext(DbContextOptions<AssetsDbContext> options) : DbContext(options)
{
    public const string Schema = "assets";
    public DbSet<Category> Categories => Set<Category>();
    public DbSet<Device> Devices => Set<Device>();
    public DbSet<DeviceAssignment> Assignments => Set<DeviceAssignment>();
    public DbSet<Service> Services => Set<Service>();
    public DbSet<ServiceSeat> Seats => Set<ServiceSeat>();
    public DbSet<AccessReview> Reviews => Set<AccessReview>();
    public DbSet<AccessReviewItem> ReviewItems => Set<AccessReviewItem>();
    public DbSet<Stocktake> Stocktakes => Set<Stocktake>();
    public DbSet<StocktakeItem> StocktakeItems => Set<StocktakeItem>();
    public DbSet<Sequence> Sequences => Set<Sequence>();
    public DbSet<OffboardingNotice> OffboardingNotices => Set<OffboardingNotice>();
    public DbSet<DeviceAttachment> Attachments => Set<DeviceAttachment>();
    public DbSet<HandoverRecord> Handovers => Set<HandoverRecord>();
    public DbSet<AssetSettings> Settings => Set<AssetSettings>();
    public DbSet<SocialAccount> SocialAccounts => Set<SocialAccount>();
    public DbSet<SocialAccountAssignment> SocialAssignments => Set<SocialAccountAssignment>();
    public DbSet<SocialPage> SocialPages => Set<SocialPage>();
    public DbSet<SocialPost> SocialPosts => Set<SocialPost>();
    public DbSet<SocialPostTarget> SocialTargets => Set<SocialPostTarget>();
    public DbSet<SocialMedia> SocialMedia => Set<SocialMedia>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasDefaultSchema(Schema);
        b.Entity<Category>(e =>
        {
            e.ToTable("categories");
            e.Property(x => x.Code).HasMaxLength(10);
            e.Property(x => x.Name).HasMaxLength(100);
            e.HasIndex(x => x.Code).IsUnique().HasDatabaseName("ux_categories_code");
        });
        b.Entity<Device>(e =>
        {
            e.ToTable("devices");
            e.Property(x => x.Code).HasMaxLength(40);
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.Brand).HasMaxLength(100);
            e.Property(x => x.Model).HasMaxLength(100);
            e.Property(x => x.SerialNumber).HasMaxLength(100);
            e.Property(x => x.Note).HasMaxLength(2000);
            e.Property(x => x.StatusReason).HasMaxLength(1000);
            e.Property(x => x.PurchasePrice).HasPrecision(18, 0);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.HasIndex(x => x.Code).IsUnique().HasDatabaseName("ux_devices_code");
            e.HasIndex(x => x.SerialNumber).IsUnique().HasFilter("\"SerialNumber\" IS NOT NULL AND \"DeletedAt\" IS NULL").HasDatabaseName("ux_devices_serial");
            e.HasIndex(x => x.HolderEmployeeId).HasDatabaseName("ix_devices_holder");
            e.HasIndex(x => x.WarrantyUntil).HasDatabaseName("ix_devices_warranty");
            e.HasQueryFilter(x => x.DeletedAt == null);
            e.HasOne<Category>().WithMany().HasForeignKey(x => x.CategoryId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<DeviceAssignment>(e =>
        {
            e.ToTable("device_assignments");
            e.Property(x => x.AssignedByName).HasMaxLength(200);
            e.Property(x => x.ReturnedByName).HasMaxLength(200);
            e.Property(x => x.AssignNote).HasMaxLength(1000);
            e.Property(x => x.ReturnNote).HasMaxLength(1000);
            e.HasIndex(x => new { x.DeviceId, x.AssignedAt }).HasDatabaseName("ix_assignments_device");
            e.HasIndex(x => x.EmployeeId).HasDatabaseName("ix_assignments_employee");
            e.HasOne<Device>().WithMany().HasForeignKey(x => x.DeviceId).OnDelete(DeleteBehavior.Restrict).IsRequired();
        });
        b.Entity<Service>(e =>
        {
            e.ToTable("services");
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.Vendor).HasMaxLength(200);
            e.Property(x => x.Plan).HasMaxLength(100);
            e.Property(x => x.Url).HasMaxLength(500);
            e.Property(x => x.Note).HasMaxLength(2000);
            e.Property(x => x.Cost).HasPrecision(18, 0);
            e.Property(x => x.BillingCycle).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.HasIndex(x => x.RenewalDate).HasDatabaseName("ix_services_renewal");
        });
        b.Entity<ServiceSeat>(e =>
        {
            e.ToTable("service_seats");
            e.Property(x => x.AccountLogin).HasMaxLength(200);
            e.Property(x => x.Role).HasMaxLength(100);
            e.Property(x => x.Note).HasMaxLength(1000);
            e.Property(x => x.GrantedByName).HasMaxLength(200);
            e.Property(x => x.RevokedByName).HasMaxLength(200);
            e.HasIndex(x => new { x.ServiceId, x.AccountLogin }).IsUnique().HasFilter("\"RevokedAt\" IS NULL").HasDatabaseName("ux_seats_service_login_active");
            e.HasIndex(x => x.EmployeeId).HasDatabaseName("ix_seats_employee");
            e.HasOne<Service>().WithMany().HasForeignKey(x => x.ServiceId).OnDelete(DeleteBehavior.Restrict).IsRequired();
        });
        b.Entity<AccessReview>(e =>
        {
            e.ToTable("access_reviews");
            e.Property(x => x.Title).HasMaxLength(200);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.StartedByName).HasMaxLength(200);
            e.Property(x => x.ClosedByName).HasMaxLength(200);
            e.HasMany(x => x.Items).WithOne().HasForeignKey(i => i.ReviewId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<AccessReviewItem>(e =>
        {
            e.ToTable("access_review_items");
            e.Property(x => x.ServiceName).HasMaxLength(200);
            e.Property(x => x.AccountLogin).HasMaxLength(200);
            e.Property(x => x.Note).HasMaxLength(1000);
            e.Property(x => x.DecidedByName).HasMaxLength(200);
            e.Property(x => x.Decision).HasConversion<string>().HasMaxLength(20);
            e.HasIndex(x => new { x.ReviewId, x.ReviewerEmployeeId }).HasDatabaseName("ix_review_items_reviewer");
        });
        b.Entity<Stocktake>(e =>
        {
            e.ToTable("stocktakes");
            e.Property(x => x.Title).HasMaxLength(200);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.StartedByName).HasMaxLength(200);
            e.Property(x => x.ClosedByName).HasMaxLength(200);
            e.HasMany(x => x.Items).WithOne().HasForeignKey(i => i.StocktakeId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<StocktakeItem>(e =>
        {
            e.ToTable("stocktake_items");
            e.Property(x => x.DeviceCode).HasMaxLength(40);
            e.Property(x => x.DeviceName).HasMaxLength(200);
            e.Property(x => x.SerialNumber).HasMaxLength(100);
            e.Property(x => x.Note).HasMaxLength(1000);
            e.Property(x => x.CheckedByName).HasMaxLength(200);
            e.Property(x => x.Result).HasConversion<string>().HasMaxLength(20);
            e.HasIndex(x => x.StocktakeId).HasDatabaseName("ix_stocktake_items_stocktake");
        });
        b.Entity<Sequence>(e =>
        {
            e.ToTable("sequences");
            e.HasKey(x => x.Scope);
            e.Property(x => x.Scope).HasMaxLength(100);
        });
        b.Entity<OffboardingNotice>(e =>
        {
            e.ToTable("offboarding_notices");
            e.HasKey(x => x.EmployeeId);
        });
        b.Entity<DeviceAttachment>(e =>
        {
            e.ToTable("device_attachments");
            e.Property(x => x.Kind).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.FileName).HasMaxLength(200);
            e.Property(x => x.ContentType).HasMaxLength(150);
            e.Property(x => x.FileKey).HasMaxLength(400);
            e.Property(x => x.CreatedByName).HasMaxLength(200);
            e.Property(x => x.DeletedByName).HasMaxLength(200);
            e.HasIndex(x => x.DeviceId).HasDatabaseName("ix_device_attachments_device");
            e.HasOne<Device>().WithMany().HasForeignKey(x => x.DeviceId).OnDelete(DeleteBehavior.Restrict).IsRequired();
        });
        b.Entity<HandoverRecord>(e =>
        {
            e.ToTable("handover_records");
            e.Property(x => x.Number).HasMaxLength(30);
            e.Property(x => x.Kind).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.EmployeeCode).HasMaxLength(50);
            e.Property(x => x.EmployeeName).HasMaxLength(200);
            e.Property(x => x.DepartmentName).HasMaxLength(200);
            e.Property(x => x.DeviceCode).HasMaxLength(40);
            e.Property(x => x.DeviceName).HasMaxLength(200);
            e.Property(x => x.CategoryName).HasMaxLength(100);
            e.Property(x => x.Brand).HasMaxLength(100);
            e.Property(x => x.Model).HasMaxLength(100);
            e.Property(x => x.SerialNumber).HasMaxLength(100);
            e.Property(x => x.Note).HasMaxLength(1000);
            e.Property(x => x.CreatedByName).HasMaxLength(200);
            e.Property(x => x.ConfirmedIp).HasMaxLength(64);
            e.HasIndex(x => x.Number).IsUnique().HasDatabaseName("ux_handover_records_number");
            e.HasIndex(x => x.DeviceId).HasDatabaseName("ix_handover_records_device");
            e.HasIndex(x => new { x.EmployeeId, x.ConfirmedAt }).HasDatabaseName("ix_handover_records_employee");
            e.HasOne<Device>().WithMany().HasForeignKey(x => x.DeviceId).OnDelete(DeleteBehavior.Restrict).IsRequired();
            e.HasOne<DeviceAssignment>().WithMany().HasForeignKey(x => x.AssignmentId).OnDelete(DeleteBehavior.Restrict).IsRequired();
        });
        b.Entity<AssetSettings>(e =>
        {
            e.ToTable("settings");
            e.Property(x => x.Id).ValueGeneratedNever();
            e.Property(x => x.HandoverTemplateKey).HasMaxLength(400);
            e.Property(x => x.HandoverTemplateName).HasMaxLength(200);
            e.Property(x => x.UpdatedByName).HasMaxLength(200);
        });
        ConfigureSocial(b);
    }

    private static void ConfigureSocial(ModelBuilder b)
    {
        b.Entity<SocialAccount>(e =>
        {
            e.ToTable("social_accounts");
            e.Property(x => x.Platform).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.TokenStatus).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.ExternalId).HasMaxLength(50);
            e.Property(x => x.LoginHint).HasMaxLength(200);
            e.Property(x => x.Note).HasMaxLength(2000);
            e.Property(x => x.TokenError).HasMaxLength(1000);
            e.Property(x => x.TokenOwnerName).HasMaxLength(200);
            e.HasIndex(x => x.HolderEmployeeId).HasDatabaseName("ix_social_accounts_holder");
            e.HasIndex(x => new { x.Platform, x.ExternalId }).IsUnique().HasFilter("\"ExternalId\" IS NOT NULL").HasDatabaseName("ux_social_accounts_external");
        });
        b.Entity<SocialAccountAssignment>(e =>
        {
            e.ToTable("social_account_assignments");
            e.Property(x => x.AssignedByName).HasMaxLength(200);
            e.Property(x => x.ReturnedByName).HasMaxLength(200);
            e.Property(x => x.AssignNote).HasMaxLength(1000);
            e.Property(x => x.ReturnNote).HasMaxLength(1000);
            e.HasIndex(x => new { x.AccountId, x.AssignedAt }).HasDatabaseName("ix_social_assignments_account");
            e.HasIndex(x => x.EmployeeId).HasDatabaseName("ix_social_assignments_employee");
            e.HasOne<SocialAccount>().WithMany().HasForeignKey(x => x.AccountId).OnDelete(DeleteBehavior.Restrict).IsRequired();
        });
        b.Entity<SocialPage>(e =>
        {
            e.ToTable("social_pages");
            e.Property(x => x.ExternalId).HasMaxLength(50);
            e.Property(x => x.Name).HasMaxLength(300);
            e.Property(x => x.Category).HasMaxLength(200);
            e.Property(x => x.Link).HasMaxLength(500);
            e.Property(x => x.PictureUrl).HasMaxLength(2000);
            e.HasIndex(x => new { x.AccountId, x.ExternalId }).IsUnique().HasDatabaseName("ux_social_pages_account_external");
            e.HasOne<SocialAccount>().WithMany().HasForeignKey(x => x.AccountId).OnDelete(DeleteBehavior.Restrict).IsRequired();
        });
        b.Entity<SocialPost>(e =>
        {
            e.ToTable("social_posts");
            e.Property(x => x.Link).HasMaxLength(2000);
            e.Property(x => x.AuthorName).HasMaxLength(200);
            e.HasIndex(x => new { x.CreatedAt, x.Id }).HasDatabaseName("ix_social_posts_created");
            e.HasIndex(x => x.AuthorUserId).HasDatabaseName("ix_social_posts_author");
            e.HasMany(x => x.Targets).WithOne().HasForeignKey(t => t.PostId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<SocialPostTarget>(e =>
        {
            e.ToTable("social_post_targets");
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.ExternalPostId).HasMaxLength(100);
            e.Property(x => x.Permalink).HasMaxLength(1000);
            e.Property(x => x.Error).HasMaxLength(1000);
            e.Property(x => x.CancelledByName).HasMaxLength(200);
            e.HasIndex(x => new { x.Status, x.DueAt }).HasDatabaseName("ix_social_targets_due");
            e.HasIndex(x => x.PageId).HasDatabaseName("ix_social_targets_page");
            e.HasOne<SocialPage>().WithMany().HasForeignKey(x => x.PageId).OnDelete(DeleteBehavior.Restrict).IsRequired();
        });
        b.Entity<SocialMedia>(e =>
        {
            e.ToTable("social_media");
            e.Property(x => x.Kind).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.FileName).HasMaxLength(200);
            e.Property(x => x.ContentType).HasMaxLength(150);
            e.Property(x => x.FileKey).HasMaxLength(400);
            e.HasIndex(x => x.PostId).HasDatabaseName("ix_social_media_post");
            e.HasOne<SocialPost>().WithMany().HasForeignKey(x => x.PostId).OnDelete(DeleteBehavior.Restrict);
        });
    }

    /// <summary>Số kế tiếp của bộ đếm (nguyên tử: INSERT … ON CONFLICT … RETURNING).</summary>
    public async Task<int> NextAsync(string scope, CancellationToken ct) =>
        (await Database.SqlQuery<int>($"""
            INSERT INTO assets.sequences ("Scope", "Value") VALUES ({scope}, 1)
            ON CONFLICT ("Scope") DO UPDATE SET "Value" = assets.sequences."Value" + 1
            RETURNING "Value"
            """).ToListAsync(ct))[0];
}

public sealed class DesignTimeFactory : IDesignTimeDbContextFactory<AssetsDbContext>
{
    public AssetsDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<AssetsDbContext>()
            .UseNpgsql("Host=localhost;Database=design_time", o => o.MigrationsHistoryTable("__ef_migrations", AssetsDbContext.Schema))
            .Options);
}

/// <summary>Chạy migration + tạo loại thiết bị mặc định (chỉ khi bảng còn trống).</summary>
internal sealed class AssetsMigrator(IServiceProvider sp, IConfiguration config) : IHostedService
{
    private static readonly (string Code, string Name)[] DefaultCategories =
        [("MT", "Máy tính"), ("MH", "Màn hình"), ("DT", "Điện thoại"), ("PK", "Phụ kiện"), ("KH", "Khác")];

    public async Task StartAsync(CancellationToken ct)
    {
        if (!config.GetValue("Database:MigrateOnStartup", true)) return;
        using var scope = sp.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AssetsDbContext>();
        await db.Database.MigrateAsync(ct);
        if (await db.Categories.AnyAsync(ct)) return;
        var i = 0;
        foreach (var (code, name) in DefaultCategories)
            db.Categories.Add(new Category { Code = code, Name = name, SortOrder = ++i, DepreciationMonths = AssetRules.DefaultDepreciationMonths(code) });
        await db.SaveChangesAsync(ct);
    }

    public Task StopAsync(CancellationToken ct) => Task.CompletedTask;
}
