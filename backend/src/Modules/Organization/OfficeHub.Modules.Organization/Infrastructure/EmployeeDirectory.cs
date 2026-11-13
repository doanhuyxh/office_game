using OfficeHub.BuildingBlocks.Security;
using OfficeHub.BuildingBlocks.Text;
using Microsoft.EntityFrameworkCore;
using OfficeHub.Modules.Organization.Contracts;
using OfficeHub.Modules.Organization.Domain;

namespace OfficeHub.Modules.Organization.Infrastructure;

internal sealed class EmployeeDirectory(OrgDbContext db, IFieldEncryptor enc) : IEmployeeDirectory
{
    /// <summary>Lọc trên bảng Employee TRƯỚC, rồi mới chiếu sang EmployeeRef (EF không dịch được Where trên record đã chiếu). AvatarUrl tính phía client (select cuối).</summary>
    private IQueryable<EmployeeRef> Project(IQueryable<Employee> employees) =>
        from e in employees.AsNoTracking()
        join d in db.Departments on e.DepartmentId equals d.Id into dj
        from d in dj.DefaultIfEmpty()
        select new EmployeeRef(e.Id, e.Code, e.FullName, e.UserId, e.DepartmentId, d != null ? d.Name : null, e.ManagerId,
            e.Status != EmployeeStatus.Resigned, e.JoinedAt, e.LeftAt, Features.Profile.ProfileEndpoints.AvatarUrl(e.Id, e.AvatarKey));

    public Task<EmployeeRef?> GetByUserIdAsync(Guid userId, CancellationToken ct = default) =>
        Project(db.Employees.Where(e => e.UserId == userId)).FirstOrDefaultAsync(ct);

    public Task<EmployeeRef?> GetAsync(Guid employeeId, CancellationToken ct = default) =>
        Project(db.Employees.Where(e => e.Id == employeeId)).FirstOrDefaultAsync(ct);

    public async Task<IReadOnlyList<EmployeeRef>> ListActiveAsync(CancellationToken ct = default) =>
        await Project(db.Employees.Where(e => e.Status != EmployeeStatus.Resigned).OrderBy(e => e.Code)).ToListAsync(ct);

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
        // Công ty nhỏ: nạp quan hệ quản lý vào RAM rồi duyệt cây.
        var links = await db.Employees.AsNoTracking().Where(e => e.ManagerId != null)
            .Select(e => new { e.Id, ManagerId = e.ManagerId!.Value }).ToListAsync(ct);
        var byManager = links.ToLookup(x => x.ManagerId, x => x.Id);
        var result = new HashSet<Guid>();
        var stack = new Stack<Guid>([managerEmployeeId]);
        while (stack.Count > 0)
            foreach (var child in byManager[stack.Pop()])
                if (result.Add(child)) stack.Push(child);
        return result;
    }

    public async Task<IReadOnlyList<EmployeeRef>> ListEmployedAsync(DateOnly from, DateOnly to, CancellationToken ct = default) =>
        await Project(db.Employees.Where(e => e.JoinedAt <= to && (e.LeftAt == null || e.LeftAt >= from)).OrderBy(e => e.Code)).ToListAsync(ct);

    public async Task<EmployeeProfile?> GetProfileAsync(Guid employeeId, CancellationToken ct = default)
    {
        if (await GetAsync(employeeId, ct) is not { } emp) return null;
        var row = await (from e in db.Employees.AsNoTracking().Where(e => e.Id == employeeId)
                         join p in db.Positions on e.PositionId equals p.Id into pj
                         from p in pj.DefaultIfEmpty()
                         select new { e.Email, e.Phone, e.DateOfBirth, Position = p != null ? p.Name : null,
                             e.IdNumberEncrypted, e.IdIssuedOn, e.IdIssuedPlace, e.PermanentAddress, e.CurrentAddress, e.JobTitle }).FirstAsync(ct);
        return new EmployeeProfile(emp, row.Email, row.Phone, row.DateOfBirth, row.Position,
            row.IdNumberEncrypted is null ? null : enc.Decrypt(row.IdNumberEncrypted), row.IdIssuedOn, row.IdIssuedPlace, row.PermanentAddress, row.CurrentAddress, row.JobTitle);
    }

    public async Task<PositionRef?> GetPositionAsync(Guid employeeId, CancellationToken ct = default)
    {
        var p = await (from e in db.Employees.AsNoTracking().Where(e => e.Id == employeeId)
                       join pos in db.Positions on e.PositionId equals pos.Id
                       select new { pos.Id, pos.Name, pos.Level, pos.SelfPublishDocuments, pos.ManageTaskColumns }).FirstOrDefaultAsync(ct);
        return p is null ? null : new PositionRef(p.Id, p.Name, p.Level, p.SelfPublishDocuments && PositionLadder.CanSelfPublish(p.Level), p.ManageTaskColumns);
    }

    public async Task<IReadOnlyList<DepartmentRef>> ListDepartmentsAsync(CancellationToken ct = default) =>
        await db.Departments.AsNoTracking().OrderBy(d => d.SortOrder).ThenBy(d => d.Name)
            .Select(d => new DepartmentRef(d.Id, d.Code, d.Name, d.ParentId, d.HeadEmployeeId)).ToListAsync(ct);

    public async Task<IReadOnlyDictionary<Guid, BankAccountInfo>> GetBankAccountsAsync(IReadOnlyCollection<Guid> employeeIds, CancellationToken ct = default)
    {
        var rows = await db.Employees.AsNoTracking().Where(e => employeeIds.Contains(e.Id) && e.BankAccountEncrypted != null)
            .Select(e => new { e.Id, e.BankName, e.BankAccountEncrypted, e.BankAccountHolder }).ToListAsync(ct);
        return rows.ToDictionary(r => r.Id, r => new BankAccountInfo(r.BankName, enc.Decrypt(r.BankAccountEncrypted!), r.BankAccountHolder));
    }
}
