using OfficeHub.BuildingBlocks.Auditing;
namespace OfficeHub.Modules.LaborContracts.Domain;

/// <summary>Loại hợp đồng theo Bộ luật Lao động 2019 (Điều 20) + hợp đồng thử việc (Điều 24–25).</summary>
public enum ContractType
{
    /// <summary>Không xác định thời hạn — không có ngày kết thúc.</summary>
    Indefinite = 0,
    /// <summary>Xác định thời hạn — tối đa 36 tháng.</summary>
    Fixed = 1,
    /// <summary>Thử việc — tối đa 180 ngày.</summary>
    Probation = 2,
}

/// <summary>Trạng thái tính lúc đọc theo ngày hôm nay (không lưu).</summary>
public enum ContractStatus { Upcoming, Active, Expired, Terminated }

/// <summary>Thông tin file scan lưu trên S3 (qua IFileStorage, chỉ đọc bằng presigned URL).</summary>
public sealed class StoredFile
{
    public string? Key { get; set; }
    public string? Name { get; set; }
    public string? ContentType { get; set; }
    public long? Size { get; set; }
}

/// <summary>
/// Hợp đồng lao động của một nhân viên. Lương / phụ cấp lưu dạng mã hoá (IFieldEncryptor, Encryption__Key).
/// Xoá = xoá mềm (DeletedAt); file trên S3 giữ lại.
/// </summary>
[Audited]
public sealed class LaborContract
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid EmployeeId { get; set; }
    /// <summary>Số hợp đồng, duy nhất trong các hợp đồng chưa xoá.</summary>
    public required string Number { get; set; }
    public ContractType Type { get; set; }
    public DateOnly? SignedDate { get; set; }
    public DateOnly StartDate { get; set; }
    /// <summary>Null với hợp đồng không xác định thời hạn.</summary>
    public DateOnly? EndDate { get; set; }
    public string? JobTitle { get; set; }
    public string? SalaryEncrypted { get; set; }
    public string? AllowanceEncrypted { get; set; }
    public string? Note { get; set; }

    /// <summary>Ngày chấm dứt sớm (ngày làm việc cuối). Có giá trị → trạng thái Terminated.</summary>
    public DateOnly? TerminatedOn { get; set; }
    public string? TerminationReason { get; set; }

    public StoredFile File { get; set; } = new();
    public List<ContractAmendment> Amendments { get; set; } = [];

    /// <summary>Đã nhắc sắp hết hạn (30 / 7 ngày). Sửa ngày kết thúc → xoá cờ để nhắc lại.</summary>
    public DateTimeOffset? Reminded30At { get; set; }
    public DateTimeOffset? Reminded7At { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? UpdatedAt { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }
}

/// <summary>Phụ lục: đổi nội dung / lương từ một ngày. KHÔNG đổi thời hạn hợp đồng (BLLĐ 2019 Điều 22).</summary>
[Audited]
public sealed class ContractAmendment
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid ContractId { get; set; }
    public required string Number { get; set; }
    public DateOnly EffectiveDate { get; set; }
    public required string Content { get; set; }
    /// <summary>Null = không đổi lương / phụ cấp.</summary>
    public string? SalaryEncrypted { get; set; }
    public string? AllowanceEncrypted { get; set; }
    public StoredFile File { get; set; } = new();
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>Mẫu hợp đồng Word (.docx) có trường {{Ten}} — HR tải lên, hệ thống điền từ hồ sơ + hợp đồng (Domain/DocxTemplate.cs).</summary>
[Audited]
public sealed class ContractTemplate
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public required string Name { get; set; }
    /// <summary>Gợi ý loại hợp đồng dùng mẫu này (null = mọi loại).</summary>
    public ContractType? ContractType { get; set; }
    public StoredFile File { get; set; } = new();
    /// <summary>Các trường tìm thấy trong file lúc tải lên.</summary>
    public List<string> Fields { get; set; } = [];
    public DateTimeOffset CreatedAt { get; set; }
    public string? CreatedByName { get; set; }
}
