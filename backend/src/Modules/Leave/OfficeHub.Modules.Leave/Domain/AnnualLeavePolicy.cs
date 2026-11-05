namespace OfficeHub.Modules.Leave.Domain;

/// <summary>
/// Quy tắc phép năm (hàm thuần, có test):
/// - Mỗi năm được 12 ngày + 1 ngày cho mỗi 5 năm thâm niên (thâm niên tính tại 1/1 của năm đó).
/// - Cộng dồn theo tháng: mỗi tháng làm việc được 1/12 số ngày của năm, tính từ tháng vào làm, tới tháng hiện tại
///   (tháng hiện tại được tính luôn), dừng ở tháng nghỉ việc.
/// - Phép chưa dùng tự chuyển sang năm sau, KHÔNG hết hạn (chốt với chủ dự án 2026-11-05).
/// </summary>
public static class AnnualLeavePolicy
{
    public const int BaseDaysPerYear = 12;
    public const int SeniorityStepYears = 5;

    public static int EntitlementForYear(int year, DateOnly joinedAt)
    {
        var jan1 = new DateOnly(year, 1, 1);
        var years = jan1 <= joinedAt ? 0 : FullYearsBetween(joinedAt, jan1);
        return BaseDaysPerYear + years / SeniorityStepYears;
    }

    /// <summary>Số ngày tích luỹ trong một năm tính tới asOf (asOf cùng năm thì tính tới tháng của asOf).</summary>
    public static decimal AccruedInYear(int year, DateOnly joinedAt, DateOnly? leftAt, DateOnly asOf)
    {
        if (year < joinedAt.Year || year > asOf.Year) return 0;
        var startMonth = year == joinedAt.Year ? joinedAt.Month : 1;
        var endMonth = year == asOf.Year ? asOf.Month : 12;
        if (leftAt is { } l)
        {
            if (l.Year < year) return 0;
            if (l.Year == year) endMonth = Math.Min(endMonth, l.Month);
        }
        var months = Math.Max(0, endMonth - startMonth + 1);
        return Math.Round(EntitlementForYear(year, joinedAt) * months / 12m, 2);
    }

    /// <summary>Tổng tích luỹ từ ngày vào làm tới asOf (mọi năm).</summary>
    public static decimal AccruedTotal(DateOnly joinedAt, DateOnly? leftAt, DateOnly asOf)
    {
        decimal total = 0;
        for (var y = joinedAt.Year; y <= asOf.Year; y++) total += AccruedInYear(y, joinedAt, leftAt, asOf);
        return total;
    }

    private static int FullYearsBetween(DateOnly from, DateOnly to)
    {
        var years = to.Year - from.Year;
        if (to < from.AddYears(years)) years--;
        return Math.Max(0, years);
    }
}
