using OfficeHub.BuildingBlocks.Hosting;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Organization.Contracts;
using OfficeHub.Modules.Projects.Contracts;
using OfficeHub.Modules.Projects.Domain;

namespace OfficeHub.Modules.Projects.Infrastructure;

internal sealed class ProjectClock(TimeProvider clock, IOptions<OfficeSettings> office)
{
    private readonly TimeZoneInfo _tz = TimeZoneInfo.FindSystemTimeZoneById(office.Value.TimeZone);
    public DateTimeOffset Now => clock.GetUtcNow();
    public DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), _tz).DateTime);
    public DateOnly DateOf(DateTimeOffset t) => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(t, _tz).DateTime);
    /// <summary>0 giờ hôm nay (giờ văn phòng) dạng UTC — đếm hạn mức theo ngày.</summary>
    public DateTimeOffset StartOfToday
    {
        get
        {
            var local = Today.ToDateTime(TimeOnly.MinValue);
            return new DateTimeOffset(local, _tz.GetUtcOffset(local)).ToUniversalTime();
        }
    }
}

/// <param name="IsHr">admin / hr: thấy + quản lý mọi dự án (như kho tài liệu dự án trước đây).</param>
/// <param name="FinanceView">quyền Xem tài chính (chức vụ): thấy mọi dự án (chỉ đọc) — để theo dõi tiến độ / ngày công + lãi / lỗ.</param>
/// <param name="FinanceAdmin">quyền Quản trị tài chính: thêm chi phí nhân công theo từng người, sửa % phân bổ tháng đã chốt.</param>
/// <param name="ManageColumns">Chức vụ có cờ "Quản lý trạng thái công việc" (vai trò admin / hr không thay thế — chủ dự án chốt 2026-11-11).</param>
/// <param name="DeptProjects">Dự án có phòng ban của người xem tham gia (đúng phòng, không tính phòng con — TEST-40): chỉ được XEM.</param>
internal sealed record ProjectViewer(Guid UserId, string Name, bool IsHr, bool CanCreate, bool FinanceView, EmployeeRef? Employee,
    IReadOnlyDictionary<Guid, ProjectMemberRole> Roles, bool FinanceAdmin = false, bool ManageColumns = false, IReadOnlySet<Guid>? DeptProjects = null)
{
    private bool SeesAll => IsHr || FinanceView;
    /// <summary>Thấy dự án đầy đủ (không phải chỉ nhờ phòng ban).</summary>
    private bool SeesFully(Guid projectId) => SeesAll || Roles.ContainsKey(projectId);
    /// <summary>Thêm / sửa / sắp xếp / xoá cột trạng thái: theo chức vụ, ở dự án người đó thấy đầy đủ (người xem nhờ phòng ban chỉ đọc).</summary>
    public bool CanManageColumns(Guid projectId) => ManageColumns && SeesFully(projectId);
    public bool CanSee(Guid projectId) => SeesFully(projectId) || (DeptProjects?.Contains(projectId) ?? false);
    /// <summary>Chỉ thấy nhờ phòng ban tham gia (không thành viên, không HR / Xem tài chính) → chỉ đọc.</summary>
    public bool ViaDepartment(Guid projectId) => !SeesFully(projectId) && (DeptProjects?.Contains(projectId) ?? false);
    public bool IsMember(Guid projectId) => Roles.ContainsKey(projectId);
    public bool CanManage(Guid projectId) => IsHr || (Roles.TryGetValue(projectId, out var r) && r == ProjectMemberRole.Manager);
    /// <summary>Tạo / sửa việc, bình luận: thành viên hoặc người quản lý.</summary>
    public bool CanWork(Guid projectId) => IsMember(projectId) || CanManage(projectId);
    /// <summary>Tab Ngày công: quản lý dự án / HR / quyền Xem tài chính.</summary>
    public bool CanSeeEffort(Guid projectId) => CanManage(projectId) || (FinanceView && CanSee(projectId));
    /// <summary>Lãi / lỗ: quyền Xem tài chính.</summary>
    public bool CanSeeFinance(Guid projectId) => FinanceView && CanSee(projectId);
    /// <summary>Kho tài liệu dự án — khớp DocumentAccess.CanRead (module Documents): HR / admin hoặc thành viên.</summary>
    public bool CanSeeDocuments(Guid projectId) => IsHr || IsMember(projectId);
}

/// <summary>
/// Bảng quyền hạn trong dự án — sinh từ CHÍNH các hàm của <see cref="ProjectViewer"/> (tab Phụ lục, <c>myAccess</c> cho MCP get_project).
/// Đổi quy tắc ở ProjectViewer → phụ lục tự đổi theo; test ProjectPermissionsTests khoá kỳ vọng từng vai trò.
/// </summary>
internal static class ProjectPermissions
{
    public sealed record Capability(string Key, string Label, Func<ProjectViewer, Guid, bool> Allowed);
    public sealed record Persona(string Key, string Label, string Who, ProjectViewer Viewer);

    public static readonly IReadOnlyList<Capability> All =
    [
        new("view", "Xem dự án, công việc, hướng dẫn, mốc, yêu cầu thay đổi, thành viên", (v, id) => v.CanSee(id)),
        new("work", "Tạo / sửa / chuyển việc, bình luận", (v, id) => v.CanWork(id)),
        new("manage", "Sửa dự án + hướng dẫn, thành viên, mốc, yêu cầu thay đổi; duyệt trạng thái cần duyệt; xoá việc", (v, id) => v.CanManage(id)),
        new("columns", "Thêm / sửa / xoá trạng thái công việc (cột)", (v, id) => v.CanManageColumns(id)),
        new("effort", "Xem ngày công", (v, id) => v.CanSeeEffort(id)),
        new("finance", "Xem lãi / lỗ dự án", (v, id) => v.CanSeeFinance(id)),
        new("documents", "Kho tài liệu dự án", (v, id) => v.CanSeeDocuments(id)),
    ];

    public static List<string> Allowed(ProjectViewer v, Guid projectId) => All.Where(c => c.Allowed(v, projectId)).Select(c => c.Key).ToList();

    private static ProjectViewer Synthetic(Guid projectId, bool hr = false, bool finance = false, ProjectMemberRole? role = null, bool columns = false, bool dept = false) =>
        new(Guid.Empty, "", hr, false, finance, null,
            role is { } r ? new Dictionary<Guid, ProjectMemberRole> { [projectId] = r } : new Dictionary<Guid, ProjectMemberRole>(),
            ManageColumns: columns, DeptProjects: dept ? new HashSet<Guid> { projectId } : null);

    /// <summary>Các vai trò mô tả ở tab Phụ lục.</summary>
    public static IReadOnlyList<Persona> Personas(Guid projectId) =>
    [
        new("manager", "Quản lý dự án", "Thành viên vai trò Quản lý", Synthetic(projectId, role: ProjectMemberRole.Manager)),
        new("member", "Thành viên", "Thành viên vai trò Thành viên (người hoặc bot)", Synthetic(projectId, role: ProjectMemberRole.Member)),
        new("department", "Nhân viên phòng ban tham gia", "Nhân viên thuộc đúng phòng ban tham gia, không phải thành viên (không tính phòng con)", Synthetic(projectId, dept: true)),
        new("hr", "HR / quản trị", "Tài khoản vai trò HR hoặc admin", Synthetic(projectId, hr: true)),
        new("finance", "Quyền Xem tài chính", "Chức vụ có quyền Xem tài chính (Ban giám đốc, kế toán…)", Synthetic(projectId, finance: true)),
        new("columns", "Thành viên có chức vụ \"Quản lý trạng thái công việc\"", "Thành viên có chức vụ bật cờ này", Synthetic(projectId, role: ProjectMemberRole.Member, columns: true)),
    ];
}

/// <summary>Phân quyền module Projects — MỌI kiểm tra đi qua đây.</summary>
internal sealed class ProjectAccess(ProjectsDbContext db, IEmployeeDirectory dir, IFinanceAccess finance)
{
    private ProjectViewer? _viewer;
    private IReadOnlyDictionary<Guid, EmployeeRef>? _employees;

    public async Task<ProjectViewer> ViewerAsync(ClaimsPrincipal user, CancellationToken ct)
    {
        if (_viewer is not null) return _viewer;
        var uid = user.GetUserId()!.Value;
        var emp = await dir.GetByUserIdAsync(uid, ct);
        if (emp is { IsActive: false }) emp = null;
        var roles = emp is null ? new Dictionary<Guid, ProjectMemberRole>()
            : await db.Members.AsNoTracking().Where(m => m.EmployeeId == emp.Id).ToDictionaryAsync(m => m.ProjectId, m => m.Role, ct);
        var isHr = user.IsHr();
        var fin = await finance.GetAsync(uid, ct);
        var manageColumns = emp is not null && (await dir.GetPositionAsync(emp.Id, ct))?.ManageTaskColumns == true;
        var deptProjects = emp?.DepartmentId is { } dep
            ? (await db.ProjectDepartments.AsNoTracking().Where(d => d.DepartmentId == dep).Select(d => d.ProjectId).ToListAsync(ct)).ToHashSet()
            : [];
        return _viewer = new ProjectViewer(uid, user.FindFirstValue(ClaimNames.FullName) ?? user.Identity?.Name ?? "?", isHr,
            isHr || user.IsInRole(Roles.Manager), fin.Has(FinancePermission.View), emp, roles, fin.Has(FinancePermission.Admin), manageColumns, deptProjects);
    }

    public async Task<IReadOnlyDictionary<Guid, EmployeeRef>> EmployeesAsync(CancellationToken ct) =>
        _employees ??= (await dir.ListEmployedAsync(new DateOnly(2000, 1, 1), new DateOnly(2200, 1, 1), ct)).DistinctBy(e => e.Id).ToDictionary(e => e.Id);
}

/// <summary>Cài đặt <see cref="IProjectDirectory"/> cho module Documents (kho tài liệu dự án).</summary>
internal sealed class ProjectDirectory(ProjectsDbContext db, ProjectClock clock) : IProjectDirectory
{
    private static ProjectRef Ref(Project p) => new(p.Id, p.Code, p.Name, p.Status == ProjectStatus.Active,
        p.Departments.Select(d => d.DepartmentId).ToList(), p.Departments.FirstOrDefault(d => d.IsLead)?.DepartmentId);

    public async Task<IReadOnlyDictionary<Guid, ProjectMemberRole>> RolesOfAsync(Guid employeeId, CancellationToken ct = default) =>
        await db.Members.AsNoTracking().Where(m => m.EmployeeId == employeeId).ToDictionaryAsync(m => m.ProjectId, m => m.Role, ct);

    public async Task<IReadOnlyList<ProjectRef>> ListAsync(CancellationToken ct = default) =>
        (await db.Projects.AsNoTracking().Include(p => p.Departments).OrderBy(p => p.Status).ThenBy(p => p.Name).ToListAsync(ct)).Select(Ref).ToList();

    public async Task<ProjectRef?> GetAsync(Guid projectId, CancellationToken ct = default) =>
        await db.Projects.AsNoTracking().Include(p => p.Departments).FirstOrDefaultAsync(p => p.Id == projectId, ct) is { } p ? Ref(p) : null;

    public async Task<IReadOnlyList<ChangeRequestRef>> ChangeRequestsForContractAsync(Guid salesContractId, CancellationToken ct = default)
    {
        var projectId = await db.ProjectContracts.AsNoTracking().Where(x => x.ContractId == salesContractId).Select(x => (Guid?)x.ProjectId).FirstOrDefaultAsync(ct);
        if (projectId is not { } pid) return [];
        var code = await db.Projects.AsNoTracking().Where(p => p.Id == pid).Select(p => p.Code).FirstAsync(ct);
        return (await db.ChangeRequests.AsNoTracking().Where(c => c.ProjectId == pid).OrderBy(c => c.Number).ToListAsync(ct))
            .Select(c => new ChangeRequestRef(c.Id, pid, ChangeRequestRules.Code(code, c.Number), c.Title, c.Status.ToString(), c.Billable, c.EstimateManDays)).ToList();
    }

    public async Task<int> TransferMembershipsAsync(Guid fromEmployeeId, Guid toEmployeeId, CancellationToken ct = default)
    {
        var mine = await db.Members.AsNoTracking().Where(m => m.EmployeeId == fromEmployeeId).ToListAsync(ct);
        var already = (await db.Members.AsNoTracking().Where(m => m.EmployeeId == toEmployeeId).Select(m => m.ProjectId).ToListAsync(ct)).ToHashSet();
        foreach (var m in mine.Where(m => !already.Contains(m.ProjectId)))
            db.Members.Add(new ProjectMember { ProjectId = m.ProjectId, EmployeeId = toEmployeeId, Role = m.Role, AddedAt = clock.Now });
        await db.SaveChangesAsync(ct);
        return mine.Count;
    }
}

/// <summary>Mỗi giờ (sau 50 s): nhắc người được giao khi việc đến hạn hôm nay / đã quá hạn mà chưa xong — một lần mỗi việc (đổi hạn → nhắc lại).</summary>
internal sealed class TaskReminderJob(IServiceScopeFactory scopes, ILogger<TaskReminderJob> log, JobMonitor monitor) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        var job = monitor.Register("projects.task-reminder", "Dự án: nhắc việc", TimeSpan.FromHours(1));
        await Task.Delay(TimeSpan.FromSeconds(50), stop);
        using var timer = new PeriodicTimer(TimeSpan.FromHours(1));
        do
        {
            try { await job.RunAsync(() => RunOnceAsync(stop)); }
            catch (Exception ex) when (!stop.IsCancellationRequested) { log.LogError(ex, "Lỗi khi nhắc việc dự án"); }
        } while (await timer.WaitForNextTickAsync(stop));
    }

    internal async Task RunOnceAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ProjectsDbContext>();
        var clock = scope.ServiceProvider.GetRequiredService<ProjectClock>();
        var dir = scope.ServiceProvider.GetRequiredService<IEmployeeDirectory>();
        var notifier = scope.ServiceProvider.GetRequiredService<INotifier>();
        var today = clock.Today;
        var due = await db.Tasks.Where(t => t.CompletedAt == null && t.DueOn != null && t.DueOn <= today && t.AssigneeEmployeeId != null && t.DueRemindedAt == null)
            .OrderBy(t => t.DueOn).ThenBy(t => t.Id).Take(500).ToListAsync(ct);
        if (due.Count == 0) return;
        var projects = await db.Projects.AsNoTracking().Where(p => due.Select(t => t.ProjectId).Contains(p.Id)).ToDictionaryAsync(p => p.Id, ct);
        foreach (var t in due)
        {
            var p = projects[t.ProjectId];
            if ((await dir.GetAsync(t.AssigneeEmployeeId!.Value, ct))?.UserId is { } uid)
                await notifier.NotifyAsync(new NotificationRequest([uid], NotificationCategories.ProjectTask,
                    t.DueOn == today ? $"Việc đến hạn hôm nay: {EffortRules.TaskCode(p.Code, t.Number)} {t.Title}" : $"Việc quá hạn: {EffortRules.TaskCode(p.Code, t.Number)} {t.Title}",
                    $"Dự án {p.Name}. Hạn {t.DueOn:dd/MM/yyyy}.", TaskNotifyRules.Link(p.Id, t.Id), SendEmail: false), ct);
            t.DueRemindedAt = clock.Now;
        }
        await db.SaveChangesAsync(ct);
    }
}
