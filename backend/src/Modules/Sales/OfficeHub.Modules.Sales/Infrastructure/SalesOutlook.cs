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

    public async Task<IReadOnlyList<OpenInstallment>> OpenInstallmentsAsync(CancellationToken ct = default)
    {
        var contracts = await db.Contracts.AsNoTracking().Where(c => c.Status == ContractStatus.Active)
            .Select(c => new { c.Id, c.Code, c.CustomerId }).ToDictionaryAsync(c => c.Id, ct);
        var ids = contracts.Keys.ToList();
        var items = await db.Installments.AsNoTracking().Include(i => i.Collections).Where(i => !i.Cancelled && ids.Contains(i.ContractId)).ToListAsync(ct);
        var collected = await calc.ByInstallmentAsync(items, ct);
        var customers = await CustomerNamesAsync(contracts.Values.Select(c => c.CustomerId), ct);
        return [.. items.Where(i => collected[i.Id] < i.Amount).OrderBy(i => i.DueOn).ThenBy(i => i.Order).Select(i =>
        {
            var c = contracts[i.ContractId];
            return new OpenInstallment(i.Id, c.Id, c.Code, c.CustomerId, customers.GetValueOrDefault(c.CustomerId, ""), i.Title, i.DueOn, i.Amount - collected[i.Id]);
        })];
    }

    public async Task<IReadOnlyList<OpenOpportunity>> OpenOpportunitiesAsync(CancellationToken ct = default)
    {
        var open = await db.Opportunities.AsNoTracking().Where(o => o.Stage != OpportunityStage.Won && o.Stage != OpportunityStage.Lost)
            .OrderBy(o => o.ExpectedCloseOn).ThenBy(o => o.Title).ToListAsync(ct);
        var customers = await CustomerNamesAsync(open.Select(o => o.CustomerId), ct);
        return [.. open.Select(o => new OpenOpportunity(o.Id, o.CustomerId, customers.GetValueOrDefault(o.CustomerId, ""), o.Title, o.Stage.ToString(),
            o.ExpectedCloseOn, o.Value, o.Probability, SalesRules.Weighted(o.Value, o.Probability, o.Stage)))];
    }

    private async Task<Dictionary<Guid, string>> CustomerNamesAsync(IEnumerable<Guid> ids, CancellationToken ct)
    {
        var list = ids.Distinct().ToList();
        return await db.Customers.AsNoTracking().Where(c => list.Contains(c.Id)).ToDictionaryAsync(c => c.Id, c => c.Name, ct);
    }
}
