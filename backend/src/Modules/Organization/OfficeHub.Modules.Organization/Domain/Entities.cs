using OfficeHub.BuildingBlocks.Auditing;
namespace OfficeHub.Modules.Organization.Domain;

/// <summary>Trường chung: thời điểm tạo/sửa, xoá mềm.</summary>
public abstract class Entity
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }
}

[Audited]
public sealed class Department : Entity
{
    public required string Name { get; set; }
    public string? Code { get; set; }
    /// <summary>Phòng ban cha (cây nhiều cấp). Null = cấp cao nhất.</summary>
    public Guid? ParentId { get; set; }
    public Guid? HeadEmployeeId { get; set; }
    /// <summary>Id khu vực trên bản đồ văn phòng 3D (shared/office-map.json → zones[].id).</summary>
    public string? MapZone { get; set; }
    public int SortOrder { get; set; }
    /// <summary>Mô tả ngắn (≤ 500) — hiện ở danh sách, trả cho trợ lý AI.</summary>
    public string? Description { get; set; }
    /// <summary>Hướng dẫn: trách nhiệm, quyền hạn, quy trình, đầu mối liên hệ (Markdown ≤ 10.000). Mọi nhân viên + trợ lý AI (MCP) đọc được.</summary>
    public string? Guide { get; set; }
    public DateTimeOffset? GuideUpdatedAt { get; set; }
    public string? GuideUpdatedByName { get; set; }
}

[Audited]
public sealed class Position : Entity
{
    public required string Name { get; set; }
    /// <summary>Cấp bậc: 1 = cao nhất (Giám đốc). Nhiều chức vụ có thể cùng cấp. 0 = dữ liệu cũ chưa chuyển (xem <see cref="PositionLadder"/>).</summary>
    public int Level { get; set; }
    public int SortOrder { get; set; }
    /// <summary>Mô tả ngắn (≤ 500) — hiện ở danh sách, trả cho trợ lý AI.</summary>
    public string? Description { get; set; }
    /// <summary>Hướng dẫn: trách nhiệm, quyền hạn, quy trình, đầu mối liên hệ (Markdown ≤ 10.000). Mọi nhân viên + trợ lý AI (MCP) đọc được.</summary>
    public string? Guide { get; set; }
    public DateTimeOffset? GuideUpdatedAt { get; set; }
    public string? GuideUpdatedByName { get; set; }
}

public enum EmployeeStatus
{
    /// <summary>Thử việc</summary>
    Probation = 0,
    /// <summary>Chính thức</summary>
    Active = 1,
    /// <summary>Đã nghỉ việc</summary>
    Resigned = 2,
}

[Audited]
public sealed class Employee : Entity
{
    /// <summary>Mã nhân viên, duy nhất (NV001...). Dùng làm tên đăng nhập mặc định.</summary>
    public required string Code { get; set; }
    public required string FullName { get; set; }
    /// <summary>Email cá nhân (nhận lời mời, thông báo).</summary>
    public string? Email { get; set; }
    public string? Phone { get; set; }
    public DateOnly? DateOfBirth { get; set; }
    public Guid? DepartmentId { get; set; }
    /// <summary>Chức vụ = cấp bậc (Trưởng phòng, Chuyên viên…).</summary>
    public Guid? PositionId { get; set; }
    /// <summary>Chức danh = công việc cụ thể, chữ tự do (Lễ tân, Lập trình viên, Kế toán viên…).</summary>
    public string? JobTitle { get; set; }
    /// <summary>Quản lý trực tiếp (duyệt đơn, giải trình).</summary>
    public Guid? ManagerId { get; set; }
    public EmployeeStatus Status { get; set; } = EmployeeStatus.Probation;
    public DateOnly JoinedAt { get; set; }
    public DateOnly? LeftAt { get; set; }
    /// <summary>Tài khoản đăng nhập (module Identity). Null = chưa cấp tài khoản.</summary>
    public Guid? UserId { get; set; }
    public string? Note { get; set; }
}
