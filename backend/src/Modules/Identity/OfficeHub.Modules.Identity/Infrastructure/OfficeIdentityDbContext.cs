using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using OfficeHub.Modules.Identity.Domain;

namespace OfficeHub.Modules.Identity.Infrastructure;

public sealed class OfficeIdentityDbContext(DbContextOptions<OfficeIdentityDbContext> options)
    : IdentityDbContext<AppUser, IdentityRole<Guid>, Guid>(options)
{
    public const string Schema = "identity";

    public DbSet<AccessToken> AccessTokens => Set<AccessToken>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        base.OnModelCreating(b);
        b.HasDefaultSchema(Schema);

        b.Entity<AccessToken>(t =>
        {
            t.ToTable("access_tokens");
            t.Property(x => x.Name).HasMaxLength(100).IsRequired();
            t.Property(x => x.TokenHash).HasMaxLength(64).IsRequired();
            t.Property(x => x.Prefix).HasMaxLength(20).IsRequired();
            t.HasIndex(x => x.TokenHash).IsUnique().HasDatabaseName("ux_access_tokens_hash");
            t.HasIndex(x => x.UserId).HasDatabaseName("ix_access_tokens_user");
            t.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<AppUser>(u =>
        {
            u.ToTable("users");
            u.Property(x => x.FullName).HasMaxLength(200).IsRequired();
            // Email không bắt buộc nhưng nếu có thì phải duy nhất.
            u.HasIndex(x => x.NormalizedEmail).IsUnique().HasFilter("\"NormalizedEmail\" IS NOT NULL").HasDatabaseName("ux_users_email");
        });
        b.Entity<IdentityRole<Guid>>().ToTable("roles");
        b.Entity<IdentityUserRole<Guid>>().ToTable("user_roles");
        b.Entity<IdentityUserClaim<Guid>>().ToTable("user_claims");
        b.Entity<IdentityUserLogin<Guid>>().ToTable("user_logins");
        b.Entity<IdentityUserToken<Guid>>().ToTable("user_tokens");
        b.Entity<IdentityRoleClaim<Guid>>().ToTable("role_claims");
    }
}

/// <summary>Dùng khi chạy `dotnet ef migrations add` (không cần khởi động cả host).</summary>
public sealed class DesignTimeFactory : IDesignTimeDbContextFactory<OfficeIdentityDbContext>
{
    public OfficeIdentityDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<OfficeIdentityDbContext>()
            .UseNpgsql("Host=localhost;Database=design_time", o => o.MigrationsHistoryTable("__ef_migrations", OfficeIdentityDbContext.Schema))
            .Options);
}
