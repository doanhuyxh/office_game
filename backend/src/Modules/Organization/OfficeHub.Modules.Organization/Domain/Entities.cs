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
    /// <summary>Mô tả ngắn (≤ 2.000) — hiện ở danh sách, trả cho trợ lý AI.</summary>
    public string? Description { get; set; }
    /// <summary>Hướng dẫn: trách nhiệm, quyền hạn, quy trình, đầu mối liên hệ (Markdown ≤ 40.000). Mọi nhân viên + trợ lý AI (MCP) đọc được.</summary>
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
    /// <summary>Người giữ chức vụ này gửi ban hành tài liệu (kho tài liệu) → ban hành ngay, không qua duyệt. Chỉ cấp ≤ <see cref="PositionLadder.SpecialistLevel"/>.</summary>
    public bool SelfPublishDocuments { get; set; }
    /// <summary>Quyền tài chính của người giữ chức vụ (bit của <c>FinancePermission</c>, đã chuẩn hoá). Chỉ admin / người có quyền Quản trị tài chính sửa được.</summary>
    public int FinancePermissions { get; set; }
    /// <summary>Quản lý trạng thái (cột) công việc của mọi dự án người đó xem được: thêm, đổi tên / màu, sắp xếp, xoá (module Projects). Vai trò admin / hr không thay thế.</summary>
    public bool ManageTaskColumns { get; set; }
    /// <summary>Mô tả ngắn (≤ 2.000) — hiện ở danh sách, trả cho trợ lý AI.</summary>
    public string? Description { get; set; }
    /// <summary>Hướng dẫn: trách nhiệm, quyền hạn, quy trình, đầu mối liên hệ (Markdown ≤ 40.000). Mọi nhân viên + trợ lý AI (MCP) đọc được.</summary>
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

    // ---- Thông tin cá nhân (xem PersonalProfile). Liên hệ: nhân viên tự sửa. Ngày sinh / CCCD / ngân hàng: qua yêu cầu HR duyệt. ----
    public string? CurrentAddress { get; set; }
    public string? PermanentAddress { get; set; }
    public string? EmergencyContactName { get; set; }
    public string? EmergencyContactRelation { get; set; }
    public string? EmergencyContactPhone { get; set; }
    /// <summary>Khoá S3 ảnh đại diện (employees/{id}/avatar/{uuid}.{ext}); uuid đổi mỗi lần tải → dùng làm phiên bản cache.</summary>
    public string? AvatarKey { get; set; }
    /// <summary>Số CCCD — mã hoá AES-GCM (IFieldEncryptor).</summary>
    public string? IdNumberEncrypted { get; set; }
    public DateOnly? IdIssuedOn { get; set; }
    public string? IdIssuedPlace { get; set; }
    public string? BankName { get; set; }
    /// <summary>Số tài khoản ngân hàng — mã hoá AES-GCM.</summary>
    public string? BankAccountEncrypted { get; set; }
    public string? BankAccountHolder { get; set; }
}

public enum ProfileRequestStatus { Pending = 0, Approved = 1, Rejected = 2, Cancelled = 3 }

/// <summary>Yêu cầu cập nhật thông tin cần HR duyệt (ngày sinh, CCCD, tài khoản ngân hàng). Mỗi nhân viên tối đa 1 yêu cầu Pending.</summary>
[Audited]
public sealed class ProfileChangeRequest
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid EmployeeId { get; set; }
    public ProfileRequestStatus Status { get; set; }
    /// <summary>JSON <see cref="SensitiveChange"/> (chỉ các trường muốn đổi) — mã hoá vì chứa CCCD / số tài khoản.</summary>
    public string DataEncrypted { get; set; } = "";
    public string? Note { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? DecidedAt { get; set; }
    public string? DecidedByName { get; set; }
    public string? RejectReason { get; set; }
}
