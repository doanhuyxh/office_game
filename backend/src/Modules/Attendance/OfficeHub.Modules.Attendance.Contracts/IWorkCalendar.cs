namespace OfficeHub.Modules.Attendance.Contracts;

/// <summary>Lịch làm việc theo ca + ngày lễ. Leave dùng để đếm số ngày nghỉ (chỉ tính ngày phải đi làm).</summary>
public interface IWorkCalendar
{
    /// <summary>Các ngày trong [from, to] nhân viên có ca và không phải ngày lễ.</summary>
    Task<IReadOnlyList<DateOnly>> WorkingDaysAsync(Guid employeeId, DateOnly from, DateOnly to, CancellationToken ct = default);
    /// <summary>
    /// Số ngày công chuẩn trong [from, to]: ngày có ca theo lịch tuần, KỂ CẢ ngày lễ (ngày lễ vẫn hưởng lương — Điều 112 BLLĐ).
    /// Dùng tính lương giờ = lương tháng ÷ ngày công chuẩn ÷ 8.
    /// </summary>
    Task<int> StandardDaysAsync(Guid employeeId, DateOnly from, DateOnly to, CancellationToken ct = default);
}
