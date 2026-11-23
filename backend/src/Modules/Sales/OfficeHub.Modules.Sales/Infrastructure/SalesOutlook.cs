using Microsoft.EntityFrameworkCore;
using OfficeHub.Modules.Sales.Contracts;
using OfficeHub.Modules.Sales.Domain;

namespace OfficeHub.Modules.Sales.Infrastructure;

/// <summary>
/// Cài đặt <see cref="ISalesOutlook"/> — số toàn công ty cho Tổng quan giám đốc (TEST-220). Công nợ tính như <c>ContractEndpoints.ReceivablesAsync</c>
/// (đã thu qua <see cref="CollectedCalculator"/>, trạng thái / tuổi nợ qua <see cref="SalesRules"/>), pipeline qua <see cref="SalesRules.Weighted"/>.
/// </summary>
internal sealed class SalesOutlook(SalesDbContext db, CollectedCalculator calc, SalesClock clock) : ISalesOutlook
{
    public async Task<ReceivablesOutlook> ReceivablesAsync(CancellationToken ct = default)
    {
        var items = await db.Installments.AsNoTracking().Include(i => i.Collections)
            .Where(i => !i.Cancelled && db.Contracts.Any(c => c.Id == i.ContractId && c.Status == ContractStatus.Active)).ToListAsync(ct);
        var collected = await calc.ByInstallmentAsync(items, ct);
        return SalesRules.SummarizeReceivables(items.Select(i => (i.Amount, collected[i.Id], i.DueOn)), clock.Today);
    }

    public async Task<PipelineOutlook> PipelineAsync(CancellationToken ct = default)
    {
        var open = await db.Opportunities.AsNoTracking().Where(o => o.Stage != OpportunityStage.Won && o.Stage != OpportunityStage.Lost)
            .Select(o => new { o.Stage, o.Value, o.Probability }).ToListAsync(ct);
        return SalesRules.SummarizePipeline(open.Select(o => (o.Stage, o.Value, o.Probability)));
    }
}
