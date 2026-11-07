using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using OfficeHub.Modules.Documents.Domain;

namespace OfficeHub.Modules.Documents.Infrastructure;

public sealed class DocumentsDbContext(DbContextOptions<DocumentsDbContext> options) : DbContext(options)
{
    public const string Schema = "documents";
    public DbSet<Project> Projects => Set<Project>();
    public DbSet<ProjectMember> ProjectMembers => Set<ProjectMember>();
    public DbSet<Folder> Folders => Set<Folder>();
    public DbSet<DocType> DocTypes => Set<DocType>();
    public DbSet<Asset> Assets => Set<Asset>();
    public DbSet<AssetVersion> Versions => Set<AssetVersion>();
    public DbSet<AccessLog> AccessLogs => Set<AccessLog>();
    public DbSet<UploadTicket> UploadTickets => Set<UploadTicket>();
    public DbSet<Sequence> Sequences => Set<Sequence>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasDefaultSchema(Schema);
        b.Entity<Project>(e =>
        {
            e.ToTable("projects");
            e.Property(x => x.Code).HasMaxLength(30);
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.Description).HasMaxLength(2000);
            e.Property(x => x.CreatedByName).HasMaxLength(200);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.HasIndex(x => x.Code).IsUnique().HasFilter("\"DeletedAt\" IS NULL").HasDatabaseName("ux_projects_code");
            e.HasQueryFilter(x => x.DeletedAt == null);
            e.HasMany(x => x.Members).WithOne().HasForeignKey(m => m.ProjectId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<ProjectMember>(e =>
        {
            e.ToTable("project_members");
            e.HasKey(x => new { x.ProjectId, x.EmployeeId });
            e.Property(x => x.Role).HasConversion<string>().HasMaxLength(20);
            e.HasIndex(x => x.EmployeeId).HasDatabaseName("ix_project_members_employee");
        });
        b.Entity<Folder>(e =>
        {
            e.ToTable("folders");
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.SpaceKind).HasConversion<string>().HasMaxLength(20);
            e.HasIndex(x => new { x.SpaceKind, x.SpaceId, x.ParentId, x.Name }).IsUnique().AreNullsDistinct(false)
                .HasDatabaseName("ux_folders_space_parent_name");
            e.HasOne<Folder>().WithMany().HasForeignKey(x => x.ParentId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<DocType>(e =>
        {
            e.ToTable("doc_types");
            e.Property(x => x.Code).HasMaxLength(10);
            e.Property(x => x.Name).HasMaxLength(100);
            e.HasIndex(x => x.Code).IsUnique().HasDatabaseName("ux_doc_types_code");
        });
        b.Entity<Asset>(e =>
        {
            e.ToTable("assets");
            e.Property(x => x.Code).HasMaxLength(40);
            e.Property(x => x.Title).HasMaxLength(300);
            e.Property(x => x.Description).HasMaxLength(4000);
            e.Property(x => x.SpaceKind).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Kind).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Classification).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.CustodianName).HasMaxLength(200);
            e.Property(x => x.CreatedByName).HasMaxLength(200);
            e.Property(x => x.DocumentNumber).HasMaxLength(60);
            e.Property(x => x.RejectReason).HasMaxLength(1000);
            e.Property(x => x.DestroyReason).HasMaxLength(1000);
            e.Property(x => x.DestroyedByName).HasMaxLength(200);
            e.Property(x => x.DeletedByName).HasMaxLength(200);
            e.HasIndex(x => x.Code).IsUnique().HasDatabaseName("ux_assets_code");
            e.HasIndex(x => new { x.SpaceKind, x.SpaceId, x.FolderId }).HasDatabaseName("ix_assets_space_folder");
            e.HasIndex(x => x.CustodianEmployeeId).HasDatabaseName("ix_assets_custodian");
            e.HasIndex(x => x.RetentionUntil).HasFilter("\"DestroyedAt\" IS NULL").HasDatabaseName("ix_assets_retention");
            e.HasOne<Folder>().WithMany().HasForeignKey(x => x.FolderId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<DocType>().WithMany().HasForeignKey(x => x.DocTypeId).OnDelete(DeleteBehavior.Restrict);
            e.HasMany(x => x.Versions).WithOne().HasForeignKey(v => v.AssetId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<AssetVersion>(e =>
        {
            e.ToTable("asset_versions");
            e.Property(x => x.FileKey).HasMaxLength(400);
            e.Property(x => x.FileName).HasMaxLength(300);
            e.Property(x => x.ContentType).HasMaxLength(150);
            e.Property(x => x.Note).HasMaxLength(500);
            e.Property(x => x.UploadedByName).HasMaxLength(200);
            e.HasIndex(x => new { x.AssetId, x.Number }).IsUnique().HasDatabaseName("ux_asset_versions_number");
        });
        b.Entity<AccessLog>(e =>
        {
            e.ToTable("access_logs");
            e.Property(x => x.UserName).HasMaxLength(200);
            e.Property(x => x.Ip).HasMaxLength(64);
            e.Property(x => x.Action).HasConversion<string>().HasMaxLength(20);
            e.HasIndex(x => new { x.AssetId, x.At }).HasDatabaseName("ix_access_logs_asset_at");
            e.HasOne<Asset>().WithMany().HasForeignKey(x => x.AssetId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<UploadTicket>(e =>
        {
            e.ToTable("upload_tickets");
            e.Property(x => x.FileKey).HasMaxLength(400);
            e.Property(x => x.FileName).HasMaxLength(300);
            e.Property(x => x.ContentType).HasMaxLength(150);
            e.HasIndex(x => x.CreatedAt).HasDatabaseName("ix_upload_tickets_created");
        });
        b.Entity<Sequence>(e =>
        {
            e.ToTable("sequences");
            e.HasKey(x => x.Scope);
            e.Property(x => x.Scope).HasMaxLength(100);
        });
    }

    /// <summary>Số kế tiếp của bộ đếm (nguyên tử: INSERT … ON CONFLICT … RETURNING, an toàn khi nhiều request cùng lúc).</summary>
    public async Task<int> NextAsync(string scope, CancellationToken ct) =>
        (await Database.SqlQuery<int>($"""
            INSERT INTO documents.sequences ("Scope", "Value") VALUES ({scope}, 1)
            ON CONFLICT ("Scope") DO UPDATE SET "Value" = documents.sequences."Value" + 1
            RETURNING "Value"
            """).ToListAsync(ct))[0];
}

public sealed class DesignTimeFactory : IDesignTimeDbContextFactory<DocumentsDbContext>
{
    public DocumentsDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<DocumentsDbContext>()
            .UseNpgsql("Host=localhost;Database=design_time", o => o.MigrationsHistoryTable("__ef_migrations", DocumentsDbContext.Schema))
            .Options);
}

/// <summary>Chạy migration + tạo loại tài liệu mặc định (chỉ khi bảng còn trống).</summary>
internal sealed class DocumentsMigrator(IServiceProvider sp, IConfiguration config) : IHostedService
{
    public async Task StartAsync(CancellationToken ct)
    {
        if (!config.GetValue("Database:MigrateOnStartup", true)) return;
        using var scope = sp.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DocumentsDbContext>();
        await db.Database.MigrateAsync(ct);
        if (await db.DocTypes.AnyAsync(ct)) return;
        var i = 0;
        foreach (var (code, name, years) in DocumentRules.DefaultTypes)
            db.DocTypes.Add(new DocType { Code = code, Name = name, RetentionYears = years, SortOrder = ++i });
        await db.SaveChangesAsync(ct);
    }

    public Task StopAsync(CancellationToken ct) => Task.CompletedTask;
}
