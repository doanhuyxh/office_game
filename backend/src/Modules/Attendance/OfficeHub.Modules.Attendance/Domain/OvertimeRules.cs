namespace OfficeHub.Modules.Attendance.Domain;

/// <summary>Loại ngày tăng ca → hệ số lương theo Bộ luật Lao động 2019 (Điều 98). Chỉ thống kê giờ, chưa quy ra tiền.</summary>
public enum OvertimeKind
{
    /// <summary>Ngày có ca làm: 150%.</summary>
    Weekday,
    /// <summary>Ngày nghỉ hằng tuần (không có ca): 200%.</summary>
    RestDay,
    /// <summary>Ngày lễ, tết: 300%.</summary>
    Holiday,
}

/// <summary>Quy tắc tăng ca — hàm thuần để test (tests/OfficeHub.Modules.Attendance.Tests/OvertimeRulesTests.cs).</summary>
public static class OvertimeRules
{
    /// <summary>Khai bù tối đa N ngày sau ngày tăng ca.</summary>
    public const int MaxDaysAfter = 7;
    /// <summary>Đăng ký trước tối đa N ngày.</summary>
    public const int MaxDaysAhead = 31;
    public const int MinMinutes = 15;
    public const int MaxMinutesPerRequest = 12 * 60;
    /// <summary>Giới hạn luật (Nghị định 145/2020): 40 giờ/tháng, 200 giờ/năm. Vượt chỉ cảnh báo, không chặn.</summary>
    public const int MonthlyLimitMinutes = 40 * 60;
    public const int YearlyLimitMinutes = 200 * 60;

    public static OvertimeKind Classify(bool isHoliday, bool hasShift) =>
        isHoliday ? OvertimeKind.Holiday : hasShift ? OvertimeKind.Weekday : OvertimeKind.RestDay;

    public static int Percent(OvertimeKind kind) => kind switch
    {
        OvertimeKind.Holiday => 300,
        OvertimeKind.RestDay => 200,
        _ => 150,
    };

    public static string Label(OvertimeKind kind) => kind switch
    {
        OvertimeKind.Holiday => "ngày lễ",
        OvertimeKind.RestDay => "ngày nghỉ tuần",
        _ => "ngày thường",
    };

    /// <summary>Số phút của khoảng [start, end) trong cùng một ngày; 0 nếu end ≤ start (chưa hỗ trợ qua đêm).</summary>
    public static int MinutesOf(TimeOnly start, TimeOnly end) => end > start ? (int)(end - start).TotalMinutes : 0;

    /// <summary>
    /// Ca cố định: giờ tăng ca không được nằm trong [giờ vào, giờ ra) của ca (kể cả nghỉ trưa). Trả về khung ca bị trùng, hoặc null.
    /// Ca linh hoạt không có khung giờ cố định → không kiểm tra.
    /// </summary>
    public static (TimeOnly Start, TimeOnly End)? ShiftOverlap(Shift? shift, TimeOnly start, TimeOnly end) =>
        shift is { Type: ShiftType.Fixed, StartTime: { } ss, EndTime: { } se } && start < se && end > ss ? (ss, se) : null;

    /// <summary>Hai khoảng giờ trong cùng ngày có giao nhau không.</summary>
    public static bool Overlaps(TimeOnly aStart, TimeOnly aEnd, TimeOnly bStart, TimeOnly bEnd) => aStart < bEnd && aEnd > bStart;

    /// <summary>Cảnh báo vượt giới hạn. <paramref name="monthBefore"/>/<paramref name="yearBefore"/>: phút đã duyệt + đang chờ (không tính đơn này).</summary>
    public static List<string> Warnings(DateOnly workDate, int monthBefore, int yearBefore, int minutes)
    {
        var w = new List<string>();
        if (monthBefore + minutes > MonthlyLimitMinutes)
            w.Add($"Tổng tăng ca tháng {workDate:MM/yyyy} sẽ là {Hours(monthBefore + minutes)} giờ, vượt giới hạn {MonthlyLimitMinutes / 60} giờ/tháng");
        if (yearBefore + minutes > YearlyLimitMinutes)
            w.Add($"Tổng tăng ca năm {workDate.Year} sẽ là {Hours(yearBefore + minutes)} giờ, vượt giới hạn {YearlyLimitMinutes / 60} giờ/năm");
        return w;
    }

    /// <summary>150 → "2,5"</summary>
    public static string Hours(int minutes) =>
        (Math.Round(minutes / 60m, 2)).ToString("0.##", System.Globalization.CultureInfo.GetCultureInfo("vi-VN"));
}
