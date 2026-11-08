using System.Text.Json.Serialization;
using OfficeHub.BuildingBlocks.Auditing;

namespace OfficeHub.Modules.Finance.Domain;

[JsonConverter(typeof(JsonStringEnumConverter<TxKind>))]
public enum TxKind { Income = 0, Expense = 1, Transfer = 2 }

[JsonConverter(typeof(JsonStringEnumConverter<TxStatus>))]
public enum TxStatus { Active = 0, Voided = 1 }

[JsonConverter(typeof(JsonStringEnumConverter<AccountKind>))]
public enum AccountKind { Cash = 0, Bank = 1 }

[JsonConverter(typeof(JsonStringEnumConverter<CategoryKind>))]
public enum CategoryKind { Income = 0, Expense = 1 }

/// <summary>Chờ duyệt → Đã duyệt (chờ chi) → Đã chi; hoặc Từ chối / Đã huỷ. Huỷ giao dịch chi → quay lại Đã duyệt.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<ExpenseStatus>))]
public enum ExpenseStatus { Pending = 0, Approved = 1, Rejected = 2, Cancelled = 3, Paid = 4 }

/// <summary>Mảng kinh doanh (Chung, Outsource, Affiliate, Kênh MXH…). Giao dịch, hợp đồng, dự án đều gắn một mảng.</summary>
[Audited]
public sealed class BusinessLine
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public required string Code { get; set; }
    public required string Name { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
}

/// <summary>Quỹ tiền mặt / tài khoản ngân hàng. Không gắn [Audited]: số dư đầu kỳ là số tiền, màn "Lịch sử sửa" thì HR cũng xem được.</summary>
public sealed class MoneyAccount
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public required string Name { get; set; }
    public AccountKind Kind { get; set; }
    public string? BankName { get; set; }
    /// <summary>4 số cuối tài khoản — không lưu số đầy đủ.</summary>
    public string? Last4 { get; set; }
    public long OpeningBalance { get; set; }
    public DateOnly OpeningDate { get; set; }
    public bool IsActive { get; set; } = true;
    public int SortOrder { get; set; }
}

[Audited]
public sealed class TxCategory
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public required string Name { get; set; }
    public CategoryKind Kind { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
}

/// <summary>
/// Một dòng sổ thu chi (VND, số nguyên dương). Không xoá — chỉ huỷ kèm lý do. Chuyển quỹ: trừ AccountId, cộng ToAccountId.
/// <see cref="SourceType"/> + <see cref="SourceId"/> (duy nhất khi còn hiệu lực) chống ghi trùng khi sinh từ module khác (vd đề nghị chi).
/// </summary>
public sealed class LedgerEntry
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public TxKind Kind { get; set; }
    public DateOnly Date { get; set; }
    public long Amount { get; set; }
    public Guid AccountId { get; set; }
    public Guid? ToAccountId { get; set; }
    public Guid? CategoryId { get; set; }
    public Guid? BusinessLineId { get; set; }
    /// <summary>Dự án (module Projects) — thu / chi trực tiếp của dự án, vào báo cáo lãi / lỗ dự án. Không FK chéo schema. Chuyển quỹ: luôn null.</summary>
    public Guid? ProjectId { get; set; }
    public string? Counterparty { get; set; }
    public string? Description { get; set; }
    /// <summary>Số hoá đơn VAT (chỉ ghi lại, hệ thống không phát hành hoá đơn).</summary>
    public string? InvoiceNumber { get; set; }
    public string? SourceType { get; set; }
    public Guid? SourceId { get; set; }
    public TxStatus Status { get; set; }
    public string? VoidReason { get; set; }
    public DateTimeOffset? VoidedAt { get; set; }
    public string? VoidedByName { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public Guid CreatedByUserId { get; set; }
    public string CreatedByName { get; set; } = "";
}

/// <summary>Đề nghị chi tiền. Ai cũng gửi; duyệt [Quản lý → người có quyền Duyệt chi]; người có quyền Ghi sổ bấm "Đã chi".</summary>
public sealed class ExpenseRequest
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    /// <summary>Số thứ tự tự tăng (mã hiển thị: <see cref="LedgerRules.ExpenseCode"/>).</summary>
    public long Number { get; set; }
    public Guid RequesterEmployeeId { get; set; }
    public long Amount { get; set; }
    public required string Reason { get; set; }
    public string? Payee { get; set; }
    public Guid? CategoryId { get; set; }
    public Guid? BusinessLineId { get; set; }
    /// <summary>Chi cho dự án (module Projects) → dòng chi khi "Đã chi" mang theo dự án.</summary>
    public Guid? ProjectId { get; set; }
    public DateOnly? NeededBy { get; set; }
    public ExpenseStatus Status { get; set; }
    public Guid? ApprovalRequestId { get; set; }
    public string? RejectReason { get; set; }
    public Guid? PaidEntryId { get; set; }
    public DateTimeOffset? PaidAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>Cấu hình một dòng (Id = 1): khoá sổ đến hết ngày <see cref="LockedThrough"/>.</summary>
[Audited]
public sealed class FinanceSettings
{
    public int Id { get; set; } = 1;
    public DateOnly? LockedThrough { get; set; }
}

[JsonConverter(typeof(JsonStringEnumConverter<AttachmentOwner>))]
public enum AttachmentOwner { Entry = 0, Expense = 1 }

/// <summary>
/// Chứng từ (hoá đơn, biên nhận, sao kê…) gắn dòng sổ hoặc đề nghị chi. File ở S3 <c>finance/…</c>, trình duyệt tải thẳng (presigned PUT) rồi xác nhận
/// (<see cref="Ready"/>). Không xoá hẳn: xoá = ẩn (<see cref="DeletedAt"/>), file giữ lại để đối chiếu.
/// </summary>
public sealed class FinanceAttachment
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public AttachmentOwner OwnerType { get; set; }
    public Guid OwnerId { get; set; }
    public required string FileKey { get; set; }
    public required string FileName { get; set; }
    public required string ContentType { get; set; }
    public long Size { get; set; }
    public bool Ready { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public Guid CreatedByUserId { get; set; }
    public string CreatedByName { get; set; } = "";
    public DateTimeOffset? DeletedAt { get; set; }
    public string? DeletedByName { get; set; }
}
