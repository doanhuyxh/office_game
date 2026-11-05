using Microsoft.EntityFrameworkCore;
using OfficeHub.Modules.Organization.Contracts;
using OfficeHub.Modules.Organization.Domain;

namespace OfficeHub.Modules.Organization.Infrastructure;

internal sealed class EmployeeDirectory(OrgDbContext db) : IEmployeeDirectory
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
}
