using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.Modules.Documents.Domain;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Documents.Infrastructure;

/// <summary>Người đang thao tác + phạm vi kho được vào (tính một lần mỗi request).</summary>
internal sealed record Viewer(
    Guid UserId,
    string Name,
    bool IsHr,
    EmployeeRef? Employee,
    /// <summary>Phòng ban được đọc / ghi: phòng mình, phòng cha của nó, và mọi phòng con của phòng mình làm trưởng.</summary>
    IReadOnlySet<Guid> Departments,
    /// <summary>Phòng ban mình quản lý kho (trưởng phòng + phòng con).</summary>
    IReadOnlySet<Guid> ManagedDepartments,
    IReadOnlyDictionary<Guid, ProjectRole> Projects);

/// <summary>
/// Phân quyền kho tài liệu — MỌI kiểm tra quyền đi qua đây (FE chỉ hiển thị theo cờ can… trả về).
/// Kho công ty: mọi người đọc / ghi, HR quản lý. Kho phòng ban: thành viên (gồm phòng cha / con như trên), trưởng phòng quản lý.
/// Kho dự án: thành viên, quản lý dự án quản lý; dự án đã đóng chỉ đọc. HR / admin: toàn quyền mọi kho.
/// Mức bảo mật: hiện chỉ "Nội bộ"; Restricted / Confidential (để sẵn) → chỉ HR xem.
/// </summary>
internal sealed class DocumentAccess(DocumentsDbContext db, IEmployeeDirectory dir)
{
    private Viewer? _viewer;
    private IReadOnlyList<DepartmentRef>? _departments;

    public async Task<IReadOnlyList<DepartmentRef>> DepartmentsAsync(CancellationToken ct) =>
        _departments ??= await dir.ListDepartmentsAsync(ct);

    public async Task<Viewer> ViewerAsync(ClaimsPrincipal user, CancellationToken ct)
    {
        if (_viewer is not null) return _viewer;
        var uid = user.GetUserId()!.Value;
        var emp = await dir.GetByUserIdAsync(uid, ct);
        if (emp is { IsActive: false }) emp = null;
        var depts = await DepartmentsAsync(ct);
        var read = new HashSet<Guid>();
        var managed = new HashSet<Guid>();
        if (emp?.DepartmentId is { } own)
        {
            var byId = depts.ToDictionary(d => d.Id);
            for (Guid? d = own; d is { } id && byId.ContainsKey(id) && read.Add(id);) d = byId[id].ParentId; // phòng mình + các phòng cha
        }
        if (emp is not null)
            foreach (var head in depts.Where(d => d.HeadEmployeeId == emp.Id))
                foreach (var id in Descendants(depts, head.Id)) { managed.Add(id); read.Add(id); }
        var projects = emp is null ? new Dictionary<Guid, ProjectRole>()
            : await db.ProjectMembers.AsNoTracking().Where(m => m.EmployeeId == emp.Id).ToDictionaryAsync(m => m.ProjectId, m => m.Role, ct);
        return _viewer = new Viewer(uid, user.FindFirstValue(ClaimNames.FullName) ?? user.Identity?.Name ?? "", user.IsHr(), emp, read, managed, projects);
    }

    /// <summary>Phòng ban + mọi phòng con (chống vòng lặp).</summary>
    internal static IEnumerable<Guid> Descendants(IReadOnlyList<DepartmentRef> all, Guid root)
    {
        var seen = new HashSet<Guid>();
        var stack = new Stack<Guid>([root]);
        while (stack.Count > 0)
        {
            var id = stack.Pop();
            if (!seen.Add(id)) continue;
            yield return id;
            foreach (var c in all.Where(d => d.ParentId == id)) stack.Push(c.Id);
        }
    }

    public static bool CanRead(Viewer v, SpaceKind kind, Guid? spaceId) => v.IsHr || kind switch
    {
        SpaceKind.Company => true,
        SpaceKind.Department => spaceId is { } d && v.Departments.Contains(d),
        SpaceKind.Project => spaceId is { } p && v.Projects.ContainsKey(p),
        _ => false,
    };

    /// <summary>Ghi (tải lên, tạo thư mục, sửa thông tin): như đọc; dự án đã đóng thì không ai ghi được.</summary>
    public async Task<bool> CanWriteAsync(Viewer v, SpaceKind kind, Guid? spaceId, CancellationToken ct)
    {
        if (!CanRead(v, kind, spaceId)) return false;
        if (kind != SpaceKind.Project) return true;
        return await db.Projects.AnyAsync(p => p.Id == spaceId && p.Status == ProjectStatus.Active, ct);
    }

    /// <summary>Quản lý kho: xoá / sửa thư mục và tài liệu của người khác, đổi người phụ trách, lưu trữ, xem nhật ký truy cập.</summary>
    public static bool CanManage(Viewer v, SpaceKind kind, Guid? spaceId) => v.IsHr || kind switch
    {
        SpaceKind.Department => spaceId is { } d && v.ManagedDepartments.Contains(d),
        SpaceKind.Project => spaceId is { } p && v.Projects.TryGetValue(p, out var r) && r == ProjectRole.Manager,
        _ => false,
    };

    /// <summary>Xem một tài liệu: đọc được kho + mức bảo mật cho phép (hiện chỉ Nội bộ; mức cao hơn chỉ HR).</summary>
    public static bool CanView(Viewer v, Asset a) =>
        CanRead(v, a.SpaceKind, a.SpaceId) && (a.Classification == Classification.Internal || v.IsHr);

    public static bool IsOwner(Viewer v, Asset a) =>
        a.CreatedByUserId == v.UserId || (v.Employee is { } e && a.CustodianEmployeeId == e.Id);

    /// <summary>Tên + mã kho (mã dùng trong mã tài sản / số hiệu). null = kho không tồn tại.</summary>
    public async Task<(string Name, string Code)?> SpaceAsync(SpaceKind kind, Guid? spaceId, CancellationToken ct)
    {
        switch (kind)
        {
            case SpaceKind.Company:
                return spaceId is null ? ("Công ty", DocumentRules.CompanySpaceCode) : null;
            case SpaceKind.Department:
                var d = (await DepartmentsAsync(ct)).FirstOrDefault(x => x.Id == spaceId);
                return d is null ? null : (d.Name, DocumentRules.SpaceCode(kind, d.Code));
            case SpaceKind.Project:
                var p = await db.Projects.AsNoTracking().Where(x => x.Id == spaceId).Select(x => new { x.Name, x.Code }).FirstOrDefaultAsync(ct);
                return p is null ? null : (p.Name, DocumentRules.SpaceCode(kind, p.Code));
            default:
                return null;
        }
    }
}

/// <summary>Ngày / năm theo lịch văn phòng (Office__TimeZone).</summary>
internal sealed class DocClock(TimeProvider clock, IOptions<OfficeSettings> office)
{
    private readonly TimeZoneInfo _tz = TimeZoneInfo.FindSystemTimeZoneById(office.Value.TimeZone);
    public DateTimeOffset Now => clock.GetUtcNow();
    public DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), _tz).DateTime);
    public DateOnly DateOf(DateTimeOffset t) => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(t, _tz).DateTime);
}
