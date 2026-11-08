using System.Text.Json.Serialization;
using OfficeHub.BuildingBlocks.Auditing;

namespace OfficeHub.Modules.Sales.Domain;

[JsonConverter(typeof(JsonStringEnumConverter<CustomerKind>))]
public enum CustomerKind { Company = 0, Individual = 1 }

[JsonConverter(typeof(JsonStringEnumConverter<ActivityKind>))]
public enum ActivityKind { Call = 0, Meeting = 1, Email = 2, Message = 3, Note = 4 }

/// <summary>Tiềm năng → Đã liên hệ → Đã báo giá → Đàm phán → Thắng / Thua.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<OpportunityStage>))]
public enum OpportunityStage { Lead = 0, Contacted = 1, Quoted = 2, Negotiating = 3, Won = 4, Lost = 5 }

/// <summary>Kiểu thu tiền: theo mốc nghiệm thu / định kỳ hằng tháng (kênh MXH, bảo trì) / một lần.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<BillingKind>))]
public enum BillingKind { Milestone = 0, Monthly = 1, OneTime = 2 }

[JsonConverter(typeof(JsonStringEnumConverter<ContractStatus>))]
public enum ContractStatus { Active = 0, Completed = 1, Cancelled = 2 }

/// <summary>Trạng thái đợt thu — TÍNH khi đọc (<see cref="SalesRules.InstallmentStatus"/>), không lưu.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<InstallmentState>))]
public enum InstallmentState { Upcoming = 0, DueSoon = 1, Overdue = 2, Partial = 3, Paid = 4, Cancelled = 5 }

/// <summary>Khách hàng. Không xoá — chỉ ngừng. Người phụ trách quyết định ai thấy (bản thân + quản lý của họ + người có quyền Xem tài chính).</summary>
[Audited]
public sealed class Customer
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    /// <summary>Số tự tăng → mã KH-00001.</summary>
    public long Number { get; set; }
    public required string Name { get; set; }
    public CustomerKind Kind { get; set; }
    public string? TaxCode { get; set; }
    public string? Address { get; set; }
    public string? Phone { get; set; }
    public string? Email { get; set; }
    /// <summary>Nguồn khách (giới thiệu, website, hội chợ…) — chữ tự do.</summary>
    public string? Source { get; set; }
    public string? Note { get; set; }
    public Guid OwnerEmployeeId { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; }
    public List<Contact> Contacts { get; set; } = [];
}

public sealed class Contact
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid CustomerId { get; set; }
    public required string Name { get; set; }
    public string? Title { get; set; }
    public string? Phone { get; set; }
    public string? Email { get; set; }
    public bool IsPrimary { get; set; }
}

/// <summary>Nhật ký chăm sóc khách (gọi, gặp, email…) + việc tiếp theo có hẹn ngày (nhắc chuông).</summary>
public sealed class Activity
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid CustomerId { get; set; }
    public Guid? OpportunityId { get; set; }
    public ActivityKind Kind { get; set; }
    public DateTimeOffset At { get; set; }
    public required string Content { get; set; }
    public string? NextAction { get; set; }
    public DateOnly? NextActionOn { get; set; }
    public DateTimeOffset? NextActionRemindedAt { get; set; }
    public Guid CreatedByEmployeeId { get; set; }
    public string CreatedByName { get; set; } = "";
}

/// <summary>Cơ hội bán. Giá trị là dự kiến (chưa phải doanh thu). Thắng → có thể tạo hợp đồng bán từ cơ hội.</summary>
public sealed class Opportunity
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid CustomerId { get; set; }
    public required string Title { get; set; }
    public Guid? BusinessLineId { get; set; }
    public OpportunityStage Stage { get; set; }
    public long Value { get; set; }
    /// <summary>0–100 (%). Mặc định theo giai đoạn (<see cref="SalesRules.DefaultProbability"/>), người phụ trách sửa được.</summary>
    public int Probability { get; set; }
    public DateOnly? ExpectedCloseOn { get; set; }
    public string? LostReason { get; set; }
    public Guid OwnerEmployeeId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? ClosedAt { get; set; }
}

/// <summary>
/// Hợp đồng bán (với khách). Giá trị = trước thuế + VAT. File đã ký để ở kho tài liệu (chưa gắn trực tiếp).
/// <see cref="ValueBeforeTax"/> / <see cref="TotalValue"/> là giá trị HIỆN TẠI (đã cộng phụ lục còn hiệu lực); giá trị gốc = hiện tại − tổng phụ lục.
/// </summary>
public sealed class SalesContract
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    /// <summary>Số hợp đồng do người dùng nhập (theo số trên giấy), duy nhất.</summary>
    public required string Code { get; set; }
    public Guid CustomerId { get; set; }
    public Guid? OpportunityId { get; set; }
    public Guid? BusinessLineId { get; set; }
    public required string Title { get; set; }
    public long ValueBeforeTax { get; set; }
    /// <summary>Thuế suất VAT % (0, 5, 8, 10…).</summary>
    public int VatRate { get; set; }
    public long TotalValue { get; set; }
    public DateOnly SignedOn { get; set; }
    public DateOnly? EndOn { get; set; }
    public BillingKind Billing { get; set; }
    public ContractStatus Status { get; set; }
    public string? Note { get; set; }
    public Guid OwnerEmployeeId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public List<Installment> Installments { get; set; } = [];
    public List<ContractAppendix> Appendices { get; set; } = [];
}

/// <summary>
/// Phụ lục hợp đồng: tăng / giảm giá trị trước thuế (VAT theo thuế suất của hợp đồng), có thể kèm đợt thu mới, có thể lập từ yêu cầu thay đổi (CR) của dự án.
/// Lập → cộng <see cref="TotalDelta"/> vào giá trị hợp đồng; huỷ (khi các đợt của nó chưa thu tiền) → trừ lại + huỷ các đợt đó.
/// </summary>
public sealed class ContractAppendix
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid ContractId { get; set; }
    /// <summary>Số phụ lục (theo giấy), duy nhất trong hợp đồng.</summary>
    public required string Code { get; set; }
    public required string Title { get; set; }
    public DateOnly SignedOn { get; set; }
    /// <summary>Âm = giảm giá trị.</summary>
    public long ValueBeforeTaxDelta { get; set; }
    public long TotalDelta { get; set; }
    /// <summary>Yêu cầu thay đổi (module Projects) — không FK chéo schema.</summary>
    public Guid? ChangeRequestId { get; set; }
    public string? Note { get; set; }
    public bool Cancelled { get; set; }
    public string? CancelReason { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public string CreatedByName { get; set; } = "";
}

/// <summary>Đợt thu (công nợ phải thu). Số đã thu = tổng các lần thu còn dòng sổ hiệu lực ở Finance.</summary>
public sealed class Installment
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid ContractId { get; set; }
    public int Order { get; set; }
    public required string Title { get; set; }
    public DateOnly DueOn { get; set; }
    public long Amount { get; set; }
    public bool Cancelled { get; set; }
    public string? CancelReason { get; set; }
    /// <summary>Đợt sinh từ phụ lục (huỷ phụ lục → huỷ đợt).</summary>
    public Guid? AppendixId { get; set; }
    // Mốc đã nhắc (để job không nhắc lặp).
    public DateTimeOffset? RemindedSoonAt { get; set; }
    public DateTimeOffset? RemindedDueAt { get; set; }
    public DateOnly? LastOverdueRemindOn { get; set; }
    public List<Collection> Collections { get; set; } = [];
}

/// <summary>Một lần khách trả tiền cho đợt thu → một dòng THU ở sổ Finance (<see cref="LedgerEntryId"/>).</summary>
public sealed class Collection
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid InstallmentId { get; set; }
    public DateOnly Date { get; set; }
    public long Amount { get; set; }
    public Guid LedgerEntryId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public string CreatedByName { get; set; } = "";
}
