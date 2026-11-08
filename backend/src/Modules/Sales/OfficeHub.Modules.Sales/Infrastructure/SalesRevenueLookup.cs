using Microsoft.EntityFrameworkCore;
using OfficeHub.Modules.Sales.Contracts;

namespace OfficeHub.Modules.Sales.Infrastructure;

/// <summary>Cài đặt <see cref="ISalesRevenueLookup"/> — số đã thu tính như màn Hợp đồng (<see cref="CollectedCalculator"/>).</summary>
internal sealed class SalesRevenueLookup(SalesDbContext db, CollectedCalculator calc) : ISalesRevenueLookup
{
    public async Task<IReadOnlyList<ContractRevenue>> ContractRevenueAsync(IReadOnlyCollection<Guid> contractIds, CancellationToken ct = default)
    {
        if (contractIds.Count == 0) return [];
        var rows = await db.Contracts.AsNoTracking().Include(c => c.Installments).ThenInclude(i => i.Collections)
            .Where(c => contractIds.Contains(c.Id)).OrderBy(c => c.SignedOn).ThenBy(c => c.Code).ToListAsync(ct);
        var customers = await db.Customers.AsNoTracking().Where(x => rows.Select(r => r.CustomerId).Contains(x.Id)).ToDictionaryAsync(x => x.Id, x => x.Name, ct);
        var active = await calc.ActiveCollectionIdsAsync(rows.SelectMany(c => c.Installments).SelectMany(i => i.Collections).ToList(), ct);
        return rows.Select(c =>
        {
            var cols = c.Installments.SelectMany(i => i.Collections).Where(x => active.Contains(x.Id)).OrderBy(x => x.Date).Select(x => new CollectedOn(x.Date, x.Amount)).ToList();
            return new ContractRevenue(c.Id, c.Code, c.Title, customers.GetValueOrDefault(c.CustomerId, "?"), c.Status.ToString(), c.ValueBeforeTax, c.VatRate, c.TotalValue,
                c.Installments.Where(i => !i.Cancelled).Sum(i => i.Amount), cols.Sum(x => x.Amount), cols);
        }).ToList();
    }
}
