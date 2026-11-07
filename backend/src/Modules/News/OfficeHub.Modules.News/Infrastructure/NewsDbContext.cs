using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using OfficeHub.Modules.News.Domain;

namespace OfficeHub.Modules.News.Infrastructure;

public sealed class NewsDbContext(DbContextOptions<NewsDbContext> options) : DbContext(options)
{
    public const string Schema = "news";
    public DbSet<Post> Posts => Set<Post>();
    public DbSet<PostTarget> Targets => Set<PostTarget>();
    public DbSet<PostMedia> Media => Set<PostMedia>();
    public DbSet<Comment> Comments => Set<Comment>();
    public DbSet<Reaction> Reactions => Set<Reaction>();
    public DbSet<Mention> Mentions => Set<Mention>();
    public DbSet<FeedState> FeedStates => Set<FeedState>();
    public DbSet<UploadTicket> UploadTickets => Set<UploadTicket>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasDefaultSchema(Schema);
        b.Entity<Post>(e =>
        {
            e.ToTable("posts");
            e.Property(x => x.Seq).ValueGeneratedOnAdd().UseIdentityAlwaysColumn();
            e.Property(x => x.AuthorName).HasMaxLength(200);
            e.Property(x => x.Audience).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.HiddenReason).HasMaxLength(500);
            e.HasIndex(x => x.Seq).IsUnique().HasDatabaseName("ux_posts_seq");
            e.HasIndex(x => x.AuthorUserId).HasDatabaseName("ix_posts_author");
            e.HasIndex(x => x.PinnedUntil).HasFilter("\"PinnedUntil\" IS NOT NULL").HasDatabaseName("ix_posts_pinned");
            e.HasMany(x => x.Targets).WithOne().HasForeignKey(t => t.PostId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(x => x.Media).WithOne().HasForeignKey(m => m.PostId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<PostTarget>(e =>
        {
            e.ToTable("post_targets");
            e.HasKey(x => new { x.PostId, x.Kind, x.TargetId });
            e.Property(x => x.Kind).HasConversion<string>().HasMaxLength(20);
            e.HasIndex(x => new { x.Kind, x.TargetId }).HasDatabaseName("ix_post_targets_target");
        });
        b.Entity<PostMedia>(e =>
        {
            e.ToTable("post_media");
            e.Property(x => x.Kind).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.FileKey).HasMaxLength(500);
            e.Property(x => x.FileName).HasMaxLength(300);
            e.Property(x => x.ContentType).HasMaxLength(150);
            e.HasIndex(x => x.PostId).HasDatabaseName("ix_post_media_post");
        });
        b.Entity<Comment>(e =>
        {
            e.ToTable("comments");
            e.Property(x => x.Seq).ValueGeneratedOnAdd().UseIdentityAlwaysColumn();
            e.Property(x => x.AuthorName).HasMaxLength(200);
            e.Property(x => x.Text).HasMaxLength(NewsRules.MaxCommentLength);
            e.Property(x => x.ImageKey).HasMaxLength(500);
            e.Property(x => x.ImageName).HasMaxLength(300);
            e.Property(x => x.ImageContentType).HasMaxLength(150);
            e.Property(x => x.HiddenReason).HasMaxLength(500);
            e.HasIndex(x => x.Seq).IsUnique().HasDatabaseName("ux_comments_seq");
            e.HasIndex(x => new { x.PostId, x.Seq }).HasDatabaseName("ix_comments_post_seq");
            e.HasIndex(x => x.ParentId).HasDatabaseName("ix_comments_parent");
        });
        b.Entity<Reaction>(e =>
        {
            e.ToTable("reactions");
            e.HasKey(x => new { x.TargetType, x.TargetId, x.UserId });
            e.Property(x => x.TargetType).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Type).HasConversion<string>().HasMaxLength(20);
            e.HasIndex(x => x.UserId).HasDatabaseName("ix_reactions_user");
        });
        b.Entity<Mention>(e =>
        {
            e.ToTable("mentions");
            e.HasKey(x => new { x.TargetType, x.TargetId, x.UserId });
            e.Property(x => x.TargetType).HasConversion<string>().HasMaxLength(20);
        });
        b.Entity<FeedState>(e =>
        {
            e.ToTable("feed_states");
            e.HasKey(x => x.UserId);
        });
        b.Entity<UploadTicket>(e =>
        {
            e.ToTable("upload_tickets");
            e.Property(x => x.Kind).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.FileKey).HasMaxLength(500);
            e.Property(x => x.FileName).HasMaxLength(300);
            e.Property(x => x.ContentType).HasMaxLength(150);
            e.HasIndex(x => x.CreatedAt).HasDatabaseName("ix_upload_tickets_created");
        });
    }
}

public sealed class DesignTimeFactory : IDesignTimeDbContextFactory<NewsDbContext>
{
    public NewsDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<NewsDbContext>()
            .UseNpgsql("Host=localhost;Database=design_time", o => o.MigrationsHistoryTable("__ef_migrations", NewsDbContext.Schema))
            .Options);
}

internal sealed class NewsMigrator(IServiceProvider sp, IConfiguration config) : IHostedService
{
    public async Task StartAsync(CancellationToken ct)
    {
        if (!config.GetValue("Database:MigrateOnStartup", true)) return;
        using var scope = sp.CreateScope();
        await scope.ServiceProvider.GetRequiredService<NewsDbContext>().Database.MigrateAsync(ct);
    }

    public Task StopAsync(CancellationToken ct) => Task.CompletedTask;
}
