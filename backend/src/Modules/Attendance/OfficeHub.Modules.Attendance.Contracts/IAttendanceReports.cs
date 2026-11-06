namespace OfficeHub.Modules.Attendance.Contracts;

/// <summary>Dữ liệu chấm công / tăng ca cho module Reporting (báo cáo, quy ra tiền). Chỉ đọc.</summary>
public interface IAttendanceReports
{
    /// <summary>Bảng công cả tháng (monthStart = ngày 1) cho từng nhân viên; nhân viên không tồn tại bị bỏ qua.</summary>
    Task<IReadOnlyDictionary<Guid, TimesheetMonth>> MonthAsync(IReadOnlyCollection<Guid> employeeIds, DateOnly monthStart, CancellationToken ct = default);

    /// <summary>Đơn tăng ca ĐÃ DUYỆT trong [from, to], kèm loại ngày + hệ số tính theo lịch / ngày lễ hiện tại.</summary>
    Task<IReadOnlyList<OvertimeEntry>> ApprovedOvertimeAsync(IReadOnlyCollection<Guid> employeeIds, DateOnly from, DateOnly to, CancellationToken ct = default);
}

/// <param name="Kind">"Weekday" (150%) | "RestDay" (200%) | "Holiday" (300%).</param>
public sealed record OvertimeEntry(Guid EmployeeId, DateOnly WorkDate, string StartTime, string EndTime, int Minutes, string Kind, int Percent, string Reason);

/// <param name="Status">DayOff | Holiday | NotYet | Working | Present | MissingCheckout | Absent | NotEmployed | Leave.</param>
public sealed record TimesheetDay(DateOnly Date, string Status, int WorkedMinutes, int RequiredMinutes, int LateMinutes, int ShortMinutes,
    decimal LeaveFraction, string? LeaveName, string? HolidayName, int OvertimeMinutes, string? WorkMode, DateTimeOffset? FirstIn, DateTimeOffset? LastOut);

public sealed record TimesheetTotals(int WorkDays, int PresentDays, int AbsentDays, int LateCount, int LateMinutes, int ShortMinutes,
    int WorkedMinutes, int RequiredMinutes, int OnsiteDays, int RemoteDays, int MissingCheckoutDays, decimal LeaveDays, int OvertimeMinutes);

public sealed record TimesheetMonth(Guid EmployeeId, IReadOnlyList<TimesheetDay> Days, TimesheetTotals Totals);
