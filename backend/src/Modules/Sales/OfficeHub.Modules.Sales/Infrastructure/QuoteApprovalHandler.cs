using Microsoft.EntityFrameworkCore;
using OfficeHub.Modules.Approval.Contracts;
using OfficeHub.Modules.Sales.Domain;

namespace OfficeHub.Modules.Sales.Infrastructure;

/// <summary>
/// Kết quả duyệt chiết khấu báo giá (idempotent — chỉ áp dụng khi báo giá còn "Chờ duyệt"). Duyệt → Sẵn sàng gửi khách; từ chối → về Nháp kèm lý do;
/// người gửi huỷ đơn duyệt → về Nháp. Module Approval tự báo người gửi.
/// </summary>
internal sealed class QuoteApprovalHandler(SalesDbContext db) : IApprovalHandler
{
    public string Type => ApprovalTypes.QuoteDiscount;

    public Task OnApprovedAsync(Guid subjectId, CancellationToken ct) => MoveAsync(subjectId, QuoteStatus.Ready, null, ct);
    public Task OnRejectedAsync(Guid subjectId, string? comment, CancellationToken ct) => MoveAsync(subjectId, QuoteStatus.Draft, comment ?? "Không duyệt chiết khấu", ct);
    public Task OnCancelledAsync(Guid subjectId, CancellationToken ct) => MoveAsync(subjectId, QuoteStatus.Draft, null, ct);

    private async Task MoveAsync(Guid id, QuoteStatus to, string? comment, CancellationToken ct)
    {
        var q = await db.Quotes.FirstOrDefaultAsync(x => x.ApprovalSubjectId == id, ct); // id = mã vòng duyệt, không phải Id báo giá
        if (q is null || q.Status != QuoteStatus.PendingApproval) return;
        q.Status = to;
        q.ApprovalComment = comment is { Length: > 500 } ? comment[..500] : comment;
        if (to == QuoteStatus.Draft) q.ApprovalRequestId = null;
        await db.SaveChangesAsync(ct);
    }
}
