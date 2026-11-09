using System.Text.Json.Serialization;
using OfficeHub.BuildingBlocks.Auditing;

namespace OfficeHub.Modules.Assets.Domain;

/// <summary>Trong kho → Đang dùng ↔ Trong kho; Bảo trì (về Trong kho); Thanh lý / Mất (không quay lại).</summary>
[JsonConverter(typeof(JsonStringEnumConverter<DeviceStatus>))]
public enum DeviceStatus { InStock = 0, InUse = 1, Repair = 2, Retired = 3, Lost = 4 }

[JsonConverter(typeof(JsonStringEnumConverter<BillingCycle>))]
public enum BillingCycle { None = 0, Monthly = 1, Yearly = 2 }

[JsonConverter(typeof(JsonStringEnumConverter<ServiceStatus>))]
public enum ServiceStatus { Active = 0, Cancelled = 1 }

[JsonConverter(typeof(JsonStringEnumConverter<ReviewStatus>))]
public enum ReviewStatus { Open = 0, Closed = 1 }

[JsonConverter(typeof(JsonStringEnumConverter<ReviewDecision>))]
public enum ReviewDecision { Pending = 0, Keep = 1, Revoke = 2 }

[JsonConverter(typeof(JsonStringEnumConverter<AttachmentKind>))]
public enum AttachmentKind { Photo = 0, Invoice = 1, Other = 2 }

[JsonConverter(typeof(JsonStringEnumConverter<HandoverKind>))]
public enum HandoverKind { Assign = 0, Return = 1 }

[JsonConverter(typeof(JsonStringEnumConverter<StocktakeResult>))]
public enum StocktakeResult { Pending = 0, Found = 1, Missing = 2 }

/// <summary>Loại thiết bị (tiền tố mã thiết bị). HR thêm / sửa.</summary>
[Audited]
public sealed class Category
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public required string Code { get; set; }
    public required string Name { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
    /// <summary>Số tháng khấu hao đường thẳng mặc định của loại (null / 0 = không khấu hao).</summary>
    public int? DepreciationMonths { get; set; }
}

/// <summary>Thiết bị của công ty (máy tính, màn hình, điện thoại, phụ kiện).</summary>
[Audited]
public sealed class Device
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public required string Code { get; set; }
    public Guid CategoryId { get; set; }
    public required string Name { get; set; }
    public string? Brand { get; set; }
    public string? Model { get; set; }
    public string? SerialNumber { get; set; }
    public DateOnly? PurchaseDate { get; set; }
    /// <summary>Giá mua (VND). Chỉ HR thấy.</summary>
    public decimal? PurchasePrice { get; set; }
    public DateOnly? WarrantyUntil { get; set; }
    /// <summary>Số tháng khấu hao riêng của thiết bị (null = theo loại).</summary>
    public int? DepreciationMonths { get; set; }
    public DeviceStatus Status { get; set; }
    public Guid? HolderEmployeeId { get; set; }
    public string? Note { get; set; }
    /// <summary>Lý do thanh lý / mất.</summary>
    public string? StatusReason { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? UpdatedAt { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }
    public DateTimeOffset? WarrantyReminded30At { get; set; }
    public DateTimeOffset? WarrantyReminded7At { get; set; }
}

/// <summary>Lịch sử giao nhận thiết bị: chỉ thêm / đóng, không xoá.</summary>
public sealed class DeviceAssignment
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid DeviceId { get; set; }
    public Guid EmployeeId { get; set; }
    public DateTimeOffset AssignedAt { get; set; }
    public string? AssignedByName { get; set; }
    public string? AssignNote { get; set; }
    public DateTimeOffset? ReturnedAt { get; set; }
    public string? ReturnedByName { get; set; }
    public string? ReturnNote { get; set; }
}

/// <summary>Dịch vụ / phần mềm trả phí (Figma, Google Workspace, Slack…).</summary>
[Audited]
public sealed class Service
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public required string Name { get; set; }
    public string? Vendor { get; set; }
    public string? Plan { get; set; }
    public string? Url { get; set; }
    /// <summary>Số ghế tối đa (null = không giới hạn).</summary>
    public int? SeatLimit { get; set; }
    public BillingCycle BillingCycle { get; set; }
    /// <summary>Chi phí mỗi kỳ (VND). Chỉ HR thấy.</summary>
    public decimal? Cost { get; set; }
    public DateOnly? RenewalDate { get; set; }
    public Guid? OwnerDepartmentId { get; set; }
    public Guid? AdminEmployeeId { get; set; }
    public ServiceStatus Status { get; set; }
    public string? Note { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? UpdatedAt { get; set; }
    public DateTimeOffset? RenewalReminded30At { get; set; }
    public DateTimeOffset? RenewalReminded7At { get; set; }
}

/// <summary>Một tài khoản / ghế của nhân viên trên dịch vụ. Không lưu mật khẩu.</summary>
[Audited]
public sealed class ServiceSeat
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid ServiceId { get; set; }
    public Guid EmployeeId { get; set; }
    public required string AccountLogin { get; set; }
    public string? Role { get; set; }
    public string? Note { get; set; }
    public DateTimeOffset GrantedAt { get; set; }
    public string? GrantedByName { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
    public string? RevokedByName { get; set; }
}

/// <summary>Đợt rà soát quyền truy cập: chụp mọi ghế đang dùng, quản lý chọn giữ / thu hồi.</summary>
public sealed class AccessReview
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public required string Title { get; set; }
    public ReviewStatus Status { get; set; }
    public DateOnly DueDate { get; set; }
    public DateTimeOffset StartedAt { get; set; }
    public string? StartedByName { get; set; }
    public DateTimeOffset? ClosedAt { get; set; }
    public string? ClosedByName { get; set; }
    public DateTimeOffset? RemindedAt { get; set; }
    public List<AccessReviewItem> Items { get; set; } = [];
}

public sealed class AccessReviewItem
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid ReviewId { get; set; }
    public Guid SeatId { get; set; }
    public Guid ServiceId { get; set; }
    public required string ServiceName { get; set; }
    public required string AccountLogin { get; set; }
    public Guid EmployeeId { get; set; }
    /// <summary>Quản lý trực tiếp lúc chụp; null = HR rà soát.</summary>
    public Guid? ReviewerEmployeeId { get; set; }
    public ReviewDecision Decision { get; set; }
    public string? Note { get; set; }
    public DateTimeOffset? DecidedAt { get; set; }
    public string? DecidedByName { get; set; }
}

/// <summary>Đợt kiểm kê thiết bị.</summary>
public sealed class Stocktake
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public required string Title { get; set; }
    public ReviewStatus Status { get; set; }
    public DateTimeOffset StartedAt { get; set; }
    public string? StartedByName { get; set; }
    public DateTimeOffset? ClosedAt { get; set; }
    public string? ClosedByName { get; set; }
    public List<StocktakeItem> Items { get; set; } = [];
}

public sealed class StocktakeItem
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid StocktakeId { get; set; }
    public Guid DeviceId { get; set; }
    public required string DeviceCode { get; set; }
    public required string DeviceName { get; set; }
    public string? SerialNumber { get; set; }
    public Guid? ExpectedHolderEmployeeId { get; set; }
    public StocktakeResult Result { get; set; }
    public string? Note { get; set; }
    public DateTimeOffset? CheckedAt { get; set; }
    public string? CheckedByName { get; set; }
}

/// <summary>Bộ đếm mã thiết bị theo loại.</summary>
public sealed class Sequence
{
    public required string Scope { get; set; }
    public int Value { get; set; }
}

/// <summary>Đã báo HR về nhân viên nghỉ việc còn giữ tài sản (một lần mỗi người).</summary>
public sealed class OffboardingNotice
{
    public Guid EmployeeId { get; set; }
    public DateTimeOffset NotifiedAt { get; set; }
}

/// <summary>Ảnh / hoá đơn / tệp khác của thiết bị (S3 <c>assets/devices/</c>). Xoá = ẩn, file giữ lại.</summary>
public sealed class DeviceAttachment
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid DeviceId { get; set; }
    public AttachmentKind Kind { get; set; }
    public required string FileName { get; set; }
    public required string ContentType { get; set; }
    public long Size { get; set; }
    public required string FileKey { get; set; }
    /// <summary>false = đã cấp link tải lên nhưng trình duyệt chưa xác nhận.</summary>
    public bool Ready { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public Guid CreatedByUserId { get; set; }
    public required string CreatedByName { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }
    public string? DeletedByName { get; set; }
}

/// <summary>
/// Biên bản giao nhận (cấp / thu hồi) thiết bị: chụp thông tin lúc lập; nhân viên bấm xác nhận trong app (ghi thời điểm + IP).
/// Chỉ thêm, không xoá.
/// </summary>
public sealed class HandoverRecord
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    /// <summary>BB-{năm}-{00001}.</summary>
    public required string Number { get; set; }
    public HandoverKind Kind { get; set; }
    public Guid DeviceId { get; set; }
    public Guid AssignmentId { get; set; }
    public Guid EmployeeId { get; set; }
    public required string EmployeeCode { get; set; }
    public required string EmployeeName { get; set; }
    public string? DepartmentName { get; set; }
    public required string DeviceCode { get; set; }
    public required string DeviceName { get; set; }
    public string? CategoryName { get; set; }
    public string? Brand { get; set; }
    public string? Model { get; set; }
    public string? SerialNumber { get; set; }
    public string? Note { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public required string CreatedByName { get; set; }
    /// <summary>false = nhân viên không còn tài khoản / đã nghỉ lúc lập → không chờ xác nhận.</summary>
    public bool RequiresConfirmation { get; set; }
    public DateTimeOffset? ConfirmedAt { get; set; }
    public string? ConfirmedIp { get; set; }
    public DateTimeOffset? RemindedAt { get; set; }
}

/// <summary>Cấu hình module (một dòng): mẫu Word biên bản giao nhận riêng của công ty.</summary>
public sealed class AssetSettings
{
    public int Id { get; set; } = 1;
    public string? HandoverTemplateKey { get; set; }
    public string? HandoverTemplateName { get; set; }
    public DateTimeOffset? UpdatedAt { get; set; }
    public string? UpdatedByName { get; set; }
}
