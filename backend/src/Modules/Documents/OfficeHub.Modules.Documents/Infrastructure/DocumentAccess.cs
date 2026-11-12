using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.Modules.Documents.Domain;
using OfficeHub.Modules.Organization.Contracts;
using OfficeHub.Modules.Projects.Contracts;

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
/// Dự án + thành viên thuộc module Projects (đọc qua <see cref="IProjectDirectory"/>, từ 2026-11-08).
internal sealed class DocumentAccess(IEmployeeDirectory dir, IProjectDirectory projectDir)
{
    private Viewer? _viewer;
    private IReadOnlyList<DepartmentRef>? _departments;
    private IReadOnlyList<ProjectRef>? _projects;

    /// <summary>Mọi dự án (module Projects) — một lần mỗi request.</summary>
    public async Task<IReadOnlyList<ProjectRef>> ProjectsAsync(CancellationToken ct) => _projects ??= await projectDir.ListAsync(ct);

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
            : (await projectDir.RolesOfAsync(emp.Id, ct)).ToDictionary(x => x.Key, x => (ProjectRole)(int)x.Value);
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
        return spaceId is { } id && (await projectDir.GetAsync(id, ct))?.IsActive == true;
    }

    /// <summary>Quản lý kho: xoá / sửa thư mục và tài liệu của người khác, đổi người phụ trách, lưu trữ, xem nhật ký truy cập.</summary>
    public static bool CanManage(Viewer v, SpaceKind kind, Guid? spaceId) => v.IsHr || kind switch
    {
        SpaceKind.Department => spaceId is { } d && v.ManagedDepartments.Contains(d),
        SpaceKind.Project => spaceId is { } p && v.Projects.TryGetValue(p, out var r) && r == ProjectRole.Manager,
        _ => false,
    };

    /// <summary>
    /// Xem một tài liệu: đọc được kho + mức bảo mật cho phép. Hạn chế / Mật: chỉ admin / HR và người tạo (chủ dự án chốt 2026-11-12, TEST-54);
    /// người duyệt ban hành xem thêm khi đang chờ duyệt (<c>AssetEndpoints.CanSeeAsync</c>).
    /// </summary>
    public static bool CanView(Viewer v, Asset a) =>
        CanRead(v, a.SpaceKind, a.SpaceId) && (a.Classification == Classification.Internal || v.IsHr || a.CreatedByUserId == v.UserId);

    public static bool IsOwner(Viewer v, Asset a) =>
        a.CreatedByUserId == v.UserId || (v.Employee is { } e && a.CustodianEmployeeId == e.Id);

    /// <summary>
    /// Sửa / thay file / xoá / khôi phục / xoá hẳn / gửi duyệt / lưu trữ / đổi người phụ trách / xem nhật ký (TEST-14):
    /// quản lý kho, HOẶC người tạo / phụ trách còn quyền ghi kho. Trước đây sửa + thêm phiên bản chỉ cần quyền ghi kho (sửa được tài liệu
    /// của người khác), còn người phụ trách đã mất quyền kho vẫn xem nhật ký / khôi phục / xoá hẳn được.
    /// </summary>
    public async Task<bool> CanActAsync(Viewer v, Asset a, CancellationToken ct) =>
        CanManage(v, a.SpaceKind, a.SpaceId) || (IsOwner(v, a) && await CanWriteAsync(v, a.SpaceKind, a.SpaceId, ct));

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
                var p = spaceId is { } pid ? await projectDir.GetAsync(pid, ct) : null;
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
    public TimeZoneInfo Zone => _tz;
    public DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), _tz).DateTime);
    public DateOnly DateOf(DateTimeOffset t) => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(t, _tz).DateTime);
}
