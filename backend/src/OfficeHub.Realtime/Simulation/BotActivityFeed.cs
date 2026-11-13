using OfficeHub.BuildingBlocks.Office;

namespace OfficeHub.Realtime.Simulation;

/// <summary>
/// Luồng "agent đang làm gì" theo bot (TEST-92): vòng đệm <see cref="BotActivityFeedRoute.BufferSize"/> sự kiện gần nhất của PHIÊN HIỆN TẠI, chỉ trong RAM.
/// <c>session_start</c> → xoá đệm cũ rồi ghi; <c>session_end</c> → báo người xem rồi xoá đệm; bot offline (<see cref="BotSweeper"/>) hoặc
/// <see cref="Idle"/> không có sự kiện mới → xoá đệm. Thread-safe (khoá theo bot). Hub xem trực tiếp nghe <see cref="Appended"/> / <see cref="Cleared"/>
/// (<see cref="Appended"/> gọi trong khoá của bot để giữ đúng thứ tự seq — người nghe chỉ xếp hàng gửi, không chặn).
/// </summary>
public sealed class BotActivityFeed
{
    public static readonly TimeSpan Idle = TimeSpan.FromMinutes(BotActivityRoute.OnlineMinutes);

    private sealed class Feed
    {
        public readonly List<BotActivityEvent> Events = [];
        public long Seq;
        public DateTimeOffset LastAt;
    }

    private readonly System.Collections.Concurrent.ConcurrentDictionary<string, Feed> _feeds = new();

    /// <summary>Sự kiện mới hoặc đã cập nhật (cùng id → cùng seq, người xem thay theo id). <c>session_end</c> cũng phát qua đây.</summary>
    public event Action<string, BotActivityEvent>? Appended;
    /// <summary>Đệm của bot vừa bị xoá (offline / rảnh quá lâu) — người xem đóng bảng / hiện "không hoạt động".</summary>
    public event Action<string>? Cleared;

    /// <summary>Bản sao đệm hiện tại (theo seq tăng dần) — cho người mới mở bảng xem.</summary>
    public IReadOnlyList<BotActivityEvent> Snapshot(string userId)
    {
        if (!_feeds.TryGetValue(userId, out var f)) return [];
        lock (f) return f.Events.ToList();
    }

    /// <summary>Ghi các sự kiện đã làm sạch (<see cref="Clean"/>) của một bot; trả về sự kiện kèm seq / giờ server theo thứ tự nhận.</summary>
    public IReadOnlyList<BotActivityEvent> Append(string userId, IEnumerable<BotActivityEvent> events, DateTimeOffset now)
    {
        var f = _feeds.GetOrAdd(userId, _ => new Feed());
        var result = new List<BotActivityEvent>();
        lock (f)
        {
            f.LastAt = now;
            foreach (var e in events)
            {
                if (e.Kind == BotActivityFeedRoute.SessionEnd)
                {
                    result.Add(e with { Seq = ++f.Seq, At = now }); // báo người xem, không giữ
                    f.Events.Clear();
                    continue;
                }
                if (e.Kind == BotActivityFeedRoute.SessionStart) f.Events.Clear();
                var i = f.Events.FindIndex(x => x.Id == e.Id);
                BotActivityEvent saved;
                if (i >= 0) saved = f.Events[i] = Merge(f.Events[i], e);
                else
                {
                    saved = e with { Seq = ++f.Seq, At = now };
                    f.Events.Add(saved);
                    if (f.Events.Count > BotActivityFeedRoute.BufferSize) f.Events.RemoveRange(0, f.Events.Count - BotActivityFeedRoute.BufferSize);
                }
                result.Add(saved);
            }
            // Gọi trong khoá của bot: người nghe nhận đúng thứ tự seq (người nghe chỉ được xếp hàng gửi, không chặn)
            foreach (var e in result) Appended?.Invoke(userId, e);
        }
        return result;
    }

    /// <summary>Cập nhật theo id: trường null giữ giá trị cũ; giữ seq + giờ của sự kiện gốc.</summary>
    private static BotActivityEvent Merge(BotActivityEvent old, BotActivityEvent e) => old with
    {
        Kind = e.Kind,
        Title = e.Title ?? old.Title,
        Text = e.Text ?? old.Text,
        Path = e.Path ?? old.Path,
        Diff = e.Diff ?? old.Diff,
        Output = e.Output ?? old.Output,
        Ok = e.Ok ?? old.Ok,
        Task = e.Task ?? old.Task,
        Model = e.Model ?? old.Model,
        Turns = e.Turns ?? old.Turns,
        CostUsd = e.CostUsd ?? old.CostUsd,
    };

    /// <summary>Xoá đệm của bot (offline). Trả về true nếu đệm đang có sự kiện.</summary>
    public bool Clear(string userId)
    {
        if (!_feeds.TryRemove(userId, out var f)) return false;
        bool had;
        lock (f) had = f.Events.Count > 0;
        if (had) Cleared?.Invoke(userId);
        return had;
    }

    /// <summary>Gọi định kỳ từ <see cref="BotSweeper"/>: bot không có sự kiện mới quá <see cref="Idle"/> → xoá đệm.</summary>
    public List<string> Sweep(DateTimeOffset now)
    {
        var gone = new List<string>();
        foreach (var (userId, f) in _feeds)
        {
            bool stale;
            lock (f) stale = now - f.LastAt > Idle;
            if (stale && Clear(userId)) gone.Add(userId);
        }
        return gone;
    }

    /// <summary>
    /// Kiểm + làm sạch một sự kiện từ bên gửi: thiếu id / <c>kind</c> lạ → null + lý do (400). Quá độ dài → CẮT (không từ chối);
    /// bỏ ký tự điều khiển (trừ xuống dòng / tab ở trường nhiều dòng); trường một dòng gộp xuống dòng thành dấu cách. Seq / at bên gửi đặt bị bỏ.
    /// </summary>
    public static BotActivityEvent? Clean(BotActivityEvent? e, out string? error)
    {
        error = null;
        if (e is null) { error = "Sự kiện rỗng"; return null; }
        if (e.Kind is null || !BotActivityFeedRoute.Kinds.Contains(e.Kind))
        {
            error = $"kind không hợp lệ: \"{Cut(Line(e.Kind) ?? "", 40)}\" (cho phép: {string.Join(", ", BotActivityFeedRoute.Kinds)})";
            return null;
        }
        if (Line(e.Id) is not { } id) { error = "Thiếu id sự kiện"; return null; }
        return new BotActivityEvent(
            Cut(id, BotActivityFeedRoute.MaxId), e.Kind,
            Title: Cut(Line(e.Title), BotActivityFeedRoute.MaxTitle),
            Text: Cut(Multi(e.Text), BotActivityFeedRoute.MaxText),
            Path: Cut(Line(e.Path), BotActivityFeedRoute.MaxPath),
            Diff: CutDiff(Multi(e.Diff)),
            Output: CutTail(Multi(e.Output), BotActivityFeedRoute.MaxOutput),
            Ok: e.Ok,
            Task: Cut(Line(e.Task), BotActivityFeedRoute.MaxTask),
            Model: Cut(Line(e.Model), BotActivityFeedRoute.MaxModel),
            Turns: e.Turns is >= 0 ? e.Turns : null,
            CostUsd: e.CostUsd is >= 0 ? e.CostUsd : null);
    }

    /// <summary>Nhiều dòng: bỏ ký tự điều khiển trừ \n / \t (cả \r); rỗng → null. Không trim (khoảng trắng đầu dòng của diff / output có nghĩa).</summary>
    private static string? Multi(string? s)
    {
        if (string.IsNullOrEmpty(s)) return null;
        var r = new string(s.Where(c => c is '\n' or '\t' || !char.IsControl(c)).ToArray());
        return r.Trim().Length == 0 ? null : r;
    }

    /// <summary>Một dòng: mọi ký tự điều khiển (kể cả xuống dòng / tab) → dấu cách, trim; rỗng → null.</summary>
    private static string? Line(string? s)
    {
        if (string.IsNullOrEmpty(s)) return null;
        var r = new string(s.Select(c => char.IsControl(c) ? ' ' : c).ToArray()).Trim();
        return r.Length == 0 ? null : r;
    }

    [return: System.Diagnostics.CodeAnalysis.NotNullIfNotNull(nameof(s))]
    private static string? Cut(string? s, int max) => s is null || s.Length <= max ? s : s[..(max - 1)] + "…";

    private static string? CutTail(string? s, int max) => s is null || s.Length <= max ? s : "…" + s[^(max - 1)..];

    private static string? CutDiff(string? s)
    {
        if (s is null) return null;
        var lines = s.Split('\n');
        if (lines.Length > BotActivityFeedRoute.MaxDiffLines)
            s = string.Join('\n', lines.Take(BotActivityFeedRoute.MaxDiffLines - 1)) + "\n…";
        return Cut(s, BotActivityFeedRoute.MaxDiffChars);
    }
}
