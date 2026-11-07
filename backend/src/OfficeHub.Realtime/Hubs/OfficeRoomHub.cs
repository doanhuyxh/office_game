using OfficeHub.BuildingBlocks.Http;
using System.Diagnostics;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.Realtime.Auth;
using OfficeHub.Realtime.Screens;
using OfficeHub.Realtime.Simulation;
using OfficeHub.Realtime.Voice;

namespace OfficeHub.Realtime.Hubs;

// ---- Dữ liệu gửi qua SignalR (MessagePack). FE sinh type TS từ đây. ----
/// <summary>Look = ngoại hình nhân vật (chuỗi JSON, null = mặc định) — client tự parse theo shared/avatar-catalog.json.</summary>
public sealed record PlayerDto(string Id, string Name, float X, float Z, float R, byte Anim, string? Look = null);
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
    /// <summary>Người chơi đổi nhân vật (look = JSON, null = mặc định).</summary>
    Task LookChanged(string id, string? look);
    /// <summary>Màn hình phòng <paramref name="roomId"/> đổi tài liệu đang chiếu (null = tắt) — chỉ gửi người đang ở trong phòng.</summary>
    Task ScreenChanged(string roomId, ScreenDto? screen);
}

[Authorize]
public sealed class OfficeRoomHub(Presence presence, OfficeMap map, SessionValidator sessions, VoiceGuard voice, RoomScreens screens,
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
        var (state, look) = await sessions.CheckWithLookAsync(authCookie, Context.ConnectionAborted);
        if (state == SessionState.Invalid)
        {
            await Clients.Caller.Kicked(SessionWatch.ExpiredReason);
            Context.Abort();
            return;
        }
        var name = Context.User?.FindFirstValue(ClaimNames.FullName) ?? Context.User?.Identity?.Name ?? "?";
        var p = new Player
        {
            UserId = UserId, Name = name, ConnectionId = Context.ConnectionId, Context = Context, AuthCookie = authCookie, Look = look,
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
            presence.All.Select(ToDto).ToArray()));
        await Clients.OthersInGroup(Room).PlayerJoined(ToDto(p));
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
        var before = RoomOf(p);
        lock (p)
        {
            p.X = x; p.Z = z; p.R = r; p.Anim = anim; p.Dirty = true;
            p.LastMoveTicks = now;
            p.LastActiveAt = clock.GetUtcNow();
        }
        // Vừa bước vào phòng có tường đang chiếu tài liệu → gửi ngay cho người này (client không phải đoán lúc server đã thấy mình trong phòng)
        if (RoomOf(p) is { } after && after.Id != before?.Id && screens.Get(after.Id) is { } screen)
            await Clients.Caller.ScreenChanged(after.Id, screen);
    }

    /// <summary>
    /// Client vừa lưu nhân vật qua REST (PUT /api/auth/avatar) → server tự hỏi lại Api bằng cookie của người chơi rồi phát
    /// LookChanged cho cả văn phòng. Không nhận ngoại hình từ client (Api đã kiểm tra theo danh mục). Tối đa 1 lần / 2 giây.
    /// </summary>
    public async Task RefreshLook()
    {
        if (!presence.TryGet(UserId, out var p) || p.ConnectionId != Context.ConnectionId) return;
        var now = clock.GetUtcNow();
        if (now - p.LastLookAt < TimeSpan.FromSeconds(2)) throw new HubException("Đổi nhân vật chậm lại một chút");
        p.LastLookAt = now;
        var (state, look) = await sessions.CheckWithLookAsync(p.AuthCookie, Context.ConnectionAborted);
        if (state != SessionState.Valid) throw new HubException("Chưa tải được nhân vật mới, thử lại sau");
        p.Look = look;
        await Clients.Group(Room).LookChanged(p.UserId, look);
    }

    private static PlayerDto ToDto(Player p) => new(p.UserId, p.Name, p.X, p.Z, p.R, p.Anim, p.Look);

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

    /// <summary>Tài liệu đang chiếu ở phòng có tường mình đang đứng (vào phòng → client hỏi); khu mở / chưa chiếu → null.</summary>
    public ScreenDto? GetScreen() =>
        presence.TryGet(UserId, out var p) && RoomOf(p) is { } room ? screens.Get(room.Id) : null;

    /// <summary>
    /// Chiếu tài liệu lên màn hình phòng có tường đang đứng. Server hỏi Api bằng cookie người chiếu (Api kiểm tra quyền xem + ghi nhật ký),
    /// rồi phát cho người đang ở trong phòng. Thay tài liệu đang chiếu (nếu có). Tối đa 1 lần / 3 giây.
    /// </summary>
    public async Task PinScreen(string assetId)
    {
        if (!presence.TryGet(UserId, out var p) || p.ConnectionId != Context.ConnectionId) return;
        if (!Guid.TryParse(assetId, out var id)) throw new HubException("Tài liệu không hợp lệ");
        var room = RoomOf(p) ?? throw new HubException("Vào một phòng có tường (phòng họp…) để chiếu tài liệu lên màn hình");
        var now = clock.GetUtcNow();
        if (now - p.LastScreenAt < TimeSpan.FromSeconds(3)) throw new HubException("Chiếu chậm lại một chút");
        p.LastScreenAt = now;
        var (screen, error) = await screens.FetchAsync(p.AuthCookie, id, room, p.Name, Context.ConnectionAborted);
        if (screen is null) throw new HubException(error ?? "Chưa chiếu được tài liệu");
        screens.Set(screen);
        await Clients.Clients(InRoom(room.Id)).ScreenChanged(room.Id, screen);
        log.LogInformation("{User} chiếu tài liệu {Asset} ở {Room}", p.Name, id, room.Name);
    }

    /// <summary>Tắt màn hình phòng đang đứng (ai trong phòng cũng tắt được).</summary>
    public async Task ClearScreen()
    {
        if (!presence.TryGet(UserId, out var p)) return;
        var room = RoomOf(p) ?? throw new HubException("Bạn không ở trong phòng nào");
        if (screens.Clear(room.Id)) await Clients.Clients(InRoom(room.Id)).ScreenChanged(room.Id, null);
    }

    private List<string> InRoom(string roomId) => presence.All.Where(o => RoomOf(o)?.Id == roomId).Select(o => o.ConnectionId).ToList();

    private Simulation.Room? RoomOf(Player p)
    {
        float x, z;
        lock (p) { x = p.X; z = p.Z; }
        return map.Rooms.FirstOrDefault(r => r.Walls && r.Contains(x, z));
    }
}
