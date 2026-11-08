using Microsoft.EntityFrameworkCore;
using OfficeHub.Modules.Organization.Contracts;
using OfficeHub.Modules.Organization.Domain;

namespace OfficeHub.Modules.Organization.Infrastructure;

/// <summary>Quyền tài chính theo chức vụ. Scoped: nhớ kết quả trong một request để endpoint filter + handler không truy vấn lặp.</summary>
internal sealed class FinanceAccess(OrgDbContext db) : IFinanceAccess
{
    private readonly Dictionary<Guid, FinancePermission> _cache = [];

    public async Task<FinancePermission> GetAsync(Guid userId, CancellationToken ct = default)
    {
        if (_cache.TryGetValue(userId, out var cached)) return cached;
        var bits = await (from e in db.Employees.AsNoTracking().Where(e => e.UserId == userId && e.Status != EmployeeStatus.Resigned)
                          join p in db.Positions on e.PositionId equals p.Id
                          select (int?)p.FinancePermissions).FirstOrDefaultAsync(ct);
        return _cache[userId] = FinancePermissions.Normalize(bits ?? 0);
    }

    public async Task<IReadOnlyList<Guid>> ListUserIdsAsync(FinancePermission required, CancellationToken ct = default)
    {
        var rows = await (from e in db.Employees.AsNoTracking().Where(e => e.UserId != null && e.Status != EmployeeStatus.Resigned)
                          join p in db.Positions on e.PositionId equals p.Id
                          where p.FinancePermissions != 0
                          select new { UserId = e.UserId!.Value, p.FinancePermissions }).ToListAsync(ct);
        return rows.Where(r => FinancePermissions.Normalize(r.FinancePermissions).Has(required)).Select(r => r.UserId).Distinct().ToList();
    }
}
