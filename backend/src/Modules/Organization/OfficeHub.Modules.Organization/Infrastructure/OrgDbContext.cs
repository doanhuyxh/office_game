using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using OfficeHub.Modules.Organization.Domain;

namespace OfficeHub.Modules.Organization.Infrastructure;

public sealed class OrgDbContext(DbContextOptions<OrgDbContext> options, TimeProvider? clock = null) : DbContext(options)
{
    public const string Schema = "org";

    public DbSet<Department> Departments => Set<Department>();
    public DbSet<Position> Positions => Set<Position>();
    public DbSet<ProfileChangeRequest> ProfileRequests => Set<ProfileChangeRequest>();
    public DbSet<Employee> Employees => Set<Employee>();

    /// <summary>Hàm SQL có sẵn <c>translate(text, from, to)</c> — bỏ dấu khi tìm người (<see cref="EmployeeDirectory.SearchActiveAsync"/>). Chỉ dùng trong LINQ to SQL.</summary>
    public static string SqlTranslate(string text, string from, string to) => throw new NotSupportedException("Chỉ dùng trong truy vấn EF");

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasDefaultSchema(Schema);
        b.HasDbFunction(typeof(OrgDbContext).GetMethod(nameof(SqlTranslate))!).HasName("translate").IsBuiltIn();

        b.Entity<Department>(e =>
        {
            e.ToTable("departments");
            e.Property(x => x.Description).HasMaxLength(OrgGuide.DescriptionMax);
            e.Property(x => x.Guide).HasMaxLength(OrgGuide.GuideMax);
            e.Property(x => x.GuideUpdatedByName).HasMaxLength(200);
            e.Property(x => x.Name).HasMaxLength(150);
            e.Property(x => x.Code).HasMaxLength(30);
            e.Property(x => x.MapZone).HasMaxLength(50);
            e.HasIndex(x => x.Name).IsUnique().HasFilter("\"DeletedAt\" IS NULL");
            e.HasQueryFilter(x => x.DeletedAt == null);
        });

        b.Entity<Position>(e =>
        {
            e.ToTable("positions");
            e.Property(x => x.Name).HasMaxLength(150);
            e.HasIndex(x => x.Level);
            e.Property(x => x.Description).HasMaxLength(OrgGuide.DescriptionMax);
            e.Property(x => x.Guide).HasMaxLength(OrgGuide.GuideMax);
            e.Property(x => x.GuideUpdatedByName).HasMaxLength(200);
            e.HasIndex(x => x.Name).IsUnique().HasFilter("\"DeletedAt\" IS NULL");
            e.HasQueryFilter(x => x.DeletedAt == null);
        });

        b.Entity<Employee>(e =>
        {
            e.ToTable("employees");
            e.Property(x => x.Code).HasMaxLength(30);
            e.Property(x => x.FullName).HasMaxLength(200);
            e.Property(x => x.Email).HasMaxLength(256);
            e.Property(x => x.Phone).HasMaxLength(30);
            e.Property(x => x.JobTitle).HasMaxLength(150);
            e.Property(x => x.CurrentAddress).HasMaxLength(PersonalProfile.AddressMax);
            e.Property(x => x.PermanentAddress).HasMaxLength(PersonalProfile.AddressMax);
            e.Property(x => x.EmergencyContactName).HasMaxLength(PersonalProfile.NameMax);
            e.Property(x => x.EmergencyContactRelation).HasMaxLength(PersonalProfile.RelationMax);
            e.Property(x => x.EmergencyContactPhone).HasMaxLength(30);
            e.Property(x => x.AvatarKey).HasMaxLength(300);
            e.Property(x => x.IdNumberEncrypted).HasMaxLength(200);
            e.Property(x => x.IdIssuedPlace).HasMaxLength(PersonalProfile.NameMax);
            e.Property(x => x.BankName).HasMaxLength(100);
            e.Property(x => x.BankAccountEncrypted).HasMaxLength(200);
            e.Property(x => x.BankAccountHolder).HasMaxLength(PersonalProfile.NameMax);
            e.Property(x => x.Note).HasMaxLength(2000);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.HasIndex(x => x.Code).IsUnique().HasFilter("\"DeletedAt\" IS NULL");
            e.HasIndex(x => x.UserId).IsUnique().HasFilter("\"UserId\" IS NOT NULL");
            e.HasIndex(x => x.DepartmentId);
            e.HasIndex(x => x.ManagerId);
            e.HasOne<Department>().WithMany().HasForeignKey(x => x.DepartmentId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Position>().WithMany().HasForeignKey(x => x.PositionId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Employee>().WithMany().HasForeignKey(x => x.ManagerId).OnDelete(DeleteBehavior.Restrict);
            e.HasQueryFilter(x => x.DeletedAt == null);
        });

        b.Entity<ProfileChangeRequest>(e =>
        {
            e.ToTable("profile_change_requests");
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(10);
            e.Property(x => x.DataEncrypted).HasMaxLength(4000);
            e.Property(x => x.Note).HasMaxLength(500);
            e.Property(x => x.DecidedByName).HasMaxLength(200);
            e.Property(x => x.RejectReason).HasMaxLength(500);
            e.HasIndex(x => new { x.EmployeeId, x.Status });
            e.HasIndex(x => x.Status);
        });

        b.Entity<Department>().HasOne<Department>().WithMany().HasForeignKey(x => x.ParentId).OnDelete(DeleteBehavior.Restrict);
    }

    /// <summary>Tự điền CreatedAt / UpdatedAt.</summary>
    public override Task<int> SaveChangesAsync(CancellationToken ct = default)
    {
        var now = (clock ?? TimeProvider.System).GetUtcNow();
        foreach (var entry in ChangeTracker.Entries<Entity>())
        {
            if (entry.State == EntityState.Added) entry.Entity.CreatedAt = entry.Entity.UpdatedAt = now;
            else if (entry.State == EntityState.Modified) entry.Entity.UpdatedAt = now;
        }
        return base.SaveChangesAsync(ct);
    }
}

public sealed class DesignTimeFactory : IDesignTimeDbContextFactory<OrgDbContext>
{
    public OrgDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<OrgDbContext>()
            .UseNpgsql("Host=localhost;Database=design_time", o => o.MigrationsHistoryTable("__ef_migrations", OrgDbContext.Schema))
            .Options);
}
