using System.Text.Json.Serialization;
using OfficeHub.BuildingBlocks.Auditing;

namespace OfficeHub.Modules.Meetings.Domain;

[JsonConverter(typeof(JsonStringEnumConverter<AgentMeetingStatus>))]
public enum AgentMeetingStatus { Active, Ended }

/// <summary>Lý do kết thúc phiên họp agent.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<AgentMeetingEndReason>))]
public enum AgentMeetingEndReason
{
    /// <summary>Người mở (hoặc HR / admin) bấm dừng.</summary>
    Stopped,
    /// <summary>Dùng hết trần lượt phát biểu.</summary>
    TurnLimit,
    /// <summary>Hết trần phút (job nền kết thúc).</summary>
    TimeLimit,
    /// <summary>Không còn ai phát biểu: bot chủ trì bỏ lượt (hoặc hết giờ chờ) mà không chỉ định ai, không còn bot nào chờ lượt (TEST-75).</summary>
    AllPassed,
}

/// <summary>
/// Phiên họp agent trong một phòng họp (TEST-74): chỉ người thật mở / dừng; bot chủ trì điều phối lượt nói giữa các bot dự.
/// Trần lượt + trần phút chụp lại từ <see cref="AgentMeetingSettings"/> lúc mở (admin đổi sau không ảnh hưởng phiên đang chạy).
/// Mỗi phòng tối đa một phiên <see cref="AgentMeetingStatus.Active"/> (index unique một phần + khoá theo phòng khi mở).
/// </summary>
public sealed class AgentMeeting
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    /// <summary>Id phòng trong shared/office-map.json (rooms[kind = meeting]).</summary>
    public required string RoomId { get; set; }
    public required string Topic { get; set; }
    public Guid OpenedByEmployeeId { get; set; }
    public Guid OpenedByUserId { get; set; }
    public required string OpenedByName { get; set; }
    public Guid ChairEmployeeId { get; set; }
    public AgentMeetingStatus Status { get; set; } = AgentMeetingStatus.Active;
    public AgentMeetingEndReason? EndReason { get; set; }
    public string? EndedByName { get; set; }
    /// <summary>Lượt đã dùng: mỗi lần một bot giữ lượt rồi kết thúc lượt (nói một tin / bỏ lượt / chỉ định người khác / hết giờ chờ) — TEST-75.</summary>
    public int TurnsUsed { get; set; }
    /// <summary>Bot đang giữ lượt nói (null khi đã kết thúc). Mở họp → bot chủ trì.</summary>
    public Guid? CurrentSpeakerEmployeeId { get; set; }
    /// <summary>Lúc bot hiện tại nhận lượt — quá <see cref="AgentMeetingTurnRules.TurnTimeout"/> chưa nói → coi như bỏ lượt.</summary>
    public DateTimeOffset? TurnStartedAt { get; set; }
    /// <summary>Bot chờ lượt theo thứ tự được @nhắc (nhắc nhiều người → lần lượt); hết hàng → lượt về bot chủ trì.</summary>
    public List<Guid> QueuedSpeakerIds { get; set; } = [];
    public int MaxTurns { get; set; }
    public int MaxMinutes { get; set; }
    public DateTimeOffset StartedAt { get; set; }
    public DateTimeOffset? EndedAt { get; set; }
    public List<AgentMeetingBot> Bots { get; set; } = [];

    public DateTimeOffset ExpiresAt => StartedAt.AddMinutes(MaxMinutes);

    public DateTimeOffset? TurnDeadline => Status == AgentMeetingStatus.Active ? TurnStartedAt?.Add(AgentMeetingTurnRules.TurnTimeout) : null;

    public void End(AgentMeetingEndReason reason, DateTimeOffset now, string? byName = null)
    {
        Status = AgentMeetingStatus.Ended;
        CurrentSpeakerEmployeeId = null;
        TurnStartedAt = null;
        QueuedSpeakerIds = [];
        EndReason = reason;
        EndedAt = now;
        EndedByName = byName;
    }
}

/// <summary>Bot dự họp (kể cả bot chủ trì). Tên chụp lại lúc mở.</summary>
public sealed class AgentMeetingBot
{
    public Guid MeetingId { get; set; }
    public Guid EmployeeId { get; set; }
    public Guid UserId { get; set; }
    public required string Name { get; set; }
}

/// <summary>Trần mỗi phiên họp agent do admin chỉnh (bảng một dòng <see cref="SingletonId"/>); chưa có dòng → mặc định 30 lượt / 30 phút.</summary>
[Audited]
public sealed class AgentMeetingSettings
{
    public const int SingletonId = 1;
    public int Id { get; set; } = SingletonId;
    public int MaxTurns { get; set; }
    public int MaxMinutes { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public string? UpdatedByName { get; set; }
}

/// <summary>Bot được chọn dự họp sau khi tra hồ sơ + tài khoản (null trong lookup = không tìm thấy nhân viên).</summary>
public sealed record BotCandidate(Guid EmployeeId, string Name, Guid? UserId, bool IsActive, bool IsBot);

/// <summary>Quy tắc phiên họp agent — hàm thuần, test ở tests/OfficeHub.Modules.Meetings.Tests.</summary>
public static class AgentMeetingRules
{
    public const int DefaultMaxTurns = 30;
    public const int DefaultMaxMinutes = 30;
    public const int TurnsMin = 2, TurnsMax = 200;
    public const int MinutesMin = 5, MinutesMax = 240;
    public const int MinBots = 2, MaxBots = 8;
    public const int TopicMaxLength = 300;
    public static readonly TimeSpan ExpiryInterval = TimeSpan.FromMinutes(1);

    /// <summary>Lỗi theo field khi mở phiên (rỗng = hợp lệ). <paramref name="botIds"/> đã bỏ trùng.</summary>
    public static List<(string Field, string Message)> ValidateOpen(string? topic, Guid chairId, IReadOnlyList<Guid> botIds,
        IReadOnlyDictionary<Guid, BotCandidate> lookup)
    {
        var e = new List<(string, string)>();
        if (string.IsNullOrWhiteSpace(topic)) e.Add(("topic", "Chủ đề là bắt buộc"));
        else if (topic.Trim().Length > TopicMaxLength) e.Add(("topic", $"Chủ đề tối đa {TopicMaxLength} ký tự"));
        if (botIds.Count < MinBots) e.Add(("botIds", $"Cần ít nhất {MinBots} bot dự họp"));
        else if (botIds.Count > MaxBots) e.Add(("botIds", $"Tối đa {MaxBots} bot mỗi cuộc họp"));
        if (botIds.Count is >= MinBots and <= MaxBots)
            foreach (var id in botIds)
            {
                if (!lookup.TryGetValue(id, out var c)) { e.Add(("botIds", "Có người dự không tồn tại")); break; }
                if (!c.IsBot || c.UserId is null) { e.Add(("botIds", $"{c.Name} không phải tài khoản bot")); break; }
                if (!c.IsActive) { e.Add(("botIds", $"{c.Name} đã nghỉ việc hoặc bị khoá")); break; }
            }
        if (!botIds.Contains(chairId)) e.Add(("chairEmployeeId", "Bot chủ trì phải nằm trong danh sách dự họp"));
        return e;
    }

    public static List<(string Field, string Message)> ValidateLimits(int maxTurns, int maxMinutes)
    {
        var e = new List<(string, string)>();
        if (maxTurns is < TurnsMin or > TurnsMax) e.Add(("maxTurns", $"Trần lượt từ {TurnsMin} đến {TurnsMax}"));
        if (maxMinutes is < MinutesMin or > MinutesMax) e.Add(("maxMinutes", $"Trần phút từ {MinutesMin} đến {MinutesMax}"));
        return e;
    }

    /// <summary>Phiên đang họp đã chạm trần (lượt trước, rồi thời gian) → lý do kết thúc; còn trong trần → null.</summary>
    public static AgentMeetingEndReason? LimitReached(AgentMeeting m, DateTimeOffset now) =>
        m.Status != AgentMeetingStatus.Active ? null
        : m.TurnsUsed >= m.MaxTurns ? AgentMeetingEndReason.TurnLimit
        : now >= m.ExpiresAt ? AgentMeetingEndReason.TimeLimit
        : null;
}

/// <summary>Kết quả một lần chuyển lượt: <see cref="Next"/> = bot vừa nhận lượt (cần đánh thức), <see cref="Ended"/> = phiên vừa kết thúc.</summary>
public sealed record TurnChange(Guid? Next, AgentMeetingEndReason? Ended)
{
    public static readonly TurnChange None = new(null, null);
}

/// <summary>
/// Chia lượt nói trong phiên họp agent (TEST-75, chủ dự án chốt 2026-11-13) — hàm thuần trên <see cref="AgentMeeting"/>, test ở
/// tests/OfficeHub.Modules.Meetings.Tests/AgentMeetingTurnRulesTests.cs. Mỗi lúc chỉ một bot giữ lượt; mỗi lượt một tin.
/// <list type="bullet">
/// <item>Mở họp → lượt đầu thuộc bot chủ trì.</item>
/// <item>Bot giữ lượt nói: tính 1 lượt; @nhắc bot dự họp → các bot đó lần lượt theo thứ tự nhắc (xếp trước hàng chờ cũ); không nhắc ai → bot kế trong hàng chờ, hết hàng → bot chủ trì.</item>
/// <item>Bỏ lượt / hết giờ chờ: tính 1 lượt; bot kế trong hàng chờ, hết hàng → bot chủ trì; chính bot chủ trì bỏ lượt khi hàng trống → kết thúc (<see cref="AgentMeetingEndReason.AllPassed"/>).</item>
/// <item>Bot chủ trì chỉ định (API) khi đang giữ lượt: tính 1 lượt, lượt sang bot được chỉ định.</item>
/// <item>Người thật @nhắc bot dự họp: không tính lượt; bot được nhắc đầu tiên nhận lượt ngay, các bot nhắc sau rồi bot vừa bị ngắt lượt xếp đầu hàng chờ.</item>
/// <item>Sau mỗi lần tính lượt: chạm trần lượt / phút → kết thúc (<see cref="AgentMeetingRules.LimitReached"/>).</item>
/// </list>
/// Tính cả bỏ lượt / chỉ định / hết giờ chờ (không chỉ tin nói) để vòng "chỉ định ↔ bỏ lượt" giữa các bot cũng chạm trần.
/// </summary>
public static class AgentMeetingTurnRules
{
    /// <summary>Bot giữ lượt mà không nói trong khoảng này → coi như bỏ lượt (job nền kiểm tra mỗi phút).</summary>
    public static readonly TimeSpan TurnTimeout = TimeSpan.FromMinutes(3);

    /// <summary>Mở họp: lượt đầu thuộc bot chủ trì.</summary>
    public static TurnChange Start(AgentMeeting m, DateTimeOffset now)
    {
        m.QueuedSpeakerIds = [];
        Grant(m, m.ChairEmployeeId, now);
        return new(m.ChairEmployeeId, null);
    }

    /// <summary>Bot dự họp <paramref name="botId"/> có được nói / bỏ lượt lúc này không — null = được, còn lại = lý do (409).</summary>
    public static string? CanAct(AgentMeeting m, Guid botId)
    {
        if (m.Status != AgentMeetingStatus.Active) return "Cuộc họp đã kết thúc";
        if (m.CurrentSpeakerEmployeeId == botId) return null;
        var holder = m.Bots.FirstOrDefault(b => b.EmployeeId == m.CurrentSpeakerEmployeeId)?.Name ?? "bot khác";
        return $"Chưa tới lượt của bạn — đang là lượt của {holder}. Đợi được đánh thức (meeting_turn) rồi mới nói";
    }

    /// <summary>Bot giữ lượt vừa nói một tin, @nhắc <paramref name="mentioned"/> (bot dự họp, theo thứ tự nhắc).</summary>
    public static TurnChange Spoke(AgentMeeting m, Guid speakerId, IReadOnlyList<Guid> mentioned, DateTimeOffset now)
    {
        if (CanAct(m, speakerId) is not null) return TurnChange.None;
        m.TurnsUsed++;
        var queue = Attendees(m, mentioned).Where(id => id != speakerId).ToList();
        foreach (var id in m.QueuedSpeakerIds) if (!queue.Contains(id)) queue.Add(id);
        m.QueuedSpeakerIds = queue;
        return Advance(m, now, chairPassed: false);
    }

    /// <summary>Bot giữ lượt bỏ lượt (hoặc hết giờ chờ — <see cref="TimedOut"/>).</summary>
    public static TurnChange Passed(AgentMeeting m, Guid botId, DateTimeOffset now)
    {
        if (CanAct(m, botId) is not null) return TurnChange.None;
        m.TurnsUsed++;
        return Advance(m, now, chairPassed: botId == m.ChairEmployeeId);
    }

    /// <summary>Lỗi khi bot chủ trì <paramref name="byId"/> chỉ định <paramref name="targetId"/> (null = hợp lệ).</summary>
    public static string? CanAssign(AgentMeeting m, Guid byId, Guid targetId)
    {
        if (byId != m.ChairEmployeeId) return "Chỉ bot chủ trì được chỉ định lượt nói";
        if (CanAct(m, byId) is { } err) return err;
        if (targetId == m.ChairEmployeeId) return "Đang là lượt của bạn — nói luôn thay vì tự chỉ định";
        return m.Bots.Any(b => b.EmployeeId == targetId) ? null : "Bot được chỉ định không dự cuộc họp này";
    }

    /// <summary>Bot chủ trì (đang giữ lượt) chỉ định <paramref name="targetId"/> nói tiếp — gọi sau <see cref="CanAssign"/>.</summary>
    public static TurnChange Assigned(AgentMeeting m, Guid targetId, DateTimeOffset now)
    {
        m.TurnsUsed++;
        if (AgentMeetingRules.LimitReached(m, now) is { } reason) { m.End(reason, now); return new(null, reason); }
        m.QueuedSpeakerIds = m.QueuedSpeakerIds.Where(id => id != targetId).ToList();
        Grant(m, targetId, now);
        return new(targetId, null);
    }

    /// <summary>Người thật nhắn vào kênh phòng: @nhắc bot dự họp → bot nhắc đầu tiên nhận lượt ngay (không tính lượt); không nhắc → không đổi.</summary>
    public static TurnChange HumanSpoke(AgentMeeting m, IReadOnlyList<Guid> mentioned, DateTimeOffset now)
    {
        if (m.Status != AgentMeetingStatus.Active) return TurnChange.None;
        var picked = Attendees(m, mentioned).ToList();
        if (picked.Count == 0) return TurnChange.None;
        var queue = picked.Skip(1).ToList();
        // Bot đang giữ lượt bị ngắt → chưa nói nên xếp lại ngay sau các bot người thật vừa nhắc (không mất lượt)
        if (m.CurrentSpeakerEmployeeId is { } holder && holder != picked[0] && !queue.Contains(holder)) queue.Add(holder);
        foreach (var id in m.QueuedSpeakerIds) if (!queue.Contains(id) && id != picked[0]) queue.Add(id);
        m.QueuedSpeakerIds = queue;
        Grant(m, picked[0], now);
        return new(picked[0], null);
    }

    /// <summary>Bot giữ lượt đã quá <see cref="TurnTimeout"/> chưa nói.</summary>
    public static bool TimedOut(AgentMeeting m, DateTimeOffset now) =>
        m.Status == AgentMeetingStatus.Active && m.TurnStartedAt is { } t && now - t >= TurnTimeout;

    /// <summary>Tin hệ thống báo mở họp trong kênh phòng (TEST-83): người mở, chủ đề, bot chủ trì, trần đã chụp.</summary>
    public static string OpenNotice(AgentMeeting m) =>
        $"{m.OpenedByName} mở cuộc họp agent \"{m.Topic}\" — chủ trì: {m.Bots.FirstOrDefault(b => b.EmployeeId == m.ChairEmployeeId)?.Name ?? "bot chủ trì"}, " +
        $"{m.Bots.Count} bot dự, tối đa {m.MaxTurns} lượt / {m.MaxMinutes} phút.";

    /// <summary>Tin hệ thống báo kết thúc trong kênh phòng.</summary>
    public static string EndNotice(AgentMeeting m) => $"Cuộc họp agent \"{m.Topic}\" đã kết thúc: " + m.EndReason switch
    {
        AgentMeetingEndReason.Stopped => $"{m.EndedByName ?? "người mở"} dừng cuộc họp.",
        AgentMeetingEndReason.TurnLimit => $"đã dùng hết {m.MaxTurns} lượt phát biểu.",
        AgentMeetingEndReason.TimeLimit => $"hết {m.MaxMinutes} phút.",
        AgentMeetingEndReason.AllPassed => "không còn ai phát biểu (bot chủ trì bỏ lượt, không chỉ định ai).",
        _ => "đã đóng.",
    };

    private static TurnChange Advance(AgentMeeting m, DateTimeOffset now, bool chairPassed)
    {
        if (AgentMeetingRules.LimitReached(m, now) is { } reason) { m.End(reason, now); return new(null, reason); }
        Guid next;
        if (m.QueuedSpeakerIds.Count > 0) { next = m.QueuedSpeakerIds[0]; m.QueuedSpeakerIds = m.QueuedSpeakerIds.Skip(1).ToList(); }
        else if (chairPassed) { m.End(AgentMeetingEndReason.AllPassed, now); return new(null, AgentMeetingEndReason.AllPassed); }
        else next = m.ChairEmployeeId;
        Grant(m, next, now);
        return new(next, null);
    }

    private static void Grant(AgentMeeting m, Guid botId, DateTimeOffset now)
    {
        m.CurrentSpeakerEmployeeId = botId;
        m.TurnStartedAt = now;
    }

    /// <summary>Chỉ bot dự họp, bỏ trùng, giữ thứ tự.</summary>
    private static IEnumerable<Guid> Attendees(AgentMeeting m, IReadOnlyList<Guid> ids) =>
        ids.Where(id => m.Bots.Any(b => b.EmployeeId == id)).Distinct();
}
