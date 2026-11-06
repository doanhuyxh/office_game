using OfficeHub.BuildingBlocks.Http;
using System.Diagnostics;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.Realtime.Auth;
using OfficeHub.Realtime.Simulation;
using OfficeHub.Realtime.Voice;

namespace OfficeHub.Realtime.Hubs;

// ---- Dữ liệu gửi qua SignalR (MessagePack). FE sinh type TS từ đây. ----
public sealed record PlayerDto(string Id, string Name, float X, float Z, float R, byte Anim);
public sealed record PositionDto(string Id, float X, float Z, float R, byte Anim);
public sealed record WelcomeDto(string SelfId, string MapName, PlayerDto[] Players);
/// <summary>
/// At = ISO 8601 UTC 'Z' (Instants.Format) — MessagePack không có kiểu thời điểm chuẩn cho JS.
/// Channel = "office" (toàn văn phòng) | "room" (chỉ người đang đứng trong phòng có tường RoomId / RoomName).
/// </summary>
public sealed record ChatDto(string Id, string Name, string Text, string At, string Channel = "office", string? RoomId = null, string? RoomName = null);

/// <summary>Các hàm server gọi xuống client.</summary>
public interface IOfficeClient
{
    Task Welcome(WelcomeDto welcome);
    Task PlayerJoined(PlayerDto player);
    Task PlayerLeft(string id);
    Task Positions(PositionDto[] positions);
    Task Chat(ChatDto message);
    Task Teleport(float x, float z);
    Task Kicked(string reason);
}

[Authorize]
public sealed class OfficeRoomHub(Presence presence, OfficeMap map, SessionValidator sessions, VoiceGuard voice,
    TimeProvider clock, ILogger<OfficeRoomHub> log) : Hub<IOfficeClient>
{
    public const string Path = "/rt/hub/office";
    private const string Room = "office";
    private const float MaxSpeed = 7f, Slack = 2.5f;

    private string UserId => Context.UserIdentifier ?? throw new HubException("unauthorized");

    public override async Task OnConnectedAsync()
    {
        if (Context.User?.HasClaim(ClaimNames.MustChangePassword, "true") == true)
        {
            Context.Abort();
            return;
        }
        // Cookie còn hạn chưa đủ: hỏi Api xem tài khoản còn hoạt động không (bị khoá / nghỉ việc → từ chối ngay).
        var authCookie = SessionValidator.AuthCookieHeader(Context.GetHttpContext()?.Request.Headers.Cookie.ToString());
        if (await sessions.CheckAsync(authCookie, Context.ConnectionAborted) == SessionState.Invalid)
        {
            await Clients.Caller.Kicked(SessionWatch.ExpiredReason);
            Context.Abort();
            return;
        }
        var name = Context.User?.FindFirstValue(ClaimNames.FullName) ?? Context.User?.Identity?.Name ?? "?";
        var p = new Player
        {
            UserId = UserId, Name = name, ConnectionId = Context.ConnectionId, Context = Context, AuthCookie = authCookie,
            X = (float)map.Spawn.X, Z = (float)map.Spawn.Z, LastMoveTicks = Stopwatch.GetTimestamp(), LastActiveAt = clock.GetUtcNow(),
        };
        var old = presence.Add(p);
        if (old is not null)
        {
            await Clients.Client(old.ConnectionId).Kicked("Tài khoản vừa đăng nhập ở nơi khác");
            // Chờ một chút để tin "Kicked" tới được client trước khi cắt kết nối.
            _ = Task.Delay(500).ContinueWith(_ => old.Context.Abort(), TaskScheduler.Default);
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, Room);
        await Clients.Caller.Welcome(new WelcomeDto(UserId, map.Name,
            presence.All.Select(x => new PlayerDto(x.UserId, x.Name, x.X, x.Z, x.R, x.Anim)).ToArray()));
        await Clients.OthersInGroup(Room).PlayerJoined(new PlayerDto(p.UserId, p.Name, p.X, p.Z, p.R, p.Anim));
        log.LogInformation("{User} vào văn phòng ({Count} online)", name, presence.Count);
        // TODO (Attendance): phát sự kiện PresenceChanged qua Wolverine.
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        if (Context.UserIdentifier is not { } uid || !presence.TryGet(uid, out var p) || !presence.Remove(uid, Context.ConnectionId)) return;
        // Rời văn phòng (đóng tab, bị khoá tài khoản…) → rời luôn voice. Mở tab mới thì không vào đây (kết nối cũ không còn là kết nối hiện tại).
        if (p.VoiceRoom is { } voiceRoom) voice.Kick(voiceRoom, uid);
        await Clients.OthersInGroup(Room).PlayerLeft(uid);
    }

    /// <summary>Client gửi vị trí ~10 lần/giây. Server kiểm tra tốc độ để chống dịch chuyển tức thời.</summary>
    public async Task Move(float x, float z, float r, byte anim)
    {
        if (!presence.TryGet(UserId, out var p) || p.ConnectionId != Context.ConnectionId) return;
        var now = Stopwatch.GetTimestamp();
        var dt = (float)Stopwatch.GetElapsedTime(p.LastMoveTicks, now).TotalSeconds;
        var dist = MathF.Sqrt((x - p.X) * (x - p.X) + (z - p.Z) * (z - p.Z));
        // Ngoài sàn / xuyên tường, đồ vật (lưới va chạm chung với FE) / đi quá nhanh → kéo về vị trí cũ
        if (!map.CanStand(x, z) || dist > MaxSpeed * dt + Slack)
        {
            await Clients.Caller.Teleport(p.X, p.Z);
            return;
        }
        lock (p)
        {
            p.X = x; p.Z = z; p.R = r; p.Anim = anim; p.Dirty = true;
            p.LastMoveTicks = now;
            p.LastActiveAt = clock.GetUtcNow();
        }
    }

    public async Task SendChat(string text)
    {
        if (!presence.TryGet(UserId, out var p)) return;
        text = (text ?? "").Trim();
        if (text.Length == 0) return;
        if (text.Length > 200) text = text[..200];
        var now = clock.GetUtcNow();
        if (now - p.LastChatAt < TimeSpan.FromSeconds(1)) throw new HubException("Gửi chậm lại một chút");
        p.LastChatAt = now;
        p.LastActiveAt = now;
        await Clients.Group(Room).Chat(new ChatDto(p.UserId, p.Name, text, Instants.Format(now)));
    }

    /// <summary>
    /// Chat trong phòng có tường đang đứng (phòng họp, phòng riêng): chỉ người đang ở trong phòng đó nhận.
    /// Phòng do SERVER xác định theo vị trí (cùng quy tắc kênh voice) — client không chọn phòng được.
    /// </summary>
    public async Task SendRoomChat(string text)
    {
        if (!presence.TryGet(UserId, out var p)) return;
        text = (text ?? "").Trim();
        if (text.Length == 0) return;
        if (text.Length > 200) text = text[..200];
        var now = clock.GetUtcNow();
        if (now - p.LastChatAt < TimeSpan.FromSeconds(1)) throw new HubException("Gửi chậm lại một chút");
        var room = RoomOf(p);
        if (room is null) throw new HubException("Bạn đang ở khu mở — vào một phòng có tường để chat riêng trong phòng");
        p.LastChatAt = now;
        p.LastActiveAt = now;
        var targets = presence.All.Where(o => RoomOf(o)?.Id == room.Id).Select(o => o.ConnectionId).ToList();
        await Clients.Clients(targets).Chat(new ChatDto(p.UserId, p.Name, text, Instants.Format(now), "room", room.Id, room.Name));
    }

    private Simulation.Room? RoomOf(Player p)
    {
        float x, z;
        lock (p) { x = p.X; z = p.Z; }
        return map.Rooms.FirstOrDefault(r => r.Walls && r.Contains(x, z));
    }
}
