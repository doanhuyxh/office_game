using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.Modules.Meetings.Domain;

namespace OfficeHub.Modules.Meetings.Infrastructure;

public sealed class MeetingsDbContext(DbContextOptions<MeetingsDbContext> options) : DbContext(options)
{
    public const string Schema = "meetings";
    public DbSet<Booking> Bookings => Set<Booking>();
    public DbSet<AgentMeeting> AgentMeetings => Set<AgentMeeting>();
    public DbSet<AgentMeetingSettings> AgentMeetingSettings => Set<AgentMeetingSettings>();

    /// <summary>Trần phiên họp agent đang áp dụng: (lượt, phút); chưa có dòng cài đặt → mặc định.</summary>
    public async Task<(int MaxTurns, int MaxMinutes)> AgentMeetingLimitsAsync(CancellationToken ct) =>
        await AgentMeetingSettings.AsNoTracking().FirstOrDefaultAsync(x => x.Id == Domain.AgentMeetingSettings.SingletonId, ct) is { } row
            ? (row.MaxTurns, row.MaxMinutes) : (AgentMeetingRules.DefaultMaxTurns, AgentMeetingRules.DefaultMaxMinutes);

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasDefaultSchema(Schema);
        b.Entity<Booking>(e =>
        {
            e.ToTable("bookings");
            e.Property(x => x.RoomId).HasMaxLength(50);
            e.Property(x => x.Title).HasMaxLength(200);
            e.Property(x => x.OrganizerName).HasMaxLength(200);
            e.Property(x => x.Note).HasMaxLength(1000);
            e.HasIndex(x => new { x.RoomId, x.StartAt }).HasDatabaseName("ix_bookings_room_start");
            e.HasMany(x => x.Attendees).WithOne().HasForeignKey(a => a.BookingId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<BookingAttendee>(e =>
        {
            e.ToTable("attendees");
            e.HasKey(x => new { x.BookingId, x.EmployeeId });
            e.Property(x => x.Name).HasMaxLength(200);
            e.HasIndex(x => x.EmployeeId).HasDatabaseName("ix_attendees_employee");
        });
        b.Entity<AgentMeeting>(e =>
        {
            e.ToTable("agent_sessions");
            e.Property(x => x.RoomId).HasMaxLength(50);
            e.Property(x => x.Topic).HasMaxLength(AgentMeetingRules.TopicMaxLength);
            e.Property(x => x.OpenedByName).HasMaxLength(200);
            e.Property(x => x.EndedByName).HasMaxLength(200);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(10);
            e.Property(x => x.EndReason).HasConversion<string>().HasMaxLength(20);
            e.Ignore(x => x.ExpiresAt);
            // Mỗi phòng tối đa một phiên đang họp — chốt chặn cuối sau khoá theo phòng khi mở.
            e.HasIndex(x => x.RoomId).IsUnique().HasFilter("\"Status\" = 'Active'").HasDatabaseName("ux_agent_sessions_room_active");
            e.HasIndex(x => new { x.Status, x.StartedAt }).HasDatabaseName("ix_agent_sessions_status_started");
            e.HasMany(x => x.Bots).WithOne().HasForeignKey(a => a.MeetingId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<AgentMeetingBot>(e =>
        {
            e.ToTable("agent_session_bots");
            e.HasKey(x => new { x.MeetingId, x.EmployeeId });
            e.Property(x => x.Name).HasMaxLength(200);
            e.HasIndex(x => x.UserId).HasDatabaseName("ix_agent_session_bots_user");
        });
        b.Entity<AgentMeetingSettings>(e =>
        {
            e.ToTable("agent_settings");
            e.Property(x => x.Id).ValueGeneratedNever();
            e.Property(x => x.UpdatedByName).HasMaxLength(200);
        });
    }
}

public sealed class DesignTimeFactory : IDesignTimeDbContextFactory<MeetingsDbContext>
{
    public MeetingsDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<MeetingsDbContext>()
            .UseNpgsql("Host=localhost;Database=design_time", o => o.MigrationsHistoryTable("__ef_migrations", MeetingsDbContext.Schema))
            .Options);
}

internal sealed class MeetingsMigrator(IServiceProvider sp, IConfiguration config) : IHostedService
{
    public async Task StartAsync(CancellationToken ct)
    {
        if (!config.GetValue("Database:MigrateOnStartup", true)) return;
        using var scope = sp.CreateScope();
        await scope.ServiceProvider.GetRequiredService<MeetingsDbContext>().Database.MigrateAsync(ct);
    }

    public Task StopAsync(CancellationToken ct) => Task.CompletedTask;
}

/// <summary>Đọc phòng họp từ shared/office-map.json (Realtime__MapPath — compose đặt cho mọi container backend).</summary>
public sealed class MeetingRooms
{
    public IReadOnlyList<MeetingRoom> All { get; }

    public MeetingRooms(IConfiguration config, IHostEnvironment env)
    {
        var path = EnvLoader.ResolvePath(config["Realtime:MapPath"] ?? "shared/office-map.json", env.ContentRootPath);
        using var doc = JsonDocument.Parse(File.ReadAllText(path));
        All = doc.RootElement.GetProperty("rooms").EnumerateArray()
            .Where(r => r.TryGetProperty("kind", out var k) && k.GetString() == "meeting")
            .Select(r => new MeetingRoom(r.GetProperty("id").GetString()!, r.GetProperty("name").GetString()!,
                r.TryGetProperty("capacity", out var c) ? c.GetInt32() : 0))
            .ToList();
    }

    public MeetingRoom? Find(string? id) => All.FirstOrDefault(r => r.Id == id);
}
