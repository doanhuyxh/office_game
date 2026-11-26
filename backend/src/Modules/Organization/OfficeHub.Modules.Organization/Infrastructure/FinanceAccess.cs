using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Organization.Infrastructure;

/// <summary>
/// Quyền tài chính theo chức vụ. Đọc từ ảnh chụp nhân viên + chức vụ trong RAM (<see cref="OrgCatalog"/>, TEST-245): đổi chức vụ / quyền của
/// chức vụ / nghỉ việc → xoá cache ngay khi ghi. Scoped: nhớ kết quả trong một request để endpoint filter + handler không tra lặp.
/// </summary>
internal sealed class FinanceAccess(OrgCatalog catalog) : IFinanceAccess
{
    private readonly Dictionary<Guid, FinancePermission> _cache = [];

    public async Task<FinancePermission> GetAsync(Guid userId, CancellationToken ct = default)
    {
        if (_cache.TryGetValue(userId, out var cached)) return cached;
        var employees = await catalog.EmployeesAsync(ct);
        var bits = employees.ByUserId.TryGetValue(userId, out var e) && e.IsActive && employees.PositionByEmployee.TryGetValue(e.Id, out var positionId)
            ? (await catalog.PositionsAsync(ct)).FinanceBits.GetValueOrDefault(positionId)
            : 0;
        return _cache[userId] = FinancePermissions.Normalize(bits);
    }

    public async Task<IReadOnlyList<Guid>> ListUserIdsAsync(FinancePermission required, CancellationToken ct = default)
    {
        var employees = await catalog.EmployeesAsync(ct);
        var bits = (await catalog.PositionsAsync(ct)).FinanceBits;
        return employees.ByCode
            .Where(e => e.UserId is not null && e.IsActive && employees.PositionByEmployee.TryGetValue(e.Id, out var pid)
                        && bits.GetValueOrDefault(pid) is var b && b != 0 && FinancePermissions.Normalize(b).Has(required))
            .Select(e => e.UserId!.Value).Distinct().ToList();
    }
}
