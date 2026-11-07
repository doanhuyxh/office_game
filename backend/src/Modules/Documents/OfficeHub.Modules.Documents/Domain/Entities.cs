using System.Text.Json.Serialization;
using OfficeHub.BuildingBlocks.Auditing;

namespace OfficeHub.Modules.Documents.Domain;

/// <summary>Kho chứa tài liệu: kho chung công ty, kho của một phòng ban (SpaceId = Id phòng ban), kho của một dự án (SpaceId = Id dự án).</summary>
[JsonConverter(typeof(JsonStringEnumConverter<SpaceKind>))]
public enum SpaceKind { Company = 0, Department = 1, Project = 2 }

/// <summary>Nhóm file (suy từ loại MIME / đuôi file) — để lọc và chọn cách xem trước.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<AssetKind>))]
public enum AssetKind { Document = 0, Image = 1, Video = 2, Audio = 3, Archive = 4, Other = 5 }

/// <summary>
/// Mức bảo mật. Hiện chỉ dùng <see cref="Internal"/> (ai có quyền vào kho đều xem được); <see cref="Restricted"/> / <see cref="Confidential"/>
/// để sẵn cho giai đoạn sau (danh sách người được xem, chỉ Ban giám đốc / HR) — API từ chối đặt hai mức này khi chưa mở.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter<Classification>))]
public enum Classification { Internal = 0, Restricted = 1, Confidential = 2 }

/// <summary>Vòng đời: Nháp → Chờ duyệt → Ban hành → Lưu trữ; Huỷ = đã xoá file theo hạn lưu trữ (giữ hồ sơ làm biên bản).</summary>
[JsonConverter(typeof(JsonStringEnumConverter<AssetStatus>))]
public enum AssetStatus { Draft = 0, PendingApproval = 1, Published = 2, Archived = 3, Destroyed = 4 }

[JsonConverter(typeof(JsonStringEnumConverter<ProjectStatus>))]
public enum ProjectStatus { Active = 0, Closed = 1 }
[JsonConverter(typeof(JsonStringEnumConverter<ProjectRole>))]
public enum ProjectRole { Member = 0, Manager = 1 }
[JsonConverter(typeof(JsonStringEnumConverter<AccessAction>))]
public enum AccessAction { View = 0, Download = 1 }

/// <summary>Dự án: có kho tài liệu riêng, chỉ thành viên (và HR) vào được.</summary>
[Audited]
public sealed class Project
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public required string Code { get; set; }
    public required string Name { get; set; }
    public string? Description { get; set; }
    public ProjectStatus Status { get; set; }
    /// <summary>Phòng ban chủ trì (tuỳ chọn, chỉ để hiển thị / lọc).</summary>
    public Guid? DepartmentId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public string? CreatedByName { get; set; }
    public DateTimeOffset? UpdatedAt { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }
    public List<ProjectMember> Members { get; set; } = [];
}

public sealed class ProjectMember
{
    public Guid ProjectId { get; set; }
    public Guid EmployeeId { get; set; }
    public ProjectRole Role { get; set; }
    public DateTimeOffset AddedAt { get; set; }
}

/// <summary>Thư mục trong một kho (cây theo ParentId). Tên không trùng trong cùng thư mục cha.</summary>
public sealed class Folder
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public SpaceKind SpaceKind { get; set; }
    /// <summary>null = kho công ty.</summary>
    public Guid? SpaceId { get; set; }
    public Guid? ParentId { get; set; }
    public required string Name { get; set; }
    public Guid? CreatedByUserId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>Loại tài liệu (HR quản lý): mã dùng trong số hiệu ban hành, thời hạn lưu trữ mặc định.</summary>
[Audited]
public sealed class DocType
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public required string Code { get; set; }
    public required string Name { get; set; }
    /// <summary>Số năm lưu trữ tính từ ngày ban hành (chưa ban hành: từ ngày tạo); null = vĩnh viễn.</summary>
    public int? RetentionYears { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
}

/// <summary>Tài sản số: hồ sơ trong DB + các phiên bản file trên S3.</summary>
[Audited]
public sealed class Asset
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    /// <summary>Mã tài sản, vd TL-KTH-2026-00012 (không đổi, không tái dùng).</summary>
    public required string Code { get; set; }
    public required string Title { get; set; }
    public string? Description { get; set; }
    public List<string> Tags { get; set; } = [];
    public SpaceKind SpaceKind { get; set; }
    public Guid? SpaceId { get; set; }
    public Guid? FolderId { get; set; }
    public Guid DocTypeId { get; set; }
    public AssetKind Kind { get; set; }
    public Classification Classification { get; set; }
    public AssetStatus Status { get; set; }
    public int CurrentVersion { get; set; }
    /// <summary>Tổng dung lượng mọi phiên bản (byte).</summary>
    public long TotalSize { get; set; }
    /// <summary>Người phụ trách (mặc định người tạo). Nghỉ việc → HR bàn giao cho người khác.</summary>
    public Guid? CustodianEmployeeId { get; set; }
    public string? CustodianName { get; set; }
    public Guid? CreatedByUserId { get; set; }
    public Guid? CreatedByEmployeeId { get; set; }
    public string? CreatedByName { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? UpdatedAt { get; set; }

    /// <summary>Số hiệu ban hành, vd 012/2026/QĐ-KTH.</summary>
    public string? DocumentNumber { get; set; }
    public DateTimeOffset? PublishedAt { get; set; }
    public Guid? ApprovalRequestId { get; set; }
    /// <summary>Người bấm gửi duyệt (có thể là trưởng phòng gửi giúp) — người duyệt tính theo người này.</summary>
    public Guid? SubmittedByEmployeeId { get; set; }
    public string? RejectReason { get; set; }

    /// <summary>Hết hạn lưu trữ (ngày theo lịch VN); null = vĩnh viễn.</summary>
    public DateOnly? RetentionUntil { get; set; }
    public DateTimeOffset? RetentionNotifiedAt { get; set; }
    public DateTimeOffset? DestroyedAt { get; set; }
    public string? DestroyReason { get; set; }
    public string? DestroyedByName { get; set; }

    /// <summary>Thùng rác (chỉ tài liệu nháp); quá 30 ngày thì xoá hẳn.</summary>
    public DateTimeOffset? DeletedAt { get; set; }
    public string? DeletedByName { get; set; }

    public List<AssetVersion> Versions { get; set; } = [];
}

public sealed class AssetVersion
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid AssetId { get; set; }
    public int Number { get; set; }
    /// <summary>Key S3 tương đối (documents/...), null khi file đã bị huỷ.</summary>
    public string? FileKey { get; set; }
    public required string FileName { get; set; }
    public required string ContentType { get; set; }
    public long Size { get; set; }
    public string? Note { get; set; }
    public Guid? UploadedByUserId { get; set; }
    public string? UploadedByName { get; set; }
    public DateTimeOffset UploadedAt { get; set; }
}

/// <summary>Nhật ký xem / tải (chỉ thêm, không sửa).</summary>
public sealed class AccessLog
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid AssetId { get; set; }
    public int VersionNumber { get; set; }
    public Guid? UserId { get; set; }
    public string? UserName { get; set; }
    public AccessAction Action { get; set; }
    public DateTimeOffset At { get; set; }
    public string? Ip { get; set; }
}

/// <summary>Vé tải lên: Api cấp key + presigned PUT; trình duyệt PUT thẳng lên S3 rồi gửi lại vé để đăng ký. Vé quá hạn → job xoá file rác.</summary>
public sealed class UploadTicket
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public required string FileKey { get; set; }
    public required string FileName { get; set; }
    public required string ContentType { get; set; }
    public long Size { get; set; }
    public Guid UserId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>Bộ đếm số thứ tự (mã tài sản theo năm, số hiệu ban hành theo loại + kho + năm).</summary>
public sealed class Sequence
{
    public required string Scope { get; set; }
    public int Value { get; set; }
}
