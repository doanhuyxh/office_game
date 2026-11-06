namespace OfficeHub.Modules.Payroll.Contracts;

/// <summary>
/// Quy ra tiền (chủ dự án chốt 2026-11-06) — hàm thuần, test ở tests/OfficeHub.Modules.Reporting.Tests.
/// - Lương căn cứ = lương trên hợp đồng hiệu lực (đã tính phụ lục), KHÔNG gồm phụ cấp.
/// - Ngày công chuẩn = số ngày có ca theo lịch tuần trong tháng, kể cả ngày lễ (IWorkCalendar.StandardDaysAsync).
/// - Lương ngày = lương ÷ ngày công chuẩn; lương giờ = lương ngày ÷ 8.
/// - Tiền tăng ca = số giờ × lương giờ × hệ số (150 / 200 / 300%) — tính theo lương + ngày công chuẩn của THÁNG có ngày tăng ca.
/// - Tiền phép năm chưa dùng: trả KHI NGHỈ VIỆC (Điều 113 BLLĐ) = số ngày phép còn lại × lương ngày tại ngày nghỉ việc.
///   Nhân viên đang làm chỉ xem giá trị ước tính (theo lương hôm nay).
/// Làm tròn tới đồng ở số tiền cuối cùng mỗi dòng.
/// </summary>
public static class PayRules
{
    public const int HoursPerDay = 8;

    public static decimal? DailyWage(decimal? salary, int standardDays) =>
        salary is { } s && standardDays > 0 ? s / standardDays : null;

    public static decimal? HourlyWage(decimal? salary, int standardDays) =>
        DailyWage(salary, standardDays) is { } d ? d / HoursPerDay : null;

    public static decimal? OvertimeAmount(int minutes, decimal? hourlyWage, int percent) =>
        hourlyWage is { } h ? RoundVnd(minutes / 60m * h * percent / 100m) : null;

    /// <summary>Ngày phép còn lại ≤ 0 → 0 đồng (dùng vượt không trừ tự động — HR xử lý tay nếu cần).</summary>
    public static decimal? LeavePayout(decimal availableDays, decimal? dailyWage) =>
        dailyWage is { } d ? RoundVnd(Math.Max(0, availableDays) * d) : null;

    public static decimal RoundVnd(decimal v) => Math.Round(v, 0, MidpointRounding.AwayFromZero);
}
