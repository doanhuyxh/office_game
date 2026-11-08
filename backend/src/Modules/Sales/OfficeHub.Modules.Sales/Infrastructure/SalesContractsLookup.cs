using Microsoft.EntityFrameworkCore;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Organization.Contracts;
using OfficeHub.Modules.Sales.Contracts;
using OfficeHub.Modules.Sales.Domain;

namespace OfficeHub.Modules.Sales.Infrastructure;

internal sealed class SalesContractsLookup(SalesDbContext db, IEmployeeDirectory dir, IFinanceAccess finance, INotifier notifier) : ISalesContractsLookup
{
    private async Task<List<SalesContractRef>> RefsAsync(IQueryable<SalesContract> q, CancellationToken ct)
    {
        var rows = await q.AsNoTracking().Select(c => new { c.Id, c.Code, c.Title, c.CustomerId, c.Status, c.BusinessLineId }).ToListAsync(ct);
        var names = await db.Customers.AsNoTracking().Where(x => rows.Select(r => r.CustomerId).Contains(x.Id)).ToDictionaryAsync(x => x.Id, x => x.Name, ct);
        return rows.Select(r => new SalesContractRef(r.Id, r.Code, r.Title, names.GetValueOrDefault(r.CustomerId, "?"), r.Status.ToString(), r.BusinessLineId)).ToList();
    }

    public async Task<SalesContractRef?> GetAsync(Guid contractId, CancellationToken ct = default) =>
        (await RefsAsync(db.Contracts.Where(c => c.Id == contractId), ct)).FirstOrDefault();

    public async Task<IReadOnlyList<SalesContractRef>> GetManyAsync(IReadOnlyCollection<Guid> contractIds, CancellationToken ct = default) =>
        contractIds.Count == 0 ? [] : await RefsAsync(db.Contracts.Where(c => contractIds.Contains(c.Id)), ct);

    public async Task<IReadOnlyList<SalesContractRef>> SearchActiveAsync(string? search, CancellationToken ct = default)
    {
        var q = db.Contracts.Where(c => c.Status == ContractStatus.Active);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var p = $"%{search.Trim()}%";
            q = q.Where(c => EF.Functions.ILike(c.Code, p) || EF.Functions.ILike(c.Title, p) || db.Customers.Any(x => x.Id == c.CustomerId && EF.Functions.ILike(x.Name, p)));
        }
        return await RefsAsync(q.OrderByDescending(c => c.SignedOn).ThenBy(c => c.Id).Take(30), ct);
    }

    public async Task<IReadOnlyList<InstallmentRef>> InstallmentsAsync(Guid contractId, CancellationToken ct = default) =>
        await db.Installments.AsNoTracking().Where(i => i.ContractId == contractId).OrderBy(i => i.Order)
            .Select(i => new InstallmentRef(i.Id, i.ContractId, i.Title, i.DueOn, i.Cancelled)).ToListAsync(ct);

    public async Task<bool> MarkAcceptedAsync(Guid installmentId, DateOnly acceptedOn, string milestoneTitle, string projectName, CancellationToken ct = default)
    {
        var i = await db.Installments.FirstOrDefaultAsync(x => x.Id == installmentId, ct);
        if (i is null || i.Cancelled) return false;
        var c = await db.Contracts.AsNoTracking().FirstAsync(x => x.Id == i.ContractId, ct);
        if (i.DueOn > acceptedOn)
        {
            i.DueOn = acceptedOn;
            i.RemindedSoonAt = null; i.RemindedDueAt = null; i.LastOverdueRemindOn = null; // để job nhắc lại theo hạn mới
            await db.SaveChangesAsync(ct);
        }
        var owner = (await dir.GetAsync(c.OwnerEmployeeId, ct))?.UserId;
        var to = (await finance.ListUserIdsAsync(FinancePermission.Record, ct)).Concat(owner is { } o ? [o] : []).Distinct().ToList();
        await notifier.NotifyAsync(new NotificationRequest(to, NotificationCategories.ReceivableDue, $"Đã nghiệm thu: {milestoneTitle} — đến hạn thu HĐ {c.Code}",
            $"Dự án {projectName} nghiệm thu ngày {acceptedOn:dd/MM/yyyy}. Đợt thu \"{i.Title}\" đến hạn {i.DueOn:dd/MM/yyyy}.", "/sales?tab=receivables"), ct);
        return true;
    }
}
