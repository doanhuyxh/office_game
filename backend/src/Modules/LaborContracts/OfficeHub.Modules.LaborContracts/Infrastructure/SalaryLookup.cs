using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Security;
using OfficeHub.Modules.LaborContracts.Contracts;
using OfficeHub.Modules.LaborContracts.Domain;

namespace OfficeHub.Modules.LaborContracts.Infrastructure;

/// <summary>Hợp đồng phủ ngày D (bắt đầu ≤ D ≤ ngày cuối thực tế); nhiều hợp đồng → lấy hợp đồng bắt đầu muộn nhất.</summary>
internal sealed class SalaryLookup(ContractsDbContext db, IFieldEncryptor enc) : ISalaryLookup
{
    public async Task<IReadOnlyDictionary<Guid, SalaryInfo>> GetAsync(IReadOnlyCollection<Guid> employeeIds, DateOnly date, CancellationToken ct = default)
    {
        var ids = employeeIds.Distinct().ToList();
        var rows = await db.Contracts.AsNoTracking().Include(c => c.Amendments)
            .Where(c => ids.Contains(c.EmployeeId) && c.StartDate <= date).ToListAsync(ct);
        var result = new Dictionary<Guid, SalaryInfo>();
        foreach (var c in rows
                     .Where(c => ContractRules.EffectiveEnd(c.EndDate, c.TerminatedOn) is not { } end || end >= date)
                     .GroupBy(c => c.EmployeeId)
                     .Select(g => g.OrderByDescending(c => c.StartDate).First()))
        {
            var salary = ContractRules.EffectiveValue(enc.DecryptDecimal(c.SalaryEncrypted),
                c.Amendments.Select(a => (a.EffectiveDate, enc.DecryptDecimal(a.SalaryEncrypted))), date);
            var allowance = ContractRules.EffectiveValue(enc.DecryptDecimal(c.AllowanceEncrypted),
                c.Amendments.Select(a => (a.EffectiveDate, enc.DecryptDecimal(a.AllowanceEncrypted))), date);
            result[c.EmployeeId] = new SalaryInfo(c.EmployeeId, c.Id, c.Number, salary, allowance, c.Type.ToString());
        }
        return result;
    }
}
