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
}

/// <param name="IsHr">admin / hr: thấy + quản lý mọi dự án (như kho tài liệu dự án trước đây).</param>
/// <param name="FinanceView">quyền Xem tài chính (chức vụ): thấy mọi dự án (chỉ đọc) — để theo dõi tiến độ / ngày công.</param>
internal sealed record ProjectViewer(Guid UserId, string Name, bool IsHr, bool CanCreate, bool FinanceView, EmployeeRef? Employee,
    IReadOnlyDictionary<Guid, ProjectMemberRole> Roles)
{
    public bool CanSee(Guid projectId) => IsHr || FinanceView || Roles.ContainsKey(projectId);
    public bool IsMember(Guid projectId) => Roles.ContainsKey(projectId);
    public bool CanManage(Guid projectId) => IsHr || (Roles.TryGetValue(projectId, out var r) && r == ProjectMemberRole.Manager);
    /// <summary>Tạo / sửa việc, bình luận: thành viên hoặc người quản lý.</summary>
    public bool CanWork(Guid projectId) => IsMember(projectId) || CanManage(projectId);
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
        return _viewer = new ProjectViewer(uid, user.FindFirstValue(ClaimNames.FullName) ?? user.Identity?.Name ?? "?", isHr,
            isHr || user.IsInRole(Roles.Manager), (await finance.GetAsync(uid, ct)).Has(FinancePermission.View), emp, roles);
    }

    public async Task<IReadOnlyDictionary<Guid, EmployeeRef>> EmployeesAsync(CancellationToken ct) =>
        _employees ??= (await dir.ListEmployedAsync(new DateOnly(2000, 1, 1), new DateOnly(2200, 1, 1), ct)).DistinctBy(e => e.Id).ToDictionary(e => e.Id);
}

/// <summary>Cài đặt <see cref="IProjectDirectory"/> cho module Documents (kho tài liệu dự án).</summary>
internal sealed class ProjectDirectory(ProjectsDbContext db, ProjectClock clock) : IProjectDirectory
{
    private static ProjectRef Ref(Project p) => new(p.Id, p.Code, p.Name, p.Status == ProjectStatus.Active, p.DepartmentId);

    public async Task<IReadOnlyDictionary<Guid, ProjectMemberRole>> RolesOfAsync(Guid employeeId, CancellationToken ct = default) =>
        await db.Members.AsNoTracking().Where(m => m.EmployeeId == employeeId).ToDictionaryAsync(m => m.ProjectId, m => m.Role, ct);

    public async Task<IReadOnlyList<ProjectRef>> ListAsync(CancellationToken ct = default) =>
        (await db.Projects.AsNoTracking().OrderBy(p => p.Status).ThenBy(p => p.Name).ToListAsync(ct)).Select(Ref).ToList();

    public async Task<ProjectRef?> GetAsync(Guid projectId, CancellationToken ct = default) =>
        await db.Projects.AsNoTracking().Where(p => p.Id == projectId).Select(p => Ref(p)).FirstOrDefaultAsync(ct);

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
internal sealed class TaskReminderJob(IServiceScopeFactory scopes, ILogger<TaskReminderJob> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        await Task.Delay(TimeSpan.FromSeconds(50), stop);
        using var timer = new PeriodicTimer(TimeSpan.FromHours(1));
        do
        {
            try { await RunOnceAsync(stop); }
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
        var due = await db.Tasks.Where(t => t.State != TaskState.Done && t.DueOn != null && t.DueOn <= today && t.AssigneeEmployeeId != null && t.DueRemindedAt == null)
            .OrderBy(t => t.DueOn).ThenBy(t => t.Id).Take(500).ToListAsync(ct);
        if (due.Count == 0) return;
        var projects = await db.Projects.AsNoTracking().Where(p => due.Select(t => t.ProjectId).Contains(p.Id)).ToDictionaryAsync(p => p.Id, ct);
        foreach (var t in due)
        {
            var p = projects[t.ProjectId];
            if ((await dir.GetAsync(t.AssigneeEmployeeId!.Value, ct))?.UserId is { } uid)
                await notifier.NotifyAsync(new NotificationRequest([uid], NotificationCategories.ProjectTask,
                    t.DueOn == today ? $"Việc đến hạn hôm nay: {EffortRules.TaskCode(p.Code, t.Number)} {t.Title}" : $"Việc quá hạn: {EffortRules.TaskCode(p.Code, t.Number)} {t.Title}",
                    $"Dự án {p.Name}. Hạn {t.DueOn:dd/MM/yyyy}.", $"/projects/{p.Id}", SendEmail: false), ct);
            t.DueRemindedAt = clock.Now;
        }
        await db.SaveChangesAsync(ct);
    }
}
