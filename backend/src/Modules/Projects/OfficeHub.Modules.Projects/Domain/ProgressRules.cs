using System.Text.Json.Serialization;

namespace OfficeHub.Modules.Projects.Domain;

/// <summary>Đúng tiến độ / Có rủi ro / Trễ — chỉ tính cho dự án đang chạy.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<ProjectHealth>))]
public enum ProjectHealth { OnTrack = 0, AtRisk = 1, Late = 2 }

/// <param name="Done">Đang ở cột hoàn thành.</param>
public sealed record ProgressTask(bool Done, DateOnly? DueOn);
public sealed record ProgressMilestone(int Order, string Title, DateOnly? DueOn, MilestoneStatus Status);
public sealed record NextMilestone(string Title, DateOnly? DueOn, bool Overdue);

/// <summary>Tổng quan tiến độ một dự án (thẻ dự án + tab Tổng quan).</summary>
public sealed record ProjectProgress(int Total, int Done, int Overdue, int? PercentDone, int? TimeElapsedPercent,
    NextMilestone? NextMilestone, int MilestonesOverdue, ProjectHealth? Health, List<string> HealthReasons);

/// <summary>
/// Tiến độ dự án — hàm thuần, test: tests/OfficeHub.Modules.Projects.Tests/ProgressRulesTests.cs.
/// % hoàn thành = việc ở cột hoàn thành / tổng việc. % thời gian = (hôm nay − bắt đầu) / (kết thúc − bắt đầu), kẹp 0–100.
/// Trễ: quá ngày kết thúc mà còn việc mở, có mốc chưa nghiệm thu đã quá hạn, hoặc việc quá hạn ≥ max(3, 20% việc mở).
/// Có rủi ro: có việc quá hạn, % thời gian vượt % hoàn thành ≥ 25 điểm, hoặc còn ≤ 14 ngày đến hạn kết thúc mà hoàn thành &lt; 80%.
/// </summary>
public static class ProgressRules
{
    public const int LagPoints = 25;
    public const int EndSoonDays = 14;

    public static ProjectProgress Compute(IReadOnlyList<ProgressTask> tasks, IReadOnlyList<ProgressMilestone> milestones, DateOnly? startOn, DateOnly? endOn,
        bool active, DateOnly today)
    {
        var done = tasks.Count(t => t.Done);
        var open = tasks.Count - done;
        var overdue = tasks.Count(t => EffortRules.IsOverdue(t.DueOn, t.Done, today));
        int? pctDone = tasks.Count == 0 ? null : (int)Math.Round(100.0 * done / tasks.Count);
        int? pctTime = startOn is { } s && endOn is { } e && e > s
            ? (int)Math.Round(Math.Clamp(100.0 * (today.DayNumber - s.DayNumber) / (e.DayNumber - s.DayNumber), 0, 100)) : null;
        var openMs = milestones.Where(m => m.Status == MilestoneStatus.Open).OrderBy(m => m.DueOn ?? DateOnly.MaxValue).ThenBy(m => m.Order).ToList();
        var msOverdue = openMs.Count(m => m.DueOn < today);
        var next = openMs.FirstOrDefault() is { } n ? new NextMilestone(n.Title, n.DueOn, n.DueOn < today) : null;

        if (!active) return new ProjectProgress(tasks.Count, done, overdue, pctDone, pctTime, next, msOverdue, null, []);

        var late = new List<string>();
        var risk = new List<string>();
        if (endOn is { } end && end < today && open > 0) late.Add($"Quá ngày kết thúc {end:dd/MM/yyyy}, còn {open} việc mở");
        if (msOverdue > 0) late.Add($"{msOverdue} mốc quá hạn chưa nghiệm thu");
        if (overdue > 0 && overdue >= Math.Max(3, (int)Math.Ceiling(open * 0.2))) late.Add($"{overdue} việc quá hạn");
        else if (overdue > 0) risk.Add($"{overdue} việc quá hạn");
        if (pctTime is { } pt && pctDone is { } pd && pt - pd >= LagPoints) risk.Add($"Đã qua {pt}% thời gian, mới xong {pd}% việc");
        if (endOn is { } e2 && e2 >= today && e2.DayNumber - today.DayNumber <= EndSoonDays && open > 0 && (pctDone ?? 0) < 80)
            risk.Add($"Còn {e2.DayNumber - today.DayNumber} ngày đến hạn kết thúc, mới xong {pctDone ?? 0}%");
        var health = late.Count > 0 ? ProjectHealth.Late : risk.Count > 0 ? ProjectHealth.AtRisk : ProjectHealth.OnTrack;
        return new ProjectProgress(tasks.Count, done, overdue, pctDone, pctTime, next, msOverdue, health,
            [.. late, .. risk]);
    }
}
