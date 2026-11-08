using System.Text.Json.Serialization;
using OfficeHub.BuildingBlocks.Auditing;

namespace OfficeHub.Modules.Sales.Domain;

/// <summary>
/// Nháp → (giảm giá vượt ngưỡng: Chờ duyệt → ) Sẵn sàng → Đã gửi khách → Khách đồng ý / Khách từ chối. Tạo phiên bản mới → bản cũ "Đã thay".
/// Huỷ khi chưa có kết quả. Xem <see cref="QuoteRules"/>.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter<QuoteStatus>))]
public enum QuoteStatus { Draft = 0, PendingApproval = 1, Ready = 2, Sent = 3, Accepted = 4, Rejected = 5, Superseded = 6, Cancelled = 7 }

/// <summary>Báo giá cho khách: hạng mục (số lượng × đơn giá), chiết khấu %, VAT. Mã BG-00001 (+ "-v2"… theo phiên bản). Tiền VND số nguyên.</summary>
public sealed class Quote
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    /// <summary>Số báo giá — các phiên bản dùng chung số.</summary>
    public long Number { get; set; }
    public int Version { get; set; } = 1;
    public Guid CustomerId { get; set; }
    public Guid? OpportunityId { get; set; }
    public Guid? BusinessLineId { get; set; }
    public required string Title { get; set; }
    public DateOnly IssuedOn { get; set; }
    public DateOnly ValidUntil { get; set; }
    public int VatRate { get; set; }
    /// <summary>0–100, 2 chữ số thập phân.</summary>
    public decimal DiscountPercent { get; set; }
    public long Subtotal { get; set; }
    public long Discount { get; set; }
    public long BeforeTax { get; set; }
    public long Vat { get; set; }
    public long Total { get; set; }
    public QuoteStatus Status { get; set; }
    public string? Terms { get; set; }
    public string? Note { get; set; }
    public Guid OwnerEmployeeId { get; set; }
    public Guid? ApprovalRequestId { get; set; }
    /// <summary>
    /// Mã vòng duyệt (SubjectId gửi sang Approval) — mới cho MỖI lần gửi duyệt, vì Approval chỉ cho một đơn / (loại, SubjectId):
    /// bị từ chối → sửa → gửi lại phải là đơn mới.
    /// </summary>
    public Guid? ApprovalSubjectId { get; set; }
    /// <summary>Người duyệt từ chối chiết khấu (báo giá về Nháp).</summary>
    public string? ApprovalComment { get; set; }
    public DateTimeOffset? SentAt { get; set; }
    public DateOnly? DecidedOn { get; set; }
    public string? DecisionNote { get; set; }
    /// <summary>Hợp đồng bán lập từ báo giá này.</summary>
    public Guid? ContractId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public string CreatedByName { get; set; } = "";
    public DateTimeOffset? UpdatedAt { get; set; }
    public List<QuoteLine> Lines { get; set; } = [];
}

public sealed class QuoteLine
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid QuoteId { get; set; }
    public int Order { get; set; }
    public required string Description { get; set; }
    public string? Unit { get; set; }
    public decimal Quantity { get; set; }
    public long UnitPrice { get; set; }
    public long Amount { get; set; }
}

/// <summary>Cấu hình Kinh doanh (một dòng Id = 1): ngưỡng chiết khấu cần duyệt (Quản trị tài chính đặt), mẫu Word báo giá (S3).</summary>
[Audited]
public sealed class SalesSettings
{
    public int Id { get; set; } = 1;
    public decimal QuoteDiscountLimitPercent { get; set; } = QuoteRules.DefaultDiscountLimit;
    public string? QuoteTemplateKey { get; set; }
    public string? QuoteTemplateName { get; set; }
    public DateTimeOffset? UpdatedAt { get; set; }
    public string? UpdatedByName { get; set; }
}

public sealed record QuoteLineInput(string Description, string? Unit, decimal Quantity, long UnitPrice);
public sealed record QuoteTotals(long Subtotal, long Discount, long BeforeTax, long Vat, long Total);

/// <summary>Báo giá — hàm thuần (test: tests/OfficeHub.Modules.Sales.Tests).</summary>
public static class QuoteRules
{
    public const decimal DefaultDiscountLimit = 15;
    public const int MaxLines = 200;

    public static string Code(long number, int version) => $"BG-{number:D5}{(version > 1 ? $"-v{version}" : "")}";

    public static long LineAmount(decimal quantity, long unitPrice) => (long)Math.Round(quantity * unitPrice, MidpointRounding.AwayFromZero);

    public static QuoteTotals Totals(IEnumerable<QuoteLineInput> lines, decimal discountPercent, int vatRate)
    {
        var sub = lines.Sum(l => LineAmount(l.Quantity, l.UnitPrice));
        var disc = (long)Math.Round(sub * discountPercent / 100m, MidpointRounding.AwayFromZero);
        var before = sub - disc;
        var vat = (long)Math.Round(before * vatRate / 100m, MidpointRounding.AwayFromZero);
        return new QuoteTotals(sub, disc, before, vat, before + vat);
    }

    /// <summary>Chiết khấu VƯỢT ngưỡng (không bằng) → cần người có quyền Duyệt chi duyệt.</summary>
    public static bool NeedsApproval(decimal discountPercent, decimal limit) => discountPercent > limit;

    public static bool IsEditable(QuoteStatus s) => s == QuoteStatus.Draft;

    /// <summary>Tạo phiên bản mới từ: Sẵn sàng / Đã gửi / Khách từ chối / Nháp (không khi đang chờ duyệt — huỷ đơn duyệt trước).</summary>
    public static bool CanRevise(QuoteStatus s) => s is QuoteStatus.Draft or QuoteStatus.Ready or QuoteStatus.Sent or QuoteStatus.Rejected;

    public static bool CanCancel(QuoteStatus s) => s is QuoteStatus.Draft or QuoteStatus.Ready or QuoteStatus.Sent;

    public static List<(string Field, string Message)> Validate(IReadOnlyList<QuoteLineInput> lines, decimal discountPercent, int vatRate, DateOnly issuedOn,
        DateOnly validUntil)
    {
        var e = new List<(string, string)>();
        if (lines.Count == 0) e.Add(("lines", "Cần ít nhất một hạng mục"));
        else if (lines.Count > MaxLines) e.Add(("lines", $"Tối đa {MaxLines} hạng mục"));
        if (lines.Any(l => string.IsNullOrWhiteSpace(l.Description) || l.Description.Trim().Length > 500)) e.Add(("lines", "Mỗi hạng mục cần nội dung (≤ 500 ký tự)"));
        if (lines.Any(l => l.Unit is { Length: > 30 })) e.Add(("lines", "Đơn vị tính ≤ 30 ký tự"));
        if (lines.Any(l => l.Quantity <= 0 || l.Quantity > 1_000_000 || decimal.Round(l.Quantity, 2) != l.Quantity)) e.Add(("lines", "Số lượng > 0, tối đa 2 chữ số thập phân"));
        if (lines.Any(l => l.UnitPrice < 0 || l.UnitPrice > SalesRules.MaxAmount)) e.Add(("lines", "Đơn giá không hợp lệ"));
        if (discountPercent is < 0 or > 100 || decimal.Round(discountPercent, 2) != discountPercent) e.Add(("discountPercent", "Chiết khấu từ 0 đến 100 %"));
        if (!SalesRules.VatRates.Contains(vatRate)) e.Add(("vatRate", "Thuế suất VAT chỉ 0, 5, 8 hoặc 10 %"));
        if (validUntil < issuedOn) e.Add(("validUntil", "Hiệu lực đến trước ngày báo giá"));
        if (e.Count == 0)
        {
            var t = Totals(lines, discountPercent, vatRate);
            if (t.Subtotal <= 0) e.Add(("lines", "Tổng báo giá phải lớn hơn 0"));
            else if (t.Total > SalesRules.MaxAmount) e.Add(("lines", "Tổng báo giá quá lớn"));
        }
        return e;
    }

    /// <summary>Số lượng hiển thị kiểu VN: 1.234,5 (bỏ số 0 thừa).</summary>
    public static string Qty(decimal q) => q.ToString("#,##0.##", System.Globalization.CultureInfo.GetCultureInfo("vi-VN"));
    public static string Money(long v) => v.ToString("#,##0", System.Globalization.CultureInfo.GetCultureInfo("vi-VN"));
}
