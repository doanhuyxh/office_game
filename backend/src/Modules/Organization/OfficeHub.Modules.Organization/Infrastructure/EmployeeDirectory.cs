using OfficeHub.BuildingBlocks.Security;
using Microsoft.EntityFrameworkCore;
using OfficeHub.Modules.Organization.Contracts;
using OfficeHub.Modules.Organization.Domain;

namespace OfficeHub.Modules.Organization.Infrastructure;

internal sealed class EmployeeDirectory(OrgDbContext db, IFieldEncryptor enc) : IEmployeeDirectory
{
    /// <summary>Lọc trên bảng Employee TRƯỚC, rồi mới chiếu sang EmployeeRef (EF không dịch được Where trên record đã chiếu).</summary>
    private IQueryable<EmployeeRef> Project(IQueryable<Employee> employees) =>
        from e in employees.AsNoTracking()
        join d in db.Departments on e.DepartmentId equals d.Id into dj
        from d in dj.DefaultIfEmpty()
        select new EmployeeRef(e.Id, e.Code, e.FullName, e.UserId, e.DepartmentId, d != null ? d.Name : null, e.ManagerId,
            e.Status != EmployeeStatus.Resigned, e.JoinedAt, e.LeftAt);

    public Task<EmployeeRef?> GetByUserIdAsync(Guid userId, CancellationToken ct = default) =>
        Project(db.Employees.Where(e => e.UserId == userId)).FirstOrDefaultAsync(ct);

    public Task<EmployeeRef?> GetAsync(Guid employeeId, CancellationToken ct = default) =>
        Project(db.Employees.Where(e => e.Id == employeeId)).FirstOrDefaultAsync(ct);

    public async Task<IReadOnlyList<EmployeeRef>> ListActiveAsync(CancellationToken ct = default) =>
        await Project(db.Employees.Where(e => e.Status != EmployeeStatus.Resigned).OrderBy(e => e.Code)).ToListAsync(ct);

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

    public async Task<IReadOnlyDictionary<Guid, BankAccountInfo>> GetBankAccountsAsync(IReadOnlyCollection<Guid> employeeIds, CancellationToken ct = default)
    {
        var rows = await db.Employees.AsNoTracking().Where(e => employeeIds.Contains(e.Id) && e.BankAccountEncrypted != null)
            .Select(e => new { e.Id, e.BankName, e.BankAccountEncrypted, e.BankAccountHolder }).ToListAsync(ct);
        return rows.ToDictionary(r => r.Id, r => new BankAccountInfo(r.BankName, enc.Decrypt(r.BankAccountEncrypted!), r.BankAccountHolder));
    }
}
