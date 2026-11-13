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
    /// <summary>Mọi bot dự đều bỏ lượt (TEST-75 dùng).</summary>
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
    public int TurnsUsed { get; set; }
    public int MaxTurns { get; set; }
    public int MaxMinutes { get; set; }
    public DateTimeOffset StartedAt { get; set; }
    public DateTimeOffset? EndedAt { get; set; }
    public List<AgentMeetingBot> Bots { get; set; } = [];

    public DateTimeOffset ExpiresAt => StartedAt.AddMinutes(MaxMinutes);

    public void End(AgentMeetingEndReason reason, DateTimeOffset now, string? byName = null)
    {
        Status = AgentMeetingStatus.Ended;
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
