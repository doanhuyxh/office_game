using System.Collections.Frozen;
using System.Collections.Immutable;
using System.ComponentModel;
using OfficeHub.BuildingBlocks.Caching;
using OfficeHub.BuildingBlocks.Security;
using OfficeHub.BuildingBlocks.Text;
using Microsoft.EntityFrameworkCore;
using OfficeHub.Modules.Organization.Contracts;
using OfficeHub.Modules.Organization.Domain;

namespace OfficeHub.Modules.Organization.Infrastructure;

/// <summary>
/// Tag (= khoá) cache danh mục của module Organization (TEST-245). Xoá tự động khi bảng nguồn bị ghi (OrganizationModule → AddCatalogCache):
/// employees → <see cref="Employees"/> (gồm cây quản lý, chức vụ của từng người); departments → <see cref="Departments"/> + <see cref="Employees"/>
/// (EmployeeRef có tên phòng); positions → <see cref="Positions"/>.
/// </summary>
public static class OrgCacheTags
{
    public const string Employees = "org:employees";
    public const string Departments = "org:departments";
    public const string Positions = "org:positions";
}

/// <summary>Ảnh chụp mọi nhân viên (chưa xoá mềm, gồm cả người đã nghỉ) — bất biến, dùng chung giữa các request.</summary>
[ImmutableObject(true)]
internal sealed record OrgEmployeesSnapshot(
    ImmutableArray<EmployeeRef> ByCode,
    FrozenDictionary<Guid, EmployeeRef> ById,
    FrozenDictionary<Guid, EmployeeRef> ByUserId,
    FrozenDictionary<Guid, Guid> PositionByEmployee,
    FrozenDictionary<Guid, ImmutableArray<Guid>> ChildrenByManager);

[ImmutableObject(true)]
internal sealed record OrgDepartmentsSnapshot(ImmutableArray<DepartmentRef> Items);

/// <param name="FinanceBits">Quyền tài chính (bit thô <c>Position.FinancePermissions</c>) theo id chức vụ — cho <see cref="FinanceAccess"/>.</param>
[ImmutableObject(true)]
internal sealed record OrgPositionsSnapshot(FrozenDictionary<Guid, PositionRef> ById, FrozenDictionary<Guid, int> FinanceBits);

/// <summary>
/// Đọc ảnh chụp danh mục Organization qua <see cref="CatalogCache"/> (scoped — loader dùng OrgDbContext của request).
/// Dùng chung cho <see cref="EmployeeDirectory"/> và <see cref="FinanceAccess"/>; chỉ trong module này.
/// </summary>
internal sealed class OrgCatalog(OrgDbContext db, CatalogCache cache)
{
    public ValueTask<OrgEmployeesSnapshot> EmployeesAsync(CancellationToken ct) =>
        cache.GetAsync(OrgCacheTags.Employees, OrgCacheTags.Employees, LoadEmployeesAsync, ct);

    private async Task<OrgEmployeesSnapshot> LoadEmployeesAsync(CancellationToken ct)
    {
        var rows = await (from e in db.Employees.AsNoTracking()
                          join d in db.Departments on e.DepartmentId equals d.Id into dj
                          from d in dj.DefaultIfEmpty()
                          orderby e.Code
                          select new
                          {
                              e.Id, e.Code, e.FullName, e.UserId, e.DepartmentId, DepartmentName = d != null ? d.Name : null, e.ManagerId,
                              e.Status, e.JoinedAt, e.LeftAt, e.AvatarKey, e.PositionId,
                          }).ToListAsync(ct);
        var refs = rows.Select(r => new EmployeeRef(r.Id, r.Code, r.FullName, r.UserId, r.DepartmentId, r.DepartmentName, r.ManagerId,
            r.Status != EmployeeStatus.Resigned, r.JoinedAt, r.LeftAt, Features.Profile.ProfileEndpoints.AvatarUrl(r.Id, r.AvatarKey))).ToImmutableArray();
        return new OrgEmployeesSnapshot(
            refs,
            refs.ToFrozenDictionary(e => e.Id),
            refs.Where(e => e.UserId is not null).ToFrozenDictionary(e => e.UserId!.Value),
            rows.Where(r => r.PositionId is not null).ToFrozenDictionary(r => r.Id, r => r.PositionId!.Value),
            refs.Where(e => e.ManagerId is not null).GroupBy(e => e.ManagerId!.Value)
                .ToFrozenDictionary(g => g.Key, g => g.Select(e => e.Id).ToImmutableArray()));
    }

    public ValueTask<OrgDepartmentsSnapshot> DepartmentsAsync(CancellationToken ct) =>
        cache.GetAsync(OrgCacheTags.Departments, OrgCacheTags.Departments, async c => new OrgDepartmentsSnapshot((await db.Departments.AsNoTracking()
            .OrderBy(d => d.SortOrder).ThenBy(d => d.Name)
            .Select(d => new DepartmentRef(d.Id, d.Code, d.Name, d.ParentId, d.HeadEmployeeId)).ToListAsync(c)).ToImmutableArray()), ct);

    public ValueTask<OrgPositionsSnapshot> PositionsAsync(CancellationToken ct) =>
        cache.GetAsync(OrgCacheTags.Positions, OrgCacheTags.Positions, async c =>
        {
            var rows = await db.Positions.AsNoTracking()
                .Select(p => new { p.Id, p.Name, p.Level, p.SelfPublishDocuments, p.ManageTaskColumns, p.PostNewsViaAi, p.FinancePermissions }).ToListAsync(c);
            return new OrgPositionsSnapshot(
                rows.ToFrozenDictionary(p => p.Id,
                    p => new PositionRef(p.Id, p.Name, p.Level, p.SelfPublishDocuments && PositionLadder.CanSelfPublish(p.Level), p.ManageTaskColumns, p.PostNewsViaAi)),
                rows.ToFrozenDictionary(p => p.Id, p => p.FinancePermissions));
        }, ct);
}

/// <summary>
/// Tra cứu nhân viên / phòng ban / chức vụ cho module khác. Danh mục nhỏ, đọc ở gần như mọi request → đọc từ ảnh chụp trong RAM
/// (<see cref="CatalogCache"/>, TTL 5 phút, xoá ngay khi ghi — TEST-245). Tìm kiếm, hồ sơ chi tiết, tài khoản ngân hàng vẫn đọc DB.
/// Kết quả trả ra là record bất biến / danh sách mới — nơi gọi không sửa được ảnh chụp.
/// </summary>
internal sealed class EmployeeDirectory(OrgDbContext db, IFieldEncryptor enc, OrgCatalog catalog) : IEmployeeDirectory
{
    private ValueTask<OrgEmployeesSnapshot> EmployeesAsync(CancellationToken ct) => catalog.EmployeesAsync(ct);
    private ValueTask<OrgDepartmentsSnapshot> DepartmentsAsync(CancellationToken ct) => catalog.DepartmentsAsync(ct);
    private ValueTask<OrgPositionsSnapshot> PositionsAsync(CancellationToken ct) => catalog.PositionsAsync(ct);

    public async Task<EmployeeRef?> GetByUserIdAsync(Guid userId, CancellationToken ct = default) =>
        (await EmployeesAsync(ct)).ByUserId.GetValueOrDefault(userId);

    public async Task<EmployeeRef?> GetAsync(Guid employeeId, CancellationToken ct = default) =>
        (await EmployeesAsync(ct)).ById.GetValueOrDefault(employeeId);

    public async Task<IReadOnlyDictionary<Guid, EmployeeRef>> GetManyAsync(IReadOnlyCollection<Guid> employeeIds, CancellationToken ct = default)
    {
        var result = new Dictionary<Guid, EmployeeRef>();
        if (employeeIds.Count == 0) return result;
        var byId = (await EmployeesAsync(ct)).ById;
        foreach (var id in employeeIds)
            if (byId.TryGetValue(id, out var e)) result[id] = e;
        return result;
    }

    public async Task<IReadOnlyList<EmployeeRef>> ListActiveAsync(CancellationToken ct = default) =>
        (await EmployeesAsync(ct)).ByCode.Where(e => e.IsActive).ToList();

    /// <summary>Trần số dòng lọc thô từ DB trước khi xếp hạng trong bộ nhớ (từ khoá rỗng / quá ngắn khớp nhiều người).</summary>
    private const int SearchCandidates = 300;

    public async Task<IReadOnlyList<EmployeeMatch>> SearchActiveAsync(string? term, int limit, CancellationToken ct = default)
    {
        var tokens = PersonSearch.Tokens(term);
        var (foldFrom, foldTo) = PersonSearch.SqlFoldMap;
        var rows = from e in db.Employees.AsNoTracking()
                   where e.Status != EmployeeStatus.Resigned && e.UserId != null
                   join d in db.Departments on e.DepartmentId equals d.Id into dj
                   from d in dj.DefaultIfEmpty()
                   join p in db.Positions on e.PositionId equals p.Id into pj
                   from p in pj.DefaultIfEmpty()
                   select new
                   {
                       e.Id, e.Code, e.FullName, e.UserId, e.DepartmentId, DepartmentName = d != null ? d.Name : null, e.ManagerId,
                       e.JoinedAt, e.LeftAt, e.AvatarKey, e.JobTitle, PositionName = p != null ? p.Name : null,
                       Haystack = OrgDbContext.SqlTranslate(e.FullName + " " + e.Code + " " + (d != null ? d.Name : "") + " "
                           + (e.JobTitle ?? "") + " " + (p != null ? p.Name : ""), foldFrom, foldTo),
                   };
        // Mọi từ phải có mặt (lọc thô, không dấu, không phân biệt hoa thường); xếp hạng chi tiết làm sau trong bộ nhớ.
        foreach (var t in tokens)
        {
            var pattern = "%" + t.Replace(@"\", @"\\").Replace("%", @"\%").Replace("_", @"\_") + "%";
            rows = rows.Where(r => EF.Functions.ILike(r.Haystack, pattern, @"\"));
        }
        var found = await rows.OrderBy(r => r.Code).Take(SearchCandidates).ToListAsync(ct);
        return PersonSearch.Search(found, term, limit, r => r.FullName, r => r.Code, r => r.DepartmentName, r => r.JobTitle ?? r.PositionName)
            .Select(r => new EmployeeMatch(
                new EmployeeRef(r.Id, r.Code, r.FullName, r.UserId, r.DepartmentId, r.DepartmentName, r.ManagerId, true, r.JoinedAt, r.LeftAt,
                    Features.Profile.ProfileEndpoints.AvatarUrl(r.Id, r.AvatarKey)),
                r.JobTitle ?? r.PositionName))
            .ToList();
    }

    public async Task<IReadOnlyCollection<Guid>> GetSubordinateIdsAsync(Guid managerEmployeeId, CancellationToken ct = default)
    {
        // Cây quản lý lấy từ ảnh chụp trong RAM (xoá ngay khi đổi quản lý / nghỉ việc / xoá nhân viên) rồi duyệt cây.
        var byManager = (await EmployeesAsync(ct)).ChildrenByManager;
        var result = new HashSet<Guid>();
        var stack = new Stack<Guid>([managerEmployeeId]);
        while (stack.Count > 0)
            if (byManager.TryGetValue(stack.Pop(), out var children))
                foreach (var child in children)
                    if (result.Add(child)) stack.Push(child);
        return result;
    }

    public async Task<IReadOnlyList<EmployeeRef>> ListEmployedAsync(DateOnly from, DateOnly to, CancellationToken ct = default) =>
        (await EmployeesAsync(ct)).ByCode.Where(e => e.JoinedAt <= to && (e.LeftAt == null || e.LeftAt >= from)).ToList();

    public async Task<EmployeeProfile?> GetProfileAsync(Guid employeeId, CancellationToken ct = default)
    {
        if (await GetAsync(employeeId, ct) is not { } emp) return null;
        var row = await (from e in db.Employees.AsNoTracking().Where(e => e.Id == employeeId)
                         join p in db.Positions on e.PositionId equals p.Id into pj
                         from p in pj.DefaultIfEmpty()
                         select new { e.Email, e.Phone, e.DateOfBirth, Position = p != null ? p.Name : null,
                             e.IdNumberEncrypted, e.IdIssuedOn, e.IdIssuedPlace, e.PermanentAddress, e.CurrentAddress, e.JobTitle }).FirstOrDefaultAsync(ct);
        if (row is null) return null; // vừa bị xoá sau lần đọc ảnh chụp
        return new EmployeeProfile(emp, row.Email, row.Phone, row.DateOfBirth, row.Position,
            row.IdNumberEncrypted is null ? null : enc.Decrypt(row.IdNumberEncrypted), row.IdIssuedOn, row.IdIssuedPlace, row.PermanentAddress, row.CurrentAddress, row.JobTitle);
    }

    public async Task<PositionRef?> GetPositionAsync(Guid employeeId, CancellationToken ct = default) =>
        (await EmployeesAsync(ct)).PositionByEmployee.TryGetValue(employeeId, out var positionId)
            ? (await PositionsAsync(ct)).ById.GetValueOrDefault(positionId)
            : null;

    public async Task<IReadOnlyList<DepartmentRef>> ListDepartmentsAsync(CancellationToken ct = default) =>
        (await DepartmentsAsync(ct)).Items.ToList();

    public async Task<IReadOnlyDictionary<Guid, BankAccountInfo>> GetBankAccountsAsync(IReadOnlyCollection<Guid> employeeIds, CancellationToken ct = default)
    {
        var rows = await db.Employees.AsNoTracking().Where(e => employeeIds.Contains(e.Id) && e.BankAccountEncrypted != null)
            .Select(e => new { e.Id, e.BankName, e.BankAccountEncrypted, e.BankAccountHolder }).ToListAsync(ct);
        return rows.ToDictionary(r => r.Id, r => new BankAccountInfo(r.BankName, enc.Decrypt(r.BankAccountEncrypted!), r.BankAccountHolder));
    }
}
