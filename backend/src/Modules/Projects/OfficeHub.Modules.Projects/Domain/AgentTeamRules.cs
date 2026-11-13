using OfficeHub.BuildingBlocks.Text;

namespace OfficeHub.Modules.Projects.Domain;

/// <summary>Giới hạn đội agent đang áp dụng (TEST-36).</summary>
public sealed record AgentLimits(int TasksPerDay, int Streak)
{
    public static readonly AgentLimits Default = new(50, 10);
}

/// <summary>Một sự kiện trên việc (lịch sử hoặc bình luận) để tính chuỗi thao tác liên tiếp của bot.</summary>
/// <param name="Counts">Có tính vào chuỗi không (chuyển trạng thái / giao người / bình luận; tạo / sửa nội dung thì không) — sự kiện của người thật luôn ngắt chuỗi.</param>
public readonly record struct TaskEvent(DateTimeOffset At, bool ByBot, bool Counts);

/// <summary>
/// Rào chắn cho đội agent phối hợp qua bảng việc (2026-11-11, phương án đề xuất — chủ dự án nói "triển khai đi" không chốt từng điểm):
/// <list type="bullet">
/// <item>Thao tác qua token AI KHÔNG BAO GIỜ duyệt: không chuyển việc vào / ra cột cần người duyệt, kể cả khi tài khoản là quản lý dự án / HR.</item>
/// <item>Mỗi tài khoản tạo tối đa <see cref="AgentLimits.TasksPerDay"/> việc / ngày qua token AI (chặn bot sinh việc hàng loạt).</item>
/// <item>Một việc qua tay bot (chuyển trạng thái / giao người / bình luận) tới <see cref="AgentLimits.Streak"/> lần liên tiếp mà không có người thật
///       thao tác / bình luận → bot bị chặn trên việc đó cho tới khi có người xem (chặn hai bot chuyền qua lại vô tận).</item>
/// <item>@mã-nhân-viên trong bình luận → báo người được nhắc (phải là thành viên dự án).</item>
/// </list>
/// Hai giới hạn do quản trị viên chỉnh ở trang Hệ thống (TEST-36, bảng <c>projects.agent_settings</c>); chưa chỉnh → <see cref="AgentLimits.Default"/>.
/// Hàm thuần — test: tests/OfficeHub.Modules.Projects.Tests/AgentTeamRulesTests.cs.
/// </summary>
public static class AgentTeamRules
{
    public const int MaxMentions = 10;
    public const int TasksPerDayMin = 1, TasksPerDayMax = 500;
    public const int StreakMin = 1, StreakMax = 100;

    public static string TaskQuotaMessage(int limit) => $"Đã tạo {limit} việc qua trợ lý AI hôm nay — đợi ngày mai hoặc tạo trên web";
    public static string StreakMessage(int limit) => $"Việc đã qua tay bot {limit} lần liên tiếp — cần người thật xem (bình luận hoặc chuyển trạng thái trên web) trước khi bot làm tiếp";

    public static bool TaskQuotaLeft(int createdToday, int limit) => createdToday < limit;

    /// <summary>Lỗi khi admin đặt giới hạn (rỗng = hợp lệ): khoá theo tên trường camelCase của API.</summary>
    public static Dictionary<string, string> LimitErrors(int tasksPerDay, int streak)
    {
        var e = new Dictionary<string, string>();
        if (tasksPerDay is < TasksPerDayMin or > TasksPerDayMax) e["maxBotTasksPerDay"] = $"Số việc / ngày phải từ {TasksPerDayMin} đến {TasksPerDayMax}";
        if (streak is < StreakMin or > StreakMax) e["maxBotStreak"] = $"Số lần liên tiếp phải từ {StreakMin} đến {StreakMax}";
        return e;
    }

    /// <summary>Số thao tác bot liên tiếp gần nhất (đếm ngược từ mới nhất, dừng ở sự kiện đầu tiên của người thật).</summary>
    public static int BotStreak(IEnumerable<TaskEvent> events)
    {
        var n = 0;
        foreach (var e in events.OrderByDescending(e => e.At))
        {
            if (!e.ByBot) break;
            if (e.Counts) n++;
        }
        return n;
    }

    /// <summary>Bot được thao tác thêm một lần nữa trên việc không.</summary>
    public static bool StreakAllows(int streak, int limit) => streak < limit;

    /// <summary>Mã được nhắc bằng @ trong nội dung (không phân biệt hoa thường, bỏ trùng, giữ thứ tự, tối đa <see cref="MaxMentions"/>).
    /// Cú pháp dùng chung với chat — <see cref="MentionCodes"/>.</summary>
    public static IReadOnlyList<string> MentionedCodes(string? content) => MentionCodes.Parse(content, MaxMentions);

    /// <summary>Người nhận chuông "… nhắc bạn trong việc …": chỉ thành viên dự án còn làm việc, có tài khoản, mã khớp (không phân biệt hoa thường);
    /// bỏ người viết và người làm việc (đã nhận chuông bình luận). Trả UserId, bỏ trùng, giữ thứ tự danh sách thành viên.</summary>
    public static IReadOnlyList<Guid> MentionRecipients(IEnumerable<(Guid EmployeeId, string Code, Guid? UserId, bool IsActive)> members,
        IReadOnlyCollection<string> codes, Guid? authorEmployeeId, Guid? assigneeEmployeeId)
    {
        if (codes.Count == 0) return [];
        var set = new HashSet<string>(codes, StringComparer.OrdinalIgnoreCase);
        return members.Where(m => m.IsActive && m.UserId is not null && m.EmployeeId != authorEmployeeId && m.EmployeeId != assigneeEmployeeId && set.Contains(m.Code))
            .Select(m => m.UserId!.Value).Distinct().ToList();
    }

    /// <summary>Ứng viên nhận tin Telegram "được nhắc" (TEST-63): như <see cref="MentionRecipients"/> nhưng GIỮ người làm việc
    /// (chuông bình luận không đánh thức agent) — chỉ bỏ người viết. Trả (UserId, mã), bỏ trùng; lọc bot / đã khoá ở <c>ITelegramWakeup</c>.</summary>
    public static IReadOnlyList<(Guid UserId, string Code)> MentionWakeTargets(IEnumerable<(Guid EmployeeId, string Code, Guid? UserId, bool IsActive)> members,
        IReadOnlyCollection<string> codes, Guid? authorEmployeeId)
    {
        if (codes.Count == 0) return [];
        var set = new HashSet<string>(codes, StringComparer.OrdinalIgnoreCase);
        return members.Where(m => m.IsActive && m.UserId is not null && m.EmployeeId != authorEmployeeId && set.Contains(m.Code))
            .Select(m => (m.UserId!.Value, m.Code)).DistinctBy(x => x.Item1).ToList();
    }
}
