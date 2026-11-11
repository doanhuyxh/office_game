using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.Modules.Chat.Domain;

namespace OfficeHub.Modules.Chat.Infrastructure;

public sealed class ChatDbContext(DbContextOptions<ChatDbContext> options) : DbContext(options)
{
    public const string Schema = "chat";
    public DbSet<Conversation> Conversations => Set<Conversation>();
    public DbSet<RoomMember> RoomMembers => Set<RoomMember>();
    public DbSet<Message> Messages => Set<Message>();
    public DbSet<MessageAttachment> Attachments => Set<MessageAttachment>();
    public DbSet<ReadState> ReadStates => Set<ReadState>();
    public DbSet<UploadTicket> UploadTickets => Set<UploadTicket>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasDefaultSchema(Schema);
        b.Entity<Conversation>(e =>
        {
            e.ToTable("conversations");
            e.Property(x => x.Type).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.RoomId).HasMaxLength(50);
            e.Property(x => x.LastPreview).HasMaxLength(200);
            e.HasIndex(x => x.Type).IsUnique().HasFilter("\"Type\" = 'Office'").HasDatabaseName("ux_conversations_office");
            e.HasIndex(x => x.RoomId).IsUnique().HasFilter("\"RoomId\" IS NOT NULL").HasDatabaseName("ux_conversations_room");
            e.HasIndex(x => new { x.UserLowId, x.UserHighId }).IsUnique().HasFilter("\"UserLowId\" IS NOT NULL").HasDatabaseName("ux_conversations_direct");
            e.HasIndex(x => x.UserHighId).HasDatabaseName("ix_conversations_high");
        });
        b.Entity<RoomMember>(e =>
        {
            e.ToTable("room_members");
            e.HasKey(x => new { x.ConversationId, x.UserId });
            e.HasIndex(x => x.UserId).HasDatabaseName("ix_room_members_user");
        });
        b.Entity<Message>(e =>
        {
            e.ToTable("messages");
            e.Property(x => x.Seq).ValueGeneratedOnAdd().UseIdentityAlwaysColumn();
            e.Property(x => x.SenderName).HasMaxLength(200);
            e.Property(x => x.Text).HasMaxLength(ChatRules.MaxTextLength);
            e.Property(x => x.ClientId).HasMaxLength(64);
            e.HasIndex(x => x.Seq).IsUnique().HasDatabaseName("ux_messages_seq");
            e.HasIndex(x => new { x.ConversationId, x.Seq }).HasDatabaseName("ix_messages_conversation_seq");
            // Hạn mức bot: đếm tin của bot trong 1 giờ qua (chỉ dòng ByBot — chỉ mục nhỏ).
            e.HasIndex(x => new { x.SenderId, x.CreatedAt }).HasFilter("\"ByBot\"").HasDatabaseName("ix_messages_bot_sender_time");
            e.HasIndex(x => new { x.ConversationId, x.SenderId, x.ClientId }).IsUnique().HasFilter("\"ClientId\" IS NOT NULL").HasDatabaseName("ux_messages_client");
            e.HasMany(x => x.Attachments).WithOne().HasForeignKey(a => a.MessageId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<MessageAttachment>(e =>
        {
            e.ToTable("attachments");
            e.Property(x => x.FileKey).HasMaxLength(500);
            e.Property(x => x.FileName).HasMaxLength(300);
            e.Property(x => x.ContentType).HasMaxLength(150);
            e.HasIndex(x => x.MessageId).HasDatabaseName("ix_attachments_message");
        });
        b.Entity<ReadState>(e =>
        {
            e.ToTable("read_states");
            e.HasKey(x => new { x.ConversationId, x.UserId });
            e.HasIndex(x => x.UserId).HasDatabaseName("ix_read_states_user");
        });
        b.Entity<UploadTicket>(e =>
        {
            e.ToTable("upload_tickets");
            e.Property(x => x.FileKey).HasMaxLength(500);
            e.Property(x => x.FileName).HasMaxLength(300);
            e.Property(x => x.ContentType).HasMaxLength(150);
            e.HasIndex(x => x.CreatedAt).HasDatabaseName("ix_upload_tickets_created");
        });
    }
}

public sealed class DesignTimeFactory : IDesignTimeDbContextFactory<ChatDbContext>
{
    public ChatDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<ChatDbContext>()
            .UseNpgsql("Host=localhost;Database=design_time", o => o.MigrationsHistoryTable("__ef_migrations", ChatDbContext.Schema))
            .Options);
}

/// <summary>Migrate lúc khởi động, rồi đảm bảo có kênh Office + một kênh cho mỗi phòng có tường trong bản đồ văn phòng.</summary>
internal sealed class ChatMigrator(IServiceProvider sp, IConfiguration config, TimeProvider clock) : IHostedService
{
    public async Task StartAsync(CancellationToken ct)
    {
        if (!config.GetValue("Database:MigrateOnStartup", true)) return;
        using var scope = sp.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ChatDbContext>();
        await db.Database.MigrateAsync(ct);

        var now = clock.GetUtcNow();
        if (!await db.Conversations.AnyAsync(c => c.Type == ConversationType.Office, ct))
            db.Conversations.Add(new Conversation { Type = ConversationType.Office, CreatedAt = now });
        var existing = await db.Conversations.Where(c => c.RoomId != null).Select(c => c.RoomId!).ToListAsync(ct);
        foreach (var room in scope.ServiceProvider.GetRequiredService<ChatRooms>().All.Where(r => !existing.Contains(r.Id)))
            db.Conversations.Add(new Conversation { Type = ConversationType.Room, RoomId = room.Id, CreatedAt = now });
        await db.SaveChangesAsync(ct);
    }

    public Task StopAsync(CancellationToken ct) => Task.CompletedTask;
}

/// <summary>Phòng có tường (kênh chat nhóm) lấy từ shared/office-map.json — cùng nguồn với văn phòng 3D (Realtime__MapPath).</summary>
public sealed class ChatRooms
{
    public IReadOnlyList<ChatRoom> All { get; }

    public ChatRooms(IConfiguration config, IHostEnvironment env)
    {
        var path = EnvLoader.ResolvePath(config["Realtime:MapPath"] ?? "shared/office-map.json", env.ContentRootPath);
        using var doc = JsonDocument.Parse(File.ReadAllText(path));
        All = doc.RootElement.GetProperty("rooms").EnumerateArray()
            .Where(r => r.TryGetProperty("walls", out var w) && w.ValueKind == JsonValueKind.True)
            .Select(r => new ChatRoom(r.GetProperty("id").GetString()!, r.GetProperty("name").GetString()!))
            .ToList();
    }

    public ChatRoom? Find(string? id) => All.FirstOrDefault(r => r.Id == id);
}

public sealed record ChatRoom(string Id, string Name);
