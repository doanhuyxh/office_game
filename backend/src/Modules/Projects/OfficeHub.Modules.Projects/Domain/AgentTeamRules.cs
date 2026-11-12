using System.Text.RegularExpressions;

namespace OfficeHub.Modules.Projects.Domain;

/// <summary>Một sự kiện trên việc (lịch sử hoặc bình luận) để tính chuỗi thao tác liên tiếp của bot.</summary>
/// <param name="Counts">Có tính vào chuỗi không (chuyển trạng thái / giao người / bình luận; tạo / sửa nội dung thì không) — sự kiện của người thật luôn ngắt chuỗi.</param>
public readonly record struct TaskEvent(DateTimeOffset At, bool ByBot, bool Counts);

/// <summary>
/// Rào chắn cho đội agent phối hợp qua bảng việc (2026-11-11, phương án đề xuất — chủ dự án nói "triển khai đi" không chốt từng điểm):
/// <list type="bullet">
/// <item>Thao tác qua token AI KHÔNG BAO GIỜ duyệt: không chuyển việc vào / ra cột cần người duyệt, kể cả khi tài khoản là quản lý dự án / HR.</item>
/// <item>Mỗi tài khoản tạo tối đa <see cref="MaxBotTasksPerDay"/> việc / ngày qua token AI (chặn bot sinh việc hàng loạt).</item>
/// <item>Một việc qua tay bot (chuyển trạng thái / giao người / bình luận) quá <see cref="MaxBotStreak"/> lần liên tiếp mà không có người thật
///       thao tác / bình luận → bot bị chặn trên việc đó cho tới khi có người xem (chặn hai bot chuyền qua lại vô tận).</item>
/// <item>@mã-nhân-viên trong bình luận → báo người được nhắc (phải là thành viên dự án).</item>
/// </list>
/// Hàm thuần — test: tests/OfficeHub.Modules.Projects.Tests/AgentTeamRulesTests.cs.
/// </summary>
public static partial class AgentTeamRules
{
    public const int MaxBotTasksPerDay = 50;
    public const int MaxBotStreak = 10;
    public const int MaxMentions = 10;

    public static string TaskQuotaMessage => $"Đã tạo {MaxBotTasksPerDay} việc qua trợ lý AI hôm nay — đợi ngày mai hoặc tạo trên web";
    public static string StreakMessage => $"Việc đã qua tay bot {MaxBotStreak} lần liên tiếp — cần người thật xem (bình luận hoặc chuyển trạng thái trên web) trước khi bot làm tiếp";

    public static bool TaskQuotaLeft(int createdToday) => createdToday < MaxBotTasksPerDay;

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
    public static bool StreakAllows(int streak) => streak < MaxBotStreak;

    [GeneratedRegex(@"(?<![\p{L}\p{N}_.@])@([\p{L}\p{N}_.\-]{2,40})", RegexOptions.CultureInvariant)]
    private static partial Regex MentionRegex();

    /// <summary>Mã được nhắc bằng @ trong nội dung (không phân biệt hoa thường, bỏ trùng, giữ thứ tự, tối đa <see cref="MaxMentions"/>).
    /// Bỏ dấu chấm / gạch cuối (vd "@NV012." cuối câu). Email (a@b.c) không tính vì trước @ là chữ.</summary>
    public static IReadOnlyList<string> MentionedCodes(string? content)
    {
        if (string.IsNullOrEmpty(content)) return [];
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var list = new List<string>();
        foreach (Match m in MentionRegex().Matches(content))
        {
            var code = m.Groups[1].Value.TrimEnd('.', '-');
            if (code.Length >= 2 && seen.Add(code)) list.Add(code);
            if (list.Count == MaxMentions) break;
        }
        return list;
    }
}
