using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Attendance.Contracts;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Organization.Contracts;
using OfficeHub.Modules.Projects.Contracts;
using OfficeHub.Modules.Projects.Domain;
using OfficeHub.Modules.Projects.Infrastructure;
using OfficeHub.Modules.Sales.Contracts;

namespace OfficeHub.Modules.Projects.Features;

public sealed record MemberDto(Guid EmployeeId, string? Code, string FullName, string? JobTitle, ProjectMemberRole Role, bool IsActive);
public sealed record TaskCounts(int Open, int Done, int Overdue);
public sealed record ProjectDto(Guid Id, string Code, string Name, string? Description, ProjectKind Kind, ProjectStatus Status, Guid? DepartmentId, string? DepartmentName,
    Guid? BusinessLineId, SalesContractRef? Contract, DateOnly? StartOn, DateOnly? EndOn, decimal? BudgetManDays, ProjectMemberRole? MyRole, bool CanManage, bool CanWork,
    int MemberCount, TaskCounts Tasks, int MilestonesOpen, int MilestonesAccepted, DateTimeOffset CreatedAt);
public sealed record ProjectDetail(ProjectDto Project, List<MemberDto> Members, List<MilestoneDto> Milestones);
public sealed record UpsertProject(string Code, string Name, ProjectKind Kind = ProjectKind.Internal, string? Description = null, Guid? DepartmentId = null,
    Guid? BusinessLineId = null, Guid? SalesContractId = null, DateOnly? StartOn = null, DateOnly? EndOn = null, decimal? BudgetManDays = null,
    ProjectStatus Status = ProjectStatus.Active, List<Guid>? MemberIds = null);
public sealed record AddMembers(List<Guid> EmployeeIds, ProjectMemberRole Role = ProjectMemberRole.Member);
public sealed record ChangeRole(ProjectMemberRole Role);
public sealed record AllocationItem(Guid EmployeeId, int? Percent);
public sealed record SetAllocations(DateOnly Month, List<AllocationItem> Items);
public sealed record EffortCell(Guid EmployeeId, DateOnly Month, decimal PresentDays, decimal Percent, bool Explicit, decimal ManDays);
public sealed record EffortDto(List<DateOnly> Months, List<MemberDto> Members, List<EffortCell> Cells, decimal TotalManDays, decimal? BudgetManDays);

/// <summary>Dự án, thành viên, phân bổ %, ngày công (theo chấm công), chọn hợp đồng bán để gắn. Không có số tiền.</summary>
internal static class ProjectEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/", ListAsync);
        g.MapGet("/{id:guid}", GetAsync);
        g.MapPost("/", CreateAsync);
        g.MapPut("/{id:guid}", UpdateAsync);
        g.MapPost("/{id:guid}/members", AddMembersAsync);
        g.MapPut("/{id:guid}/members/{employeeId:guid}", ChangeRoleAsync);
        g.MapDelete("/{id:guid}/members/{employeeId:guid}", RemoveMemberAsync);
        g.MapPut("/{id:guid}/allocations", SetAllocationsAsync);
        g.MapGet("/{id:guid}/effort", EffortAsync);
        g.MapGet("/sales-contracts", SalesContractsAsync);
        g.MapGet("/sales-contracts/{contractId:guid}/installments", InstallmentsAsync);
    }

    internal static ProblemHttpResult Forbidden(string msg) => TypedResults.Problem(msg, statusCode: StatusCodes.Status403Forbidden);

    private static async Task<Ok<List<ProjectDto>>> ListAsync(ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access, IEmployeeDirectory dir,
        ISalesContractsLookup sales, ProjectClock clock, bool? mine, ProjectStatus? status, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var q = db.Projects.AsNoTracking().Include(p => p.Members).AsQueryable();
        if (mine == true || !(v.IsHr || v.FinanceView)) { var ids = v.Roles.Keys.ToList(); q = q.Where(p => ids.Contains(p.Id)); }
        if (status is { } s) q = q.Where(p => p.Status == s);
        var rows = await q.OrderBy(p => p.Status).ThenBy(p => p.Name).ToListAsync(ct);
        return TypedResults.Ok(await ToDtosAsync(rows, v, db, dir, sales, clock.Today, ct));
    }

    internal static async Task<List<ProjectDto>> ToDtosAsync(IReadOnlyList<Project> rows, ProjectViewer v, ProjectsDbContext db, IEmployeeDirectory dir,
        ISalesContractsLookup sales, DateOnly today, CancellationToken ct)
    {
        var ids = rows.Select(p => p.Id).ToList();
        var tasks = await db.Tasks.AsNoTracking().Where(t => ids.Contains(t.ProjectId)).Select(t => new { t.ProjectId, t.State, t.DueOn }).ToListAsync(ct);
        var ms = await db.Milestones.AsNoTracking().Where(m => ids.Contains(m.ProjectId)).Select(m => new { m.ProjectId, m.Status }).ToListAsync(ct);
        var depts = (await dir.ListDepartmentsAsync(ct)).ToDictionary(d => d.Id, d => d.Name);
        var contracts = (await sales.GetManyAsync(rows.Where(p => p.SalesContractId != null).Select(p => p.SalesContractId!.Value).Distinct().ToList(), ct)).ToDictionary(c => c.Id);
        return rows.Select(p =>
        {
            var t = tasks.Where(x => x.ProjectId == p.Id).ToList();
            return new ProjectDto(p.Id, p.Code, p.Name, p.Description, p.Kind, p.Status, p.DepartmentId, p.DepartmentId is { } d ? depts.GetValueOrDefault(d) : null, p.BusinessLineId,
                p.SalesContractId is { } c ? contracts.GetValueOrDefault(c) : null, p.StartOn, p.EndOn, p.BudgetManDays,
                v.Roles.TryGetValue(p.Id, out var r) ? r : null, v.CanManage(p.Id), v.CanWork(p.Id) && p.Status == ProjectStatus.Active, p.Members.Count,
                new TaskCounts(t.Count(x => x.State != TaskState.Done), t.Count(x => x.State == TaskState.Done), t.Count(x => EffortRules.IsOverdue(x.DueOn, x.State, today))),
                ms.Count(x => x.ProjectId == p.Id && x.Status == MilestoneStatus.Open), ms.Count(x => x.ProjectId == p.Id && x.Status == MilestoneStatus.Accepted), p.CreatedAt);
        }).ToList();
    }

    internal static async Task<List<MemberDto>> MembersAsync(Project p, ProjectAccess access, CancellationToken ct)
    {
        var emps = await access.EmployeesAsync(ct);
        return p.Members.OrderByDescending(m => m.Role).ThenBy(m => emps.TryGetValue(m.EmployeeId, out var e) ? e.FullName : "").Select(m =>
            emps.TryGetValue(m.EmployeeId, out var e) ? new MemberDto(m.EmployeeId, e.Code, e.FullName, null, m.Role, e.IsActive)
                : new MemberDto(m.EmployeeId, null, "(không rõ)", null, m.Role, false)).ToList();
    }

    private static async Task<Results<Ok<ProjectDetail>, NotFound>> GetAsync(Guid id, ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access, IEmployeeDirectory dir,
        ISalesContractsLookup sales, ProjectClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var p = await db.Projects.AsNoTracking().Include(x => x.Members).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p is null || !v.CanSee(id)) return TypedResults.NotFound();
        var dto = (await ToDtosAsync([p], v, db, dir, sales, clock.Today, ct))[0];
        return TypedResults.Ok(new ProjectDetail(dto, await MembersAsync(p, access, ct), await MilestoneEndpoints.ListForAsync(p, db, sales, ct)));
    }

    private static async Task<Validation> ValidateAsync(UpsertProject r, Guid? selfId, ProjectsDbContext db, ISalesContractsLookup sales, CancellationToken ct)
    {
        var code = r.Code?.Trim().ToUpperInvariant();
        var v = new Validation().Required(code, "code", "Mã dự án").MaxLength(code, 30, "code", "Mã dự án")
            .When(code is { Length: > 0 } c && !c.All(ch => char.IsAsciiLetterOrDigit(ch) || ch is '-' or '_'), "code", "Mã chỉ gồm chữ không dấu, số, - và _")
            .Required(r.Name, "name", "Tên dự án").MaxLength(r.Name, 200, "name", "Tên dự án").MaxLength(r.Description, 2000, "description", "Mô tả")
            .When(r.EndOn is { } e && r.StartOn is { } s && e < s, "endOn", "Ngày kết thúc trước ngày bắt đầu")
            .When(r.BudgetManDays is < 0 or > 100_000, "budgetManDays", "Ngân sách ngày công không hợp lệ")
            .When(r.Kind == ProjectKind.Client && r.SalesContractId is null, "salesContractId", "Dự án làm cho khách cần gắn hợp đồng bán");
        if (!v.Has("code") && await db.Projects.AnyAsync(p => p.Code == code && p.Id != selfId, ct)) v.Add("code", "Mã dự án đã tồn tại");
        if (r.SalesContractId is { } cid && await sales.GetAsync(cid, ct) is null) v.Add("salesContractId", "Hợp đồng bán không tồn tại");
        return v;
    }

    private static async Task<Results<Created<Guid>, ValidationProblem, ProblemHttpResult>> CreateAsync(UpsertProject r, ClaimsPrincipal user, ProjectsDbContext db,
        ProjectAccess access, IEmployeeDirectory dir, ISalesContractsLookup sales, INotifier notifier, ProjectClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        if (!v.CanCreate) return Forbidden("Chỉ quản lý / HR được tạo dự án");
        var val = await ValidateAsync(r, null, db, sales, ct);
        var memberIds = (r.MemberIds ?? []).Distinct().Where(x => x != v.Employee?.Id).ToList();
        foreach (var eid in memberIds)
            if (await dir.GetAsync(eid, ct) is not { IsActive: true }) { val.Add("memberIds", "Có thành viên không tồn tại hoặc đã nghỉ việc"); break; }
        if (val.Failed) return val.Problem();
        var now = clock.Now;
        var p = new Project
        {
            Code = r.Code.Trim().ToUpperInvariant(), Name = r.Name.Trim(), Description = Clean(r.Description), Kind = r.Kind, Status = ProjectStatus.Active,
            DepartmentId = r.DepartmentId, BusinessLineId = r.BusinessLineId, SalesContractId = r.SalesContractId, StartOn = r.StartOn ?? clock.Today, EndOn = r.EndOn,
            BudgetManDays = r.BudgetManDays, CreatedAt = now, CreatedByName = v.Name,
        };
        if (v.Employee is { } me) p.Members.Add(new ProjectMember { EmployeeId = me.Id, Role = ProjectMemberRole.Manager, AddedAt = now });
        foreach (var eid in memberIds) p.Members.Add(new ProjectMember { EmployeeId = eid, Role = ProjectMemberRole.Member, AddedAt = now });
        if (p.Members.Count == 0) return new Validation().Add("memberIds", "Tài khoản không có hồ sơ: chọn ít nhất một thành viên (sẽ là quản lý dự án)").Problem();
        if (v.Employee is null) p.Members[0].Role = ProjectMemberRole.Manager;
        db.Projects.Add(p);
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException) { return new Validation().Add("code", "Mã dự án đã tồn tại").Problem(); }
        await NotifyAddedAsync(notifier, dir, p, memberIds, v, ct);
        return TypedResults.Created($"/api/projects/{p.Id}", p.Id);
    }

    private static async Task<Results<NoContent, NotFound, ValidationProblem, ProblemHttpResult>> UpdateAsync(Guid id, UpsertProject r, ClaimsPrincipal user, ProjectsDbContext db,
        ProjectAccess access, ISalesContractsLookup sales, ProjectClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var p = await db.Projects.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p is null || !v.CanSee(id)) return TypedResults.NotFound();
        if (!v.CanManage(id)) return Forbidden("Chỉ quản lý dự án hoặc HR được sửa dự án");
        var val = await ValidateAsync(r, id, db, sales, ct);
        if (r.Code.Trim().ToUpperInvariant() != p.Code) val.Add("code", "Không đổi mã dự án (mã đã dùng trong số hiệu tài liệu)");
        if (val.Failed) return val.Problem();
        p.Name = r.Name.Trim(); p.Description = Clean(r.Description); p.Kind = r.Kind; p.DepartmentId = r.DepartmentId; p.BusinessLineId = r.BusinessLineId;
        p.SalesContractId = r.SalesContractId; p.StartOn = r.StartOn ?? p.StartOn; p.EndOn = r.EndOn; p.BudgetManDays = r.BudgetManDays; p.UpdatedAt = clock.Now;
        if (r.Status != p.Status) p.ClosedOn = r.Status == ProjectStatus.Closed ? clock.Today : null;
        p.Status = r.Status;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private static async Task NotifyAddedAsync(INotifier notifier, IEmployeeDirectory dir, Project p, IEnumerable<Guid> employeeIds, ProjectViewer v, CancellationToken ct)
    {
        var to = new List<Guid>();
        foreach (var id in employeeIds) if ((await dir.GetAsync(id, ct))?.UserId is { } u && u != v.UserId) to.Add(u);
        if (to.Count == 0) return;
        await notifier.NotifyAsync(new NotificationRequest(to, NotificationCategories.ProjectMemberAdded, $"Bạn được thêm vào dự án {p.Code} · {p.Name}",
            $"{v.Name} đã thêm bạn vào dự án. Công việc và kho tài liệu dự án đã mở cho bạn.", $"/projects/{p.Id}", SendEmail: false), ct);
    }

    private static async Task<Results<NoContent, NotFound, ValidationProblem, ProblemHttpResult>> AddMembersAsync(Guid id, AddMembers r, ClaimsPrincipal user, ProjectsDbContext db,
        ProjectAccess access, IEmployeeDirectory dir, INotifier notifier, ProjectClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var p = await db.Projects.Include(x => x.Members).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p is null || !v.CanSee(id)) return TypedResults.NotFound();
        if (!v.CanManage(id)) return Forbidden("Chỉ quản lý dự án hoặc HR được đổi thành viên");
        var added = new List<Guid>();
        foreach (var eid in (r.EmployeeIds ?? []).Distinct())
        {
            if (await dir.GetAsync(eid, ct) is not { IsActive: true }) return new Validation().Add("employeeIds", "Có người không tồn tại hoặc đã nghỉ việc").Problem();
            if (p.Members.Any(m => m.EmployeeId == eid)) continue;
            p.Members.Add(new ProjectMember { EmployeeId = eid, Role = r.Role, AddedAt = clock.Now });
            added.Add(eid);
        }
        await db.SaveChangesAsync(ct);
        await NotifyAddedAsync(notifier, dir, p, added, v, ct);
        return TypedResults.NoContent();
    }

    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> ChangeRoleAsync(Guid id, Guid employeeId, ChangeRole r, ClaimsPrincipal user,
        ProjectsDbContext db, ProjectAccess access, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var p = await db.Projects.Include(x => x.Members).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p is null || !v.CanSee(id)) return TypedResults.NotFound();
        if (!v.CanManage(id)) return Forbidden("Chỉ quản lý dự án hoặc HR được đổi vai trò");
        var m = p.Members.FirstOrDefault(x => x.EmployeeId == employeeId);
        if (m is null) return TypedResults.NotFound();
        if (m.Role == ProjectMemberRole.Manager && r.Role != ProjectMemberRole.Manager && p.Members.Count(x => x.Role == ProjectMemberRole.Manager) == 1)
            return Problems.Conflict("Dự án phải còn ít nhất một quản lý");
        m.Role = r.Role;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> RemoveMemberAsync(Guid id, Guid employeeId, ClaimsPrincipal user, ProjectsDbContext db,
        ProjectAccess access, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var p = await db.Projects.Include(x => x.Members).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p is null || !v.CanSee(id)) return TypedResults.NotFound();
        if (!v.CanManage(id)) return Forbidden("Chỉ quản lý dự án hoặc HR được đổi thành viên");
        var m = p.Members.FirstOrDefault(x => x.EmployeeId == employeeId);
        if (m is null) return TypedResults.NotFound();
        if (m.Role == ProjectMemberRole.Manager && p.Members.Count(x => x.Role == ProjectMemberRole.Manager) == 1)
            return Problems.Conflict("Dự án phải còn ít nhất một quản lý");
        p.Members.Remove(m);
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    /// <summary>Đặt % phân bổ của thành viên cho một tháng. <c>percent = null</c> = bỏ đặt tay (về mặc định). Tổng % đặt tay ở mọi dự án ≤ 100.</summary>
    private static async Task<Results<NoContent, NotFound, ValidationProblem, ProblemHttpResult>> SetAllocationsAsync(Guid id, SetAllocations r, ClaimsPrincipal user,
        ProjectsDbContext db, ProjectAccess access, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var p = await db.Projects.AsNoTracking().Include(x => x.Members).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p is null || !v.CanSee(id)) return TypedResults.NotFound();
        if (!v.CanManage(id)) return Forbidden("Chỉ quản lý dự án hoặc HR được phân bổ");
        var month = EffortRules.MonthStart(r.Month);
        var val = new Validation();
        var emps = await access.EmployeesAsync(ct);
        foreach (var it in r.Items ?? [])
        {
            if (!p.Members.Any(m => m.EmployeeId == it.EmployeeId)) { val.Add("items", "Có người không phải thành viên dự án"); continue; }
            if (it.Percent is not { } pct) continue;
            var others = await db.Allocations.Where(a => a.EmployeeId == it.EmployeeId && a.Month == month && a.ProjectId != id).SumAsync(a => a.Percent, ct);
            if (EffortRules.CheckTotal(pct, others) is { } err) val.Add("items", $"{(emps.TryGetValue(it.EmployeeId, out var e) ? e.FullName : "?")}: {err}");
        }
        if (val.Failed) return val.Problem();
        foreach (var it in r.Items ?? [])
        {
            var row = await db.Allocations.FirstOrDefaultAsync(a => a.ProjectId == id && a.EmployeeId == it.EmployeeId && a.Month == month, ct);
            if (it.Percent is null) { if (row is not null) db.Allocations.Remove(row); }
            else if (row is null) db.Allocations.Add(new Allocation { ProjectId = id, EmployeeId = it.EmployeeId, Month = month, Percent = it.Percent.Value });
            else row.Percent = it.Percent.Value;
        }
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    /// <summary>
    /// Ngày công theo tháng: ngày có mặt (bảng công module Attendance) × % phân bổ. Thấy: quản lý dự án, HR, quyền Xem tài chính.
    /// Từ ngày bắt đầu dự án đến tháng hiện tại (hoặc ngày kết thúc / đóng), tối đa 24 tháng gần nhất.
    /// </summary>
    private static async Task<Results<Ok<EffortDto>, NotFound, ProblemHttpResult>> EffortAsync(Guid id, ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access,
        IAttendanceReports attendance, ProjectClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var p = await db.Projects.AsNoTracking().Include(x => x.Members).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p is null || !v.CanSee(id)) return TypedResults.NotFound();
        if (!v.CanManage(id) && !v.FinanceView) return Forbidden("Chỉ quản lý dự án, HR hoặc Ban giám đốc xem ngày công");
        var start = p.StartOn ?? clock.DateOf(p.CreatedAt);
        var end = new[] { clock.Today, p.EndOn ?? DateOnly.MaxValue, p.ClosedOn ?? DateOnly.MaxValue }.Min();
        var months = end < start ? [] : EffortRules.Months(start, end);
        var memberIds = p.Members.Select(m => m.EmployeeId).ToList();
        var explicitRows = await db.Allocations.AsNoTracking().Where(a => memberIds.Contains(a.EmployeeId) && months.Contains(a.Month)).ToListAsync(ct);
        // Dự án đang chạy mà mỗi thành viên tham gia (để chia đều khi chưa đặt tay).
        var memberships = await db.Members.AsNoTracking().Where(m => memberIds.Contains(m.EmployeeId)).Select(m => new { m.EmployeeId, m.ProjectId }).ToListAsync(ct);
        var projIds = memberships.Select(m => m.ProjectId).Distinct().ToList();
        var spans = await db.Projects.AsNoTracking().Where(x => projIds.Contains(x.Id)).Select(x => new { x.Id, x.StartOn, x.EndOn, x.ClosedOn, x.CreatedAt }).ToListAsync(ct);
        var cells = new List<EffortCell>();
        foreach (var month in months)
        {
            var sheets = await attendance.MonthAsync(memberIds, month, ct);
            foreach (var eid in memberIds)
            {
                var present = sheets.TryGetValue(eid, out var s) ? s.Totals.PresentDays : 0;
                var activeCount = memberships.Where(m => m.EmployeeId == eid).Select(m => spans.First(x => x.Id == m.ProjectId))
                    .Count(x => EffortRules.ActiveIn(month, x.StartOn ?? clock.DateOf(x.CreatedAt), x.EndOn, x.ClosedOn));
                var ex = explicitRows.FirstOrDefault(a => a.ProjectId == id && a.EmployeeId == eid && a.Month == month);
                var pct = EffortRules.Percent(ex?.Percent, activeCount);
                cells.Add(new EffortCell(eid, month, present, pct, ex is not null, EffortRules.ManDays(present, pct)));
            }
        }
        return TypedResults.Ok(new EffortDto(months, await MembersAsync(p, access, ct), cells, cells.Sum(c => c.ManDays), p.BudgetManDays));
    }

    private static async Task<Results<Ok<IReadOnlyList<SalesContractRef>>, ProblemHttpResult>> SalesContractsAsync(ClaimsPrincipal user, ProjectAccess access,
        ISalesContractsLookup sales, string? search, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        if (!v.CanCreate && !v.Roles.Values.Contains(ProjectMemberRole.Manager)) return Forbidden("Chỉ quản lý dự án / HR được gắn hợp đồng");
        return TypedResults.Ok(await sales.SearchActiveAsync(search, ct));
    }

    private static async Task<Results<Ok<IReadOnlyList<InstallmentRef>>, ProblemHttpResult>> InstallmentsAsync(Guid contractId, ClaimsPrincipal user, ProjectAccess access,
        ProjectsDbContext db, ISalesContractsLookup sales, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var projectIds = await db.Projects.Where(p => p.SalesContractId == contractId).Select(p => p.Id).ToListAsync(ct);
        if (!projectIds.Any(v.CanSee)) return Forbidden("Hợp đồng này không gắn với dự án bạn tham gia");
        return TypedResults.Ok(await sales.InstallmentsAsync(contractId, ct));
    }

    internal static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
