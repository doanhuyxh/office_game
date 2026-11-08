using Microsoft.EntityFrameworkCore;
using OfficeHub.Modules.Finance.Contracts;
using OfficeHub.Modules.Finance.Domain;
using OfficeHub.Modules.Finance.Features;

namespace OfficeHub.Modules.Finance.Infrastructure;

/// <summary>Cài đặt <see cref="IFinanceLedger"/>: cùng quy tắc kiểm tra với màn ghi sổ (<see cref="LedgerEndpoints.ValidateAsync"/>).</summary>
internal sealed class FinanceLedger(FinanceDbContext db, FinanceClock clock) : IFinanceLedger
{
    public async Task<LedgerWriteResult> RecordIncomeAsync(LedgerIncome x, CancellationToken ct = default)
    {
        var create = new CreateEntry(TxKind.Income, x.Date, x.Amount, x.AccountId, null, x.CategoryId, x.BusinessLineId, x.Counterparty, x.Description, x.InvoiceNumber);
        var v = await LedgerEndpoints.ValidateAsync(create, db, clock, ct);
        if (v.Failed) return new LedgerWriteResult(null, v.Errors.ToDictionary(e => e.Key, e => e.Value[0]));
        if (await db.Entries.AnyAsync(e => e.SourceType == x.SourceType && e.SourceId == x.SourceId && e.Status == TxStatus.Active, ct))
            return new LedgerWriteResult(null, new Dictionary<string, string> { ["sourceId"] = "Khoản này đã được ghi sổ" });
        var entry = LedgerEndpoints.Build(create, x.CreatedByUserId, x.CreatedByName, clock.Now);
        entry.SourceType = x.SourceType;
        entry.SourceId = x.SourceId;
        db.Entries.Add(entry);
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException)
        {
            db.Entries.Remove(entry);
            return new LedgerWriteResult(null, new Dictionary<string, string> { ["sourceId"] = "Khoản này vừa được ghi sổ bởi người khác" });
        }
        return new LedgerWriteResult(entry.Id, new Dictionary<string, string>());
    }

    public async Task<IReadOnlyDictionary<Guid, long>> ActiveSourcesAsync(string sourceType, IReadOnlyCollection<Guid> sourceIds, CancellationToken ct = default)
    {
        if (sourceIds.Count == 0) return new Dictionary<Guid, long>();
        return await db.Entries.AsNoTracking()
            .Where(e => e.SourceType == sourceType && e.SourceId != null && sourceIds.Contains(e.SourceId.Value) && e.Status == TxStatus.Active)
            .ToDictionaryAsync(e => e.SourceId!.Value, e => e.Amount, ct);
    }
}
