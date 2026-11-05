namespace OfficeHub.Modules.Attendance.Contracts;

/// <summary>Lịch làm việc theo ca + ngày lễ. Leave dùng để đếm số ngày nghỉ (chỉ tính ngày phải đi làm).</summary>
public interface IWorkCalendar
{
    /// <summary>Các ngày trong [from, to] nhân viên có ca và không phải ngày lễ.</summary>
    Task<IReadOnlyList<DateOnly>> WorkingDaysAsync(Guid employeeId, DateOnly from, DateOnly to, CancellationToken ct = default);
}
