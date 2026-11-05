using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using OfficeHub.Modules.Organization.Domain;

namespace OfficeHub.Modules.Organization.Infrastructure;

public sealed class OrgDbContext(DbContextOptions<OrgDbContext> options, TimeProvider? clock = null) : DbContext(options)
{
    public const string Schema = "org";

    public DbSet<Department> Departments => Set<Department>();
    public DbSet<Position> Positions => Set<Position>();
    public DbSet<Employee> Employees => Set<Employee>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasDefaultSchema(Schema);

        b.Entity<Department>(e =>
        {
            e.ToTable("departments");
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
