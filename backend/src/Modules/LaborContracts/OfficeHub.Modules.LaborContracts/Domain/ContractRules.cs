namespace OfficeHub.Modules.LaborContracts.Domain;

public enum ReminderKind { Days30, Days7 }

/// <summary>Quy tắc hợp đồng — hàm thuần (test: tests/OfficeHub.Modules.LaborContracts.Tests).</summary>
public static class ContractRules
{
    public const int MaxFixedMonths = 36;
    public const int MaxProbationDays = 180;
    public const int RemindDays = 30;
    public const int RemindDaysFinal = 7;
    public const long MaxFileBytes = 10 * 1024 * 1024;
    public static readonly IReadOnlyDictionary<string, string> AllowedFiles = new Dictionary<string, string>
    {
        ["application/pdf"] = ".pdf", ["image/jpeg"] = ".jpg", ["image/png"] = ".png",
    };

    /// <summary>Lỗi theo field ("endDate") cho loại hợp đồng + thời hạn.</summary>
    public static List<(string Field, string Message)> ValidateTerm(ContractType type, DateOnly start, DateOnly? end)
    {
        var e = new List<(string, string)>();
        switch (type)
        {
            case ContractType.Indefinite:
                if (end is not null) e.Add(("endDate", "Hợp đồng không xác định thời hạn không có ngày kết thúc"));
                break;
            case ContractType.Fixed:
                if (end is not { } fe) e.Add(("endDate", "Hợp đồng xác định thời hạn cần ngày kết thúc"));
                else if (fe <= start) e.Add(("endDate", "Ngày kết thúc phải sau ngày bắt đầu"));
                else if (fe >= start.AddMonths(MaxFixedMonths)) e.Add(("endDate", $"Hợp đồng xác định thời hạn tối đa {MaxFixedMonths} tháng"));
                break;
            case ContractType.Probation:
                if (end is not { } pe) e.Add(("endDate", "Hợp đồng thử việc cần ngày kết thúc"));
                else if (pe < start) e.Add(("endDate", "Ngày kết thúc phải từ ngày bắt đầu trở đi"));
                else if (pe.DayNumber - start.DayNumber + 1 > MaxProbationDays) e.Add(("endDate", $"Thời gian thử việc tối đa {MaxProbationDays} ngày"));
                break;
        }
        return e;
    }

    /// <summary>Ngày cuối thực tế: ngày chấm dứt sớm nếu có, không thì ngày kết thúc (null = vô thời hạn).</summary>
    public static DateOnly? EffectiveEnd(DateOnly? end, DateOnly? terminatedOn) =>
        terminatedOn is { } t ? (end is { } e && e < t ? e : t) : end;

    public static ContractStatus Status(DateOnly start, DateOnly? end, DateOnly? terminatedOn, DateOnly today) =>
        terminatedOn is not null ? ContractStatus.Terminated
        : start > today ? ContractStatus.Upcoming
        : end is { } e && e < today ? ContractStatus.Expired
        : ContractStatus.Active;

    /// <summary>Hai khoảng [start, end] (end null = vô hạn) có giao nhau không.</summary>
    public static bool Overlaps(DateOnly aStart, DateOnly? aEnd, DateOnly bStart, DateOnly? bEnd) =>
        (aEnd is null || bStart <= aEnd) && (bEnd is null || aStart <= bEnd);

    /// <summary>
    /// Lần nhắc tới hạn hôm nay (nếu có). Còn ≤ 7 ngày và chưa nhắc 7 → Days7; còn ≤ 30 (và > 7) và chưa nhắc 30 → Days30.
    /// Hợp đồng tạo khi chỉ còn ≤ 7 ngày chỉ nhắc một lần (Days7). Đã hết hạn → không nhắc.
    /// </summary>
    public static ReminderKind? DueReminder(DateOnly end, DateOnly today, bool reminded30, bool reminded7)
    {
        var left = end.DayNumber - today.DayNumber;
        if (left < 0) return null;
        if (left <= RemindDaysFinal) return reminded7 ? null : ReminderKind.Days7;
        if (left <= RemindDays) return reminded30 ? null : ReminderKind.Days30;
        return null;
    }

    /// <summary>Lương / phụ cấp hiệu lực tại ngày D: phụ lục mới nhất có đổi giá trị và hiệu lực ≤ D; không có → giá trị trên hợp đồng.</summary>
    public static decimal? EffectiveValue(decimal? contractValue, IEnumerable<(DateOnly EffectiveDate, decimal? Value)> amendments, DateOnly date) =>
        amendments.Where(a => a.Value is not null && a.EffectiveDate <= date).OrderBy(a => a.EffectiveDate).LastOrDefault().Value ?? contractValue;
}
