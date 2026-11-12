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
    public DbSet<OAuthClient> OAuthClients => Set<OAuthClient>();
    public DbSet<OAuthCode> OAuthCodes => Set<OAuthCode>();
    public DbSet<OAuthGrant> OAuthGrants => Set<OAuthGrant>();
    public DbSet<UserAvatar> UserAvatars => Set<UserAvatar>();
    public DbSet<AttemptCounterRow> AttemptCounters => Set<AttemptCounterRow>();

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
            t.HasOne<OAuthGrant>().WithMany().HasForeignKey(x => x.GrantId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<OAuthClient>(c =>
        {
            c.ToTable("oauth_clients");
            c.Property(x => x.ClientId).HasMaxLength(64).IsRequired();
            c.Property(x => x.Name).HasMaxLength(100).IsRequired();
            c.HasIndex(x => x.ClientId).IsUnique().HasDatabaseName("ux_oauth_clients_client_id");
        });
        b.Entity<OAuthCode>(c =>
        {
            c.ToTable("oauth_codes");
            c.Property(x => x.CodeHash).HasMaxLength(64).IsRequired();
            c.Property(x => x.RedirectUri).HasMaxLength(2000).IsRequired();
            c.Property(x => x.CodeChallenge).HasMaxLength(128).IsRequired();
            c.Property(x => x.Scope).HasMaxLength(200);
            c.Property(x => x.Resource).HasMaxLength(500);
            c.HasIndex(x => x.CodeHash).IsUnique().HasDatabaseName("ux_oauth_codes_hash");
            c.HasOne<OAuthClient>().WithMany().HasForeignKey(x => x.ClientId).OnDelete(DeleteBehavior.Cascade);
            c.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<OAuthGrant>(g =>
        {
            g.ToTable("oauth_grants");
            g.Property(x => x.ClientName).HasMaxLength(100).IsRequired();
            g.Property(x => x.Scope).HasMaxLength(200);
            g.Property(x => x.RefreshHash).HasMaxLength(64).IsRequired();
            g.Property(x => x.PreviousRefreshHash).HasMaxLength(64);
            g.HasIndex(x => x.RefreshHash).IsUnique().HasDatabaseName("ux_oauth_grants_refresh");
            g.HasIndex(x => x.PreviousRefreshHash).HasDatabaseName("ix_oauth_grants_prev_refresh");
            g.HasIndex(x => x.UserId).HasDatabaseName("ix_oauth_grants_user");
            g.HasOne<OAuthClient>().WithMany().HasForeignKey(x => x.ClientId).OnDelete(DeleteBehavior.Cascade);
            g.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<AttemptCounterRow>(c =>
        {
            c.ToTable("attempt_counters");
            c.HasKey(x => x.Key);
            c.Property(x => x.Key).HasMaxLength(300);
            c.HasIndex(x => x.Until).HasDatabaseName("ix_attempt_counters_until"); // dọn dòng hết hạn
        });

        b.Entity<UserAvatar>(a =>
        {
            a.ToTable("user_avatars");
            a.HasKey(x => x.UserId);
            a.Property(x => x.Look).HasColumnType("jsonb").IsRequired();
            a.HasOne<AppUser>().WithOne().HasForeignKey<UserAvatar>(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
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
