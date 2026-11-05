namespace OfficeHub.Modules.Leave.Contracts;

/// <summary>Nửa ngày nghỉ (null = cả ngày).</summary>
public enum LeaveHalf { Morning = 1, Afternoon = 2 }

/// <summary>Một ngày nghỉ đã DUYỆT của một nhân viên. Fraction = 1 (cả ngày) hoặc 0.5.</summary>
public sealed record LeaveDay(Guid EmployeeId, DateOnly Date, decimal Fraction, LeaveHalf? Half, string TypeName, bool IsPaid);

/// <summary>Attendance dùng để hiện "Nghỉ phép" trong bảng công.</summary>
public interface ILeaveCalendar
{
    Task<IReadOnlyList<LeaveDay>> GetApprovedAsync(IReadOnlyCollection<Guid> employeeIds, DateOnly from, DateOnly to, CancellationToken ct = default);
}
