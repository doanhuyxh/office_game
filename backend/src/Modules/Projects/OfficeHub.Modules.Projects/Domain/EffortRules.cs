namespace OfficeHub.Modules.Projects.Domain;

/// <summary>
/// Ngày công theo dự án (chủ dự án chốt 2026-11-08: tính theo công trên hệ thống chấm công, không ghi giờ theo việc) — hàm thuần,
/// test: tests/OfficeHub.Modules.Projects.Tests.
/// Công dự án của A trong tháng M = số ngày có mặt của A trong M × % phân bổ A vào dự án trong M.
/// </summary>
public static class EffortRules
{
    public const int MaxMonths = 24;

    /// <summary>
    /// Hạn việc không được trước hôm nay (giờ văn phòng). Sửa việc mà giữ nguyên hạn cũ đã qua vẫn được (việc quá hạn vẫn sửa được trường khác).
    /// Lỗi tiếng Việt hoặc null.
    /// </summary>
    public static string? DueDateError(DateOnly? due, DateOnly? previousDue, DateOnly today) =>
        due is { } d && d < today && d != previousDue ? "Hạn không được trước hôm nay" : null;

    public static DateOnly MonthStart(DateOnly d) => new(d.Year, d.Month, 1);
    public static DateOnly MonthEnd(DateOnly m) => MonthStart(m).AddMonths(1).AddDays(-1);

    /// <summary>% mặc định khi quản lý dự án chưa đặt: chỉ ở 1 dự án đang chạy trong tháng → 100; ở n dự án → chia đều (làm tròn 2 số).</summary>
    public static decimal DefaultPercent(int activeProjectsInMonth) => activeProjectsInMonth <= 1 ? 100 : Math.Round(100m / activeProjectsInMonth, 2);

    public static decimal Percent(decimal? explicitPercent, int activeProjectsInMonth) => explicitPercent ?? DefaultPercent(activeProjectsInMonth);

    public static decimal ManDays(decimal presentDays, decimal percent) => Math.Round(presentDays * percent / 100m, 2);

    /// <summary>Dự án có chạy trong tháng không: [bắt đầu, kết thúc / ngày đóng] giao với tháng.</summary>
    public static bool ActiveIn(DateOnly month, DateOnly start, DateOnly? end, DateOnly? closedOn)
    {
        var to = new[] { end, closedOn }.Where(x => x is not null).Select(x => x!.Value).DefaultIfEmpty(DateOnly.MaxValue).Min();
        return start <= MonthEnd(month) && to >= MonthStart(month);
    }

    /// <summary>Các tháng (ngày 1) từ <paramref name="from"/> đến <paramref name="to"/>, tối đa <see cref="MaxMonths"/> tháng gần nhất.</summary>
    public static List<DateOnly> Months(DateOnly from, DateOnly to)
    {
        var list = new List<DateOnly>();
        for (var m = MonthStart(from); m <= MonthStart(to); m = m.AddMonths(1)) list.Add(m);
        return list.Count > MaxMonths ? list[^MaxMonths..] : list;
    }

    /// <summary>Tổng % một người ở mọi dự án trong một tháng không được vượt 100 (chỉ tính % đã đặt tay).</summary>
    public static string? CheckTotal(decimal newPercent, decimal otherProjectsExplicitSum) =>
        newPercent is < 0 or > 100 ? "Phân bổ từ 0 đến 100 %"
        : newPercent + otherProjectsExplicitSum > 100 ? $"Tổng phân bổ tháng này vượt 100 % (dự án khác đã {otherProjectsExplicitSum:0.##} %)" : null;

    /// <summary>Tháng đã chốt phân bổ (đầu tháng sau): tháng trước tháng hiện tại.</summary>
    public static DateOnly MonthToFreeze(DateOnly today) => MonthStart(today).AddMonths(-1);

    public static string TaskCode(string projectCode, int number) => $"{projectCode}-{number}";

    public static bool IsOverdue(DateOnly? dueOn, TaskState state, DateOnly today) => state != TaskState.Done && dueOn is { } d && d < today;
}
