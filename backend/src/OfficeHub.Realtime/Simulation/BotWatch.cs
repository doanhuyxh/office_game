using Microsoft.AspNetCore.SignalR;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.BuildingBlocks.Office;
using OfficeHub.Realtime.Hubs;

namespace OfficeHub.Realtime.Simulation;

/// <summary>Một sự kiện trong bảng xem trực tiếp — bản MessagePack của <see cref="BotActivityEvent"/> (At = chuỗi ISO UTC 'Z', CostUsd = double cho JS).</summary>
public sealed record BotWatchEventDto(string Id, string Kind, string? Title, string? Text, string? Path, string? Diff, string? Output,
    bool? Ok, string? Task, string? Model, int? Turns, double? CostUsd, long Seq, string At);

/// <summary>Trả về của <c>WatchBot</c>: đệm phiên hiện tại (≤ <see cref="BotActivityFeedRoute.BufferSize"/> sự kiện) + trạng thái đang làm / rảnh.</summary>
public sealed record BotWatchDto(string BotId, string Name, bool? Busy, string? Task, BotWatchEventDto[] Events);

/// <summary>
/// Lô đẩy cho người đang xem (gộp ≤ 4 lần / giây): sự kiện mới / cập nhật (cùng id + seq = thay) kèm trạng thái đang làm / rảnh hiện tại.
/// <paramref name="Cleared"/> = đệm của bot vừa bị xoá (rảnh quá lâu) → FE xoá bảng, chờ phiên mới.
/// </summary>
public sealed record BotActivityDto(string BotId, BotWatchEventDto[] Events, bool? Busy = null, string? Task = null, bool Cleared = false);

/// <summary>
/// Ai đang xem luồng hoạt động của bot nào (TEST-95). Văn phòng là không gian mở nên ai cũng bấm xem được, nhưng phải đứng trong
/// phạm vi nghe được của bot (<see cref="OfficeMap.CanHear"/> — luật voice, server kiểm, không tin client). Mỗi kết nối xem MỘT bot
/// (WatchBot khác = đổi). Sự kiện từ <see cref="BotActivityFeed.Appended"/> chỉ được XẾP HÀNG ở đây (không chặn khoá của feed);
/// <see cref="BotWatchGuard"/> gửi lô mỗi <see cref="FlushEvery"/> và kiểm phạm vi / offline mỗi giây.
/// </summary>
public sealed class BotWatch : IDisposable
{
    /// <summary>Đã đang xem thì nới thêm +1 m (6 → 7 m) và <see cref="Grace"/> (như VoiceGuard) rồi mới ngắt — tránh ngắt khi đi lướt qua mép.</summary>
    public static readonly TimeSpan Grace = TimeSpan.FromSeconds(3);
    public const double Slack = 1;
    /// <summary>Nhịp gộp gửi: 250 ms = tối đa 4 lô / giây cho một người xem.</summary>
    public static readonly TimeSpan FlushEvery = TimeSpan.FromMilliseconds(250);

    // Lý do trong BotWatchEnded
    public const string EndedRange = "range";     // người xem ra ngoài phạm vi / đổi kênh quá Grace
    public const string EndedOffline = "offline"; // bot offline hoặc người thật của tài khoản vào văn phòng
    public const string EndedLeft = "left";       // người xem rời hub (dọn sổ — kết nối thường đã đóng)

    private sealed class Watch
    {
        public required string ConnectionId { get; init; }
        public required string WatcherId { get; init; }
        public required string BotId { get; init; }
        public readonly List<BotActivityEvent> Pending = [];
        public bool ClearedPending;
        public (bool? Busy, string? Task) Sent;
        public DateTimeOffset? MismatchSince;
    }

    private readonly Presence _presence;
    private readonly BotPresence _bots;
    private readonly OfficeMap _map;
    private readonly BotActivityFeed _feed;
    private readonly Lock _lock = new();
    private readonly Dictionary<string, Watch> _byConnection = [];

    public BotWatch(Presence presence, BotPresence bots, OfficeMap map, BotActivityFeed feed)
    {
        (_presence, _bots, _map, _feed) = (presence, bots, map, feed);
        feed.Appended += OnAppended;
        feed.Cleared += OnCleared;
    }

    public void Dispose()
    {
        _feed.Appended -= OnAppended;
        _feed.Cleared -= OnCleared;
    }

    /// <summary>
    /// Bắt đầu xem (hub <c>WatchBot</c>). Người gọi phải đang trong hub, bot đang hiện trong 3D (người thật của tài khoản KHÔNG ở trong
    /// văn phòng) và trong phạm vi nghe được. Trả đệm hiện tại + trạng thái, hoặc lỗi tiếng Việt.
    /// </summary>
    public (BotWatchDto? Result, string? Error) Start(string connectionId, string watcherId, string botUserId)
    {
        if (!_presence.TryGet(watcherId, out var viewer) || viewer.ConnectionId != connectionId)
            return (null, "Hãy vào văn phòng 3D trước khi xem bot");
        if (string.IsNullOrWhiteSpace(botUserId) || !_bots.TryGet(botUserId, out var bot) || _presence.TryGet(botUserId, out _))
            return (null, "Người này không phải bot đang hiện trong văn phòng");
        float vx, vz;
        lock (viewer) (vx, vz) = (viewer.X, viewer.Z);
        if (!_map.CanHear(vx, vz, bot.X, bot.Z)) return (null, "Hãy lại gần hơn để xem");
        lock (_lock)
            _byConnection[connectionId] = new Watch { ConnectionId = connectionId, WatcherId = watcherId, BotId = botUserId, Sent = (bot.Busy, bot.Task) };
        // Snapshot lấy NGOÀI _lock: chiều khoá luôn là "khoá feed → _lock" (OnAppended), không tạo chiều ngược. Sự kiện tới giữa hai bước
        // có thể vừa trong snapshot vừa trong lô kế — cùng id + seq nên client thay theo id, không trùng dòng.
        var events = _feed.Snapshot(botUserId).Select(ToDto).ToArray();
        return (new BotWatchDto(botUserId, bot.Name, bot.Busy, bot.Task, events), null);
    }

    /// <summary>Thôi xem (hub <c>UnwatchBot</c> / người xem ngắt kết nối).</summary>
    public bool Stop(string connectionId)
    {
        lock (_lock) return _byConnection.Remove(connectionId);
    }

    /// <summary>Gom các lô cần gửi (gọi mỗi <see cref="FlushEvery"/>): sự kiện chờ, trạng thái đang làm / rảnh vừa đổi, đệm vừa bị xoá.</summary>
    public List<(string ConnectionId, BotActivityDto Push)> Flush()
    {
        var pushes = new List<(string, BotActivityDto)>();
        lock (_lock)
        {
            foreach (var w in _byConnection.Values)
            {
                var state = _bots.TryGet(w.BotId, out var bot) ? (bot.Busy, bot.Task) : w.Sent;
                if (w.Pending.Count == 0 && !w.ClearedPending && state == w.Sent) continue;
                pushes.Add((w.ConnectionId, new BotActivityDto(w.BotId, [.. w.Pending.Select(ToDto)], state.Busy, state.Task, w.ClearedPending)));
                w.Pending.Clear();
                w.ClearedPending = false;
                w.Sent = state;
            }
        }
        return pushes;
    }

    /// <summary>
    /// Kiểm mỗi giây (<see cref="BotWatchGuard"/>, không kiểm trên mỗi Move): người xem rời hub, bot offline / người thật của tài khoản
    /// vào văn phòng → ngắt ngay; ra ngoài phạm vi +<see cref="Slack"/> m hoặc đổi kênh quá <see cref="Grace"/> → ngắt. Trả các phiên đã ngắt.
    /// </summary>
    public List<(string ConnectionId, string BotId, string Reason)> Sweep(DateTimeOffset now)
    {
        var ended = new List<(string, string, string)>();
        lock (_lock)
        {
            foreach (var w in _byConnection.Values.ToList())
            {
                if (!_presence.TryGet(w.WatcherId, out var viewer) || viewer.ConnectionId != w.ConnectionId) { End(w, EndedLeft, ended); continue; }
                if (!_bots.TryGet(w.BotId, out var bot) || _presence.TryGet(w.BotId, out _)) { End(w, EndedOffline, ended); continue; }
                float vx, vz;
                lock (viewer) (vx, vz) = (viewer.X, viewer.Z);
                if (_map.CanHear(vx, vz, bot.X, bot.Z, Slack)) { w.MismatchSince = null; continue; }
                w.MismatchSince ??= now;
                if (now - w.MismatchSince >= Grace) End(w, EndedRange, ended);
            }
        }
        return ended;
    }

    private void End(Watch w, string reason, List<(string, string, string)> ended)
    {
        _byConnection.Remove(w.ConnectionId);
        ended.Add((w.ConnectionId, w.BotId, reason));
    }

    /// <summary>Gọi trong khoá của bot ở feed — chỉ xếp hàng, không gửi / không chặn. Cùng id đang chờ → thay (giữ thứ tự).</summary>
    private void OnAppended(string userId, BotActivityEvent e)
    {
        lock (_lock)
        {
            foreach (var w in _byConnection.Values)
            {
                if (w.BotId != userId) continue;
                var i = w.Pending.FindIndex(x => x.Id == e.Id);
                if (i >= 0) w.Pending[i] = e;
                else w.Pending.Add(e);
            }
        }
    }

    /// <summary>Đệm của bot bị xoá (rảnh quá lâu — offline thì <see cref="Sweep"/> ngắt hẳn): báo người xem xoá bảng.</summary>
    private void OnCleared(string userId)
    {
        lock (_lock)
        {
            foreach (var w in _byConnection.Values)
            {
                if (w.BotId != userId) continue;
                w.Pending.Clear();
                w.ClearedPending = true;
            }
        }
    }

    private static BotWatchEventDto ToDto(BotActivityEvent e) => new(e.Id, e.Kind, e.Title, e.Text, e.Path, e.Diff, e.Output, e.Ok,
        e.Task, e.Model, e.Turns, (double?)e.CostUsd, e.Seq, e.At is { } at ? Instants.Format(at) : "");
}

/// <summary>
/// Nhịp của luồng xem bot (TEST-95): mỗi <see cref="BotWatch.FlushEvery"/> gửi lô sự kiện chờ cho người đang xem (≤ 4 lần / giây);
/// mỗi giây (mỗi 4 nhịp) kiểm phạm vi / offline như VoiceGuard rồi báo <c>BotWatchEnded</c>.
/// </summary>
public sealed class BotWatchGuard(BotWatch watch, IHubContext<OfficeRoomHub, IOfficeClient> hub, TimeProvider clock, ILogger<BotWatchGuard> log)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        using var timer = new PeriodicTimer(BotWatch.FlushEvery);
        var tick = 0;
        while (await timer.WaitForNextTickAsync(ct))
        {
            try
            {
                if (++tick % 4 == 0)
                    foreach (var (conn, botId, reason) in watch.Sweep(clock.GetUtcNow()))
                        await hub.Clients.Client(conn).BotWatchEnded(botId, reason);
                foreach (var (conn, push) in watch.Flush())
                    await hub.Clients.Client(conn).BotActivity(push);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "Lỗi phát luồng xem bot");
            }
        }
    }
}
