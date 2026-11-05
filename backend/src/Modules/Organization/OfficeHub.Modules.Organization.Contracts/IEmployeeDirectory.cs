namespace OfficeHub.Modules.Organization.Contracts;

/// <summary>Phần công khai của module Organization: module khác (Attendance, Leave...) tra cứu nhân viên.</summary>
public interface IEmployeeDirectory
{
    /// <summary>Nhân viên gắn với tài khoản đăng nhập (null nếu tài khoản chưa gắn hồ sơ, ví dụ admin hệ thống).</summary>
    Task<EmployeeRef?> GetByUserIdAsync(Guid userId, CancellationToken ct = default);

    Task<EmployeeRef?> GetAsync(Guid employeeId, CancellationToken ct = default);

    /// <summary>Nhân viên đang làm việc (chưa nghỉ việc).</summary>
    Task<IReadOnlyList<EmployeeRef>> ListActiveAsync(CancellationToken ct = default);

    /// <summary>Id các nhân viên cấp dưới (trực tiếp và gián tiếp) của một nhân viên.</summary>
    Task<IReadOnlyCollection<Guid>> GetSubordinateIdsAsync(Guid managerEmployeeId, CancellationToken ct = default);
}

public sealed record EmployeeRef(
    Guid Id,
    string Code,
    string FullName,
    Guid? UserId,
    Guid? DepartmentId,
    string? DepartmentName,
    Guid? ManagerId,
    bool IsActive,
    DateOnly JoinedAt,
    /// <summary>Ngày nghỉ việc (null = đang làm).</summary>
    DateOnly? LeftAt);
