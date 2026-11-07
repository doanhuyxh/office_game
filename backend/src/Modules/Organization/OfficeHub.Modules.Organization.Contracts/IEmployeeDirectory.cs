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
    /// <summary>Nhân viên có làm việc trong [from, to] (vào làm ≤ to và chưa nghỉ hoặc nghỉ ≥ from) — báo cáo theo kỳ, gồm cả người đã nghỉ.</summary>
    Task<IReadOnlyList<EmployeeRef>> ListEmployedAsync(DateOnly from, DateOnly to, CancellationToken ct = default);
    /// <summary>Hồ sơ đầy đủ hơn (email, điện thoại, ngày sinh, chức vụ) — dùng điền mẫu hợp đồng.</summary>
    Task<EmployeeProfile?> GetProfileAsync(Guid employeeId, CancellationToken ct = default);
    /// <summary>Tài khoản nhận lương (đã giải mã) — chỉ cho Payroll xuất file chuyển khoản (HR). Người chưa khai thì không có trong kết quả.</summary>
    Task<IReadOnlyDictionary<Guid, BankAccountInfo>> GetBankAccountsAsync(IReadOnlyCollection<Guid> employeeIds, CancellationToken ct = default);
    /// <summary>Mọi phòng ban (chưa xoá), có cây cha–con và trưởng phòng — vd kho tài liệu phòng ban (module Documents).</summary>
    Task<IReadOnlyList<DepartmentRef>> ListDepartmentsAsync(CancellationToken ct = default);
    /// <summary>Chức vụ hiện tại của nhân viên (null = chưa có). SelfPublishDocuments đã tính cả điều kiện cấp ≤ Chuyên viên.</summary>
    Task<PositionRef?> GetPositionAsync(Guid employeeId, CancellationToken ct = default);
}

public sealed record PositionRef(Guid Id, string Name, int Level, bool SelfPublishDocuments);

public sealed record DepartmentRef(Guid Id, string? Code, string Name, Guid? ParentId, Guid? HeadEmployeeId);

public sealed record BankAccountInfo(string? BankName, string Account, string? Holder);

/// <summary>IdNumber đã giải mã — chỉ dùng phía server (điền mẫu hợp đồng, HR).</summary>
public sealed record EmployeeProfile(EmployeeRef Employee, string? Email, string? Phone, DateOnly? DateOfBirth, string? PositionName,
    string? IdNumber = null, DateOnly? IdIssuedOn = null, string? IdIssuedPlace = null, string? PermanentAddress = null, string? CurrentAddress = null,
    string? JobTitle = null);

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
