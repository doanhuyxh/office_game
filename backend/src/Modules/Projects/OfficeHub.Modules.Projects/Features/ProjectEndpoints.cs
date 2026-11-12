using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
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
public sealed record ProjectDepartmentDto(Guid Id, string Name, bool IsLead);
/// <param name="Departments">Phòng ban tham gia (chủ trì đứng đầu) — TEST-40.</param>
/// <param name="ViaDepartment">Người xem chỉ thấy dự án nhờ phòng ban của mình tham gia → chỉ đọc.</param>
public sealed record ProjectDto(Guid Id, string Code, string Name, string? Description, ProjectKind Kind, ProjectStatus Status, List<ProjectDepartmentDto> Departments,
    Guid? BusinessLineId, List<SalesContractRef> Contracts, DateOnly? StartOn, DateOnly? EndOn, decimal? BudgetManDays, ProjectMemberRole? MyRole, bool CanManage, bool CanWork,
    int MemberCount, TaskCounts Tasks, int MilestonesOpen, int MilestonesAccepted, DateTimeOffset CreatedAt, ProjectProgress Progress, bool Sequential,
    bool CanManageColumns = false, bool ViaDepartment = false);
/// <param name="WorkGuide">Hướng dẫn làm việc (Markdown) — chỉ ở chi tiết, không ở danh sách (dài).</param>
/// <param name="Columns">Cột trạng thái công việc theo thứ tự.</param>
/// <param name="WorkGuide">Hướng dẫn làm việc mới (Markdown, thay toàn bộ); null / "" = xoá.</param>
public sealed record UpdateProjectGuide(string? WorkGuide);
public sealed record ProjectGuideDto(string? WorkGuide);
/// <param name="MyAccess">Quyền của người xem trong dự án (khoá của <see cref="ProjectPermissions"/>: view, work, manage, columns, effort, finance, documents).</param>
public sealed record ProjectDetail(ProjectDto Project, List<MemberDto> Members, List<MilestoneDto> Milestones, string? WorkGuide, List<TaskColumnDto> Columns,
    List<string>? MyAccess = null);
/// <param name="DepartmentIds">Phòng ban tham gia (≤ 20); null = giữ nguyên khi sửa.</param><param name="LeadDepartmentId">Phòng chủ trì — phải nằm trong DepartmentIds.</param>
public sealed record UpsertProject(string Code, string Name, ProjectKind Kind = ProjectKind.Internal, string? Description = null, List<Guid>? DepartmentIds = null,
    Guid? LeadDepartmentId = null, Guid? BusinessLineId = null, List<Guid>? SalesContractIds = null, DateOnly? StartOn = null, DateOnly? EndOn = null, decimal? BudgetManDays = null,
    ProjectStatus Status = ProjectStatus.Active, List<Guid>? MemberIds = null, bool? Sequential = null, string? WorkGuide = null);
public sealed record AddMembers(List<Guid> EmployeeIds, ProjectMemberRole Role = ProjectMemberRole.Member);
public sealed record ChangeRole(ProjectMemberRole Role);
public sealed record AllocationItem(Guid EmployeeId, decimal? Percent);
public sealed record SetAllocations(DateOnly Month, List<AllocationItem> Items);
public sealed record EffortCell(Guid EmployeeId, DateOnly Month, decimal PresentDays, decimal Percent, bool Explicit, decimal ManDays);
/// <param name="FrozenMonths">Tháng đã chốt phân bổ (chỉ HR / Quản trị tài chính sửa — <paramref name="CanEditFrozen"/>).</param>
public sealed record EffortDto(List<DateOnly> Months, List<MemberDto> Members, List<EffortCell> Cells, decimal TotalManDays, decimal? BudgetManDays,
    List<DateOnly> FrozenMonths, bool CanEditFrozen);

/// <summary>Dự án, thành viên, phân bổ %, ngày công (theo chấm công), chọn hợp đồng bán để gắn. Không có số tiền.</summary>
internal static class ProjectEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/", ListAsync);
        g.MapGet("/{id:guid}", GetAsync);
        g.MapPost("/", CreateAsync);
        g.MapPut("/{id:guid}", UpdateAsync);
        g.MapPut("/{id:guid}/guide", UpdateGuideAsync);
        g.MapPost("/{id:guid}/members", AddMembersAsync);
        g.MapPut("/{id:guid}/members/{employeeId:guid}", ChangeRoleAsync);
        g.MapDelete("/{id:guid}/members/{employeeId:guid}", RemoveMemberAsync);
        g.MapPut("/{id:guid}/allocations", SetAllocationsAsync);
        g.MapGet("/{id:guid}/effort", EffortAsync);
        g.MapGet("/sales-contracts", SalesContractsAsync);
        g.MapGet("/sales-contracts/{contractId:guid}/installments", InstallmentsAsync);
        g.MapGet("/{id:guid}/installments", ProjectInstallmentsAsync);
        g.MapGet("/{id:guid}/financials", FinancialsAsync);
        g.MapGet("/financials", AllFinancialsAsync);
    }

    internal static async Task<List<Guid>> ContractIdsAsync(ProjectsDbContext db, Guid projectId, CancellationToken ct) =>
        await db.ProjectContracts.AsNoTracking().Where(x => x.ProjectId == projectId).OrderBy(x => x.LinkedAt).Select(x => x.ContractId).ToListAsync(ct);

    /// <summary>Đợt thu của mọi hợp đồng gắn dự án (chọn khi gắn mốc). Không có số tiền.</summary>
    internal static async Task<List<InstallmentRef>> InstallmentsOfAsync(ProjectsDbContext db, ISalesContractsLookup sales, Guid projectId, CancellationToken ct)
    {
        var list = new List<InstallmentRef>();
        foreach (var cid in await ContractIdsAsync(db, projectId, ct)) list.AddRange(await sales.InstallmentsAsync(cid, ct));
        return list;
    }

    private static async Task<Results<Ok<List<InstallmentRef>>, NotFound>> ProjectInstallmentsAsync(Guid id, ClaimsPrincipal user, ProjectAccess access, ProjectsDbContext db,
        ISalesContractsLookup sales, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        if (!v.CanSee(id) || !await db.Projects.AnyAsync(p => p.Id == id, ct)) return TypedResults.NotFound();
        return TypedResults.Ok(await InstallmentsOfAsync(db, sales, id, ct));
    }

    /// <summary>Lãi / lỗ một dự án — chỉ quyền Xem tài chính (quản lý dự án KHÔNG xem tiền). Chi tiết theo người: chỉ Quản trị tài chính.</summary>
    private static async Task<Results<Ok<ProjectFinancialsDto>, NotFound, ProblemHttpResult>> FinancialsAsync(Guid id, ClaimsPrincipal user, ProjectsDbContext db,
        ProjectAccess access, ProjectFinance finance, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var p = await db.Projects.AsNoTracking().Include(x => x.Members).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p is null || !v.CanSee(id)) return TypedResults.NotFound();
        if (!v.FinanceView) return Forbidden("Chỉ người có quyền Xem tài chính xem lãi / lỗ dự án");
        return TypedResults.Ok((await finance.ComputeAsync([p], v.FinanceAdmin, ct))[0]);
    }

    /// <summary>Lãi / lỗ mọi dự án (không chi tiết theo tháng / người) — chỉ quyền Xem tài chính.</summary>
    private static async Task<Results<Ok<List<ProjectFinancialsDto>>, ProblemHttpResult>> AllFinancialsAsync(ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access,
        ProjectFinance finance, ProjectStatus? status, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        if (!v.FinanceView) return Forbidden("Chỉ người có quyền Xem tài chính xem lãi / lỗ dự án");
        var q = db.Projects.AsNoTracking().Include(x => x.Members).AsQueryable();
        if (status is { } s) q = q.Where(p => p.Status == s);
        var rows = await finance.ComputeAsync(await q.OrderBy(p => p.Status).ThenBy(p => p.Name).ToListAsync(ct), false, ct);
        return TypedResults.Ok(rows.Select(r => r with { Months = [], Categories = [] }).ToList());
    }

    private static async Task<IReadOnlySet<Guid>> DepartmentIdsAsync(IEmployeeDirectory dir, CancellationToken ct) =>
        (await dir.ListDepartmentsAsync(ct)).Select(d => d.Id).ToHashSet();

    internal static ProblemHttpResult Forbidden(string msg) => TypedResults.Problem(msg, statusCode: StatusCodes.Status403Forbidden);

    private static async Task<Ok<List<ProjectDto>>> ListAsync(ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access, IEmployeeDirectory dir,
        ISalesContractsLookup sales, ProjectClock clock, bool? mine, ProjectStatus? status, Guid? departmentId, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var q = db.Projects.AsNoTracking().Include(p => p.Members).Include(p => p.Departments).AsQueryable();
        if (mine == true) { var ids = v.Roles.Keys.ToList(); q = q.Where(p => ids.Contains(p.Id)); }
        else if (!(v.IsHr || v.FinanceView)) { var ids = v.Roles.Keys.Concat(v.DeptProjects ?? new HashSet<Guid>()).Distinct().ToList(); q = q.Where(p => ids.Contains(p.Id)); }
        if (status is { } s) q = q.Where(p => p.Status == s);
        if (departmentId is { } dep) q = q.Where(p => p.Departments.Any(d => d.DepartmentId == dep));
        var rows = await q.OrderBy(p => p.Status).ThenBy(p => p.Name).ToListAsync(ct);
        return TypedResults.Ok(await ToDtosAsync(rows, v, db, dir, sales, clock.Today, ct));
    }

    internal static async Task<List<ProjectDto>> ToDtosAsync(IReadOnlyList<Project> rows, ProjectViewer v, ProjectsDbContext db, IEmployeeDirectory dir,
        ISalesContractsLookup sales, DateOnly today, CancellationToken ct)
    {
        var ids = rows.Select(p => p.Id).ToList();
        var tasks = await db.Tasks.AsNoTracking().Where(t => ids.Contains(t.ProjectId)).Select(t => new { t.ProjectId, Done = t.CompletedAt != null, t.DueOn }).ToListAsync(ct);
        var ms = await db.Milestones.AsNoTracking().Where(m => ids.Contains(m.ProjectId)).Select(m => new { m.ProjectId, m.Status, m.Order, m.Title, m.DueOn }).ToListAsync(ct);
        var depts = (await dir.ListDepartmentsAsync(ct)).ToDictionary(d => d.Id, d => d.Name);
        var links = await db.ProjectContracts.AsNoTracking().Where(x => ids.Contains(x.ProjectId)).OrderBy(x => x.LinkedAt).ToListAsync(ct);
        var contracts = (await sales.GetManyAsync(links.Select(l => l.ContractId).Distinct().ToList(), ct)).ToDictionary(c => c.Id);
        return rows.Select(p =>
        {
            var t = tasks.Where(x => x.ProjectId == p.Id).ToList();
            var progress = ProgressRules.Compute(t.Select(x => new ProgressTask(x.Done, x.DueOn)).ToList(),
                ms.Where(x => x.ProjectId == p.Id).Select(x => new ProgressMilestone(x.Order, x.Title, x.DueOn, x.Status)).ToList(), p.StartOn, p.EndOn,
                p.Status == ProjectStatus.Active, today);
            return new ProjectDto(p.Id, p.Code, p.Name, p.Description, p.Kind, p.Status, DepartmentsOf(p, depts), p.BusinessLineId,
                links.Where(l => l.ProjectId == p.Id).Select(l => contracts.GetValueOrDefault(l.ContractId)).OfType<SalesContractRef>().ToList(), p.StartOn, p.EndOn, p.BudgetManDays,
                v.Roles.TryGetValue(p.Id, out var r) ? r : null, v.CanManage(p.Id), v.CanWork(p.Id) && p.Status == ProjectStatus.Active, p.Members.Count,
                new TaskCounts(t.Count(x => !x.Done), t.Count(x => x.Done), t.Count(x => EffortRules.IsOverdue(x.DueOn, x.Done, today))),
                ms.Count(x => x.ProjectId == p.Id && x.Status == MilestoneStatus.Open), ms.Count(x => x.ProjectId == p.Id && x.Status == MilestoneStatus.Accepted), p.CreatedAt, progress, p.Sequential,
                v.CanManageColumns(p.Id), v.ViaDepartment(p.Id));
        }).ToList();
    }

    internal static List<ProjectDepartmentDto> DepartmentsOf(Project p, IReadOnlyDictionary<Guid, string> depts) =>
        ProjectDepartmentRules.Ordered(p.Departments.Select(d => new ProjectDepartmentDto(d.DepartmentId, depts.GetValueOrDefault(d.DepartmentId, "(phòng ban đã xoá)"), d.IsLead)),
            d => d.IsLead, d => d.Name).ToList();

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
        var p = await db.Projects.AsNoTracking().Include(x => x.Members).Include(x => x.Departments).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p is null || !v.CanSee(id)) return TypedResults.NotFound();
        var dto = (await ToDtosAsync([p], v, db, dir, sales, clock.Today, ct))[0];
        return TypedResults.Ok(new ProjectDetail(dto, await MembersAsync(p, access, ct), await MilestoneEndpoints.ListForAsync(p, db, sales, ct), p.WorkGuide,
            await TaskColumnEndpoints.ListForAsync(db, id, ct), ProjectPermissions.Allowed(v, id)));
    }

    private static async Task<Validation> ValidateAsync(UpsertProject r, Guid? selfId, Guid userId, ProjectsDbContext db, ISalesContractsLookup sales,
        IReadOnlySet<Guid> existingDepartments, CancellationToken ct)
    {
        var code = r.Code?.Trim().ToUpperInvariant();
        var v = new Validation().Required(code, "code", "Mã dự án").MaxLength(code, 30, "code", "Mã dự án")
            .When(code is { Length: > 0 } c && !c.All(ch => char.IsAsciiLetterOrDigit(ch) || ch is '-' or '_'), "code", "Mã chỉ gồm chữ không dấu, số, - và _")
            .Required(r.Name, "name", "Tên dự án").MaxLength(r.Name, 200, "name", "Tên dự án").MaxLength(r.Description, 2000, "description", "Mô tả")
            .MaxLength(r.WorkGuide, TaskRules.MaxDescription, "workGuide", "Hướng dẫn làm việc")
            .When(r.EndOn is { } e && r.StartOn is { } s && e < s, "endOn", "Ngày kết thúc trước ngày bắt đầu")
            .When(r.BudgetManDays is < 0 or > 100_000, "budgetManDays", "Ngân sách ngày công không hợp lệ")
            .When(r.Kind == ProjectKind.Client && ContractIdsOf(r).Count == 0, "salesContractIds", "Dự án làm cho khách cần gắn ít nhất một hợp đồng bán");
        if (!v.Has("code") && await db.Projects.AnyAsync(p => p.Code == code && p.Id != selfId, ct)) v.Add("code", "Mã dự án đã tồn tại");
        if (r.DepartmentIds is not null || r.LeadDepartmentId is not null)
            foreach (var (field, msg) in ProjectDepartmentRules.Errors(ProjectDepartmentRules.Normalize(r.DepartmentIds), r.LeadDepartmentId, existingDepartments)) v.Add(field, msg);
        var ids = ContractIdsOf(r);
        if (ids.Count > 0)
        {
            var found = (await sales.GetManyAsync(ids, ct)).ToDictionary(c => c.Id);
            if (ids.Any(x => !found.ContainsKey(x))) v.Add("salesContractIds", "Có hợp đồng bán không tồn tại");
            // Một hợp đồng chỉ thuộc một dự án (chủ dự án chốt 2026-11-08).
            var taken = await db.ProjectContracts.AsNoTracking().Where(x => ids.Contains(x.ContractId) && x.ProjectId != selfId).Select(x => x.ContractId).ToListAsync(ct);
            if (taken.Count > 0)
            {
                var codes = string.Join(", ", taken.Select(t => found.TryGetValue(t, out var c) ? c.Code : "?"));
                v.Add("salesContractIds", $"Hợp đồng {codes} đã gắn với dự án khác");
            }
            // TEST-14: gắn THÊM hợp đồng phải có quyền xem hợp đồng đó bên Sales (hợp đồng đã gắn sẵn thì giữ được dù người sửa không có quyền).
            var linked = selfId is { } pid
                ? await db.ProjectContracts.AsNoTracking().Where(x => x.ProjectId == pid).Select(x => x.ContractId).ToListAsync(ct)
                : [];
            var added = ids.Except(linked).Where(found.ContainsKey).ToList();
            var visible = await sales.VisibleToAsync(userId, added, ct);
            if (added.Any(x => !visible.Contains(x)))
                v.Add("salesContractIds", $"Không có quyền với hợp đồng {string.Join(", ", added.Where(x => !visible.Contains(x)).Select(x => found[x].Code))} — nhờ người phụ trách hợp đồng / kế toán gắn");
        }
        return v;
    }

    /// <summary>Hợp đồng gửi lên (dự án nội bộ → không có hợp đồng).</summary>
    private static List<Guid> ContractIdsOf(UpsertProject r) => r.Kind == ProjectKind.Client ? (r.SalesContractIds ?? []).Distinct().ToList() : [];

    private static async Task<Results<Created<Guid>, ValidationProblem, ProblemHttpResult>> CreateAsync(UpsertProject r, ClaimsPrincipal user, ProjectsDbContext db,
        ProjectAccess access, IEmployeeDirectory dir, ISalesContractsLookup sales, INotifier notifier, ProjectClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        if (!v.CanCreate) return Forbidden("Chỉ quản lý / HR được tạo dự án");
        var val = await ValidateAsync(r, null, v.UserId, db, sales, await DepartmentIdsAsync(dir, ct), ct);
        var memberIds = (r.MemberIds ?? []).Distinct().Where(x => x != v.Employee?.Id).ToList();
        foreach (var eid in memberIds)
            if (await dir.GetAsync(eid, ct) is not { IsActive: true }) { val.Add("memberIds", "Có thành viên không tồn tại hoặc đã nghỉ việc"); break; }
        if (val.Failed) return val.Problem();
        var now = clock.Now;
        var p = new Project
        {
            Code = r.Code.Trim().ToUpperInvariant(), Name = r.Name.Trim(), Description = Clean(r.Description), Kind = r.Kind, Status = ProjectStatus.Active,
            BusinessLineId = r.BusinessLineId, StartOn = r.StartOn ?? clock.Today, EndOn = r.EndOn,
            BudgetManDays = r.BudgetManDays, CreatedAt = now, CreatedByName = v.Name,
            Sequential = r.Sequential ?? true, WorkGuide = Clean(r.WorkGuide), // dự án mới mặc định đi lần lượt (chủ dự án chốt 2026-11-10)
        };
        foreach (var dep in ProjectDepartmentRules.Normalize(r.DepartmentIds))
            p.Departments.Add(new ProjectDepartment { DepartmentId = dep, IsLead = dep == r.LeadDepartmentId, CreatedAt = now });
        if (v.Employee is { } me) p.Members.Add(new ProjectMember { EmployeeId = me.Id, Role = ProjectMemberRole.Manager, AddedAt = now });
        foreach (var eid in memberIds) p.Members.Add(new ProjectMember { EmployeeId = eid, Role = ProjectMemberRole.Member, AddedAt = now });
        if (p.Members.Count == 0) return new Validation().Add("memberIds", "Tài khoản không có hồ sơ: chọn ít nhất một thành viên (sẽ là quản lý dự án)").Problem();
        if (v.Employee is null) p.Members[0].Role = ProjectMemberRole.Manager;
        db.Projects.Add(p);
        db.Columns.AddRange(TaskColumnRules.Defaults(p.Id)); // Cần làm · Đang làm · Chờ review · Xong (chủ dự án chốt 2026-11-11)
        foreach (var cid in ContractIdsOf(r)) db.ProjectContracts.Add(new ProjectContract { ProjectId = p.Id, ContractId = cid, LinkedAt = now });
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException) { return new Validation().Add("code", "Mã dự án đã tồn tại hoặc hợp đồng vừa được gắn với dự án khác").Problem(); }
        await NotifyAddedAsync(notifier, dir, p, memberIds, v, ct);
        return TypedResults.Created($"/api/projects/{p.Id}", p.Id);
    }

    private static async Task<Results<NoContent, NotFound, ValidationProblem, ProblemHttpResult>> UpdateAsync(Guid id, UpsertProject r, ClaimsPrincipal user, ProjectsDbContext db,
        ProjectAccess access, ISalesContractsLookup sales, IEmployeeDirectory dir, INotifier notifier, ProjectClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var p = await db.Projects.Include(x => x.Departments).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p is null || !v.CanSee(id)) return TypedResults.NotFound();
        if (!v.CanManage(id)) return Forbidden("Chỉ quản lý dự án hoặc HR được sửa dự án");
        var existingDepts = await DepartmentIdsAsync(dir, ct);
        var val = await ValidateAsync(r, id, v.UserId, db, sales, existingDepts, ct);
        if (r.Code.Trim().ToUpperInvariant() != p.Code) val.Add("code", "Không đổi mã dự án (mã đã dùng trong số hiệu tài liệu)");
        // Bỏ hợp đồng mà mốc của dự án đang gắn đợt thu của nó → chặn (đổi / bỏ đợt thu ở mốc trước).
        var newIds = ContractIdsOf(r);
        var links = await db.ProjectContracts.Where(x => x.ProjectId == id).ToListAsync(ct);
        var removed = links.Where(l => !newIds.Contains(l.ContractId)).ToList();
        if (removed.Count > 0)
        {
            var used = (await db.Milestones.AsNoTracking().Where(m => m.ProjectId == id && m.InstallmentId != null).Select(m => m.InstallmentId!.Value).ToListAsync(ct)).ToHashSet();
            foreach (var l in removed)
                if ((await sales.InstallmentsAsync(l.ContractId, ct)).Any(i => used.Contains(i.Id)))
                {
                    val.Add("salesContractIds", $"Hợp đồng {(await sales.GetAsync(l.ContractId, ct))?.Code} đang gắn với mốc nghiệm thu — bỏ đợt thu ở mốc trước");
                    break;
                }
        }
        if (val.Failed) return val.Problem();
        var depts = (await dir.ListDepartmentsAsync(ct)).ToDictionary(d => d.Id, d => d.Name);
        var codes = (await sales.GetManyAsync(links.Select(l => l.ContractId).Union(newIds).ToList(), ct)).ToDictionary(c => c.Id, c => c.Code);
        var before = Snapshot(p, links.Select(l => l.ContractId), depts, codes);
        db.ProjectContracts.RemoveRange(removed);
        foreach (var cid in newIds.Where(c => links.All(l => l.ContractId != c)))
            db.ProjectContracts.Add(new ProjectContract { ProjectId = id, ContractId = cid, LinkedAt = clock.Now });
        p.Name = r.Name.Trim(); p.Description = Clean(r.Description); p.Kind = r.Kind; p.BusinessLineId = r.BusinessLineId;
        p.StartOn = r.StartOn ?? p.StartOn; p.EndOn = r.EndOn; p.BudgetManDays = r.BudgetManDays; p.UpdatedAt = clock.Now;
        if (r.Sequential is { } sq) p.Sequential = sq;   // null (client cũ) → giữ nguyên
        if (r.DepartmentIds is not null)
        {
            var want = ProjectDepartmentRules.Normalize(r.DepartmentIds);
            p.Departments.RemoveAll(d => !want.Contains(d.DepartmentId));
            foreach (var d in p.Departments) d.IsLead = d.DepartmentId == r.LeadDepartmentId;
            foreach (var dep in want.Where(x => p.Departments.All(d => d.DepartmentId != x)))
                p.Departments.Add(new ProjectDepartment { ProjectId = p.Id, DepartmentId = dep, IsLead = dep == r.LeadDepartmentId, CreatedAt = clock.Now });
        }
        if (r.WorkGuide is not null) p.WorkGuide = Clean(r.WorkGuide); // "" → xoá
        if (r.Status != p.Status) p.ClosedOn = r.Status == ProjectStatus.Closed ? clock.Today : null;
        p.Status = r.Status;
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException) { return new Validation().Add("salesContractIds", "Hợp đồng vừa được gắn với dự án khác").Problem(); }
        await NotifyChangedAsync(notifier, access, db, p, v, user, ProjectChangeRules.Diff(before, Snapshot(p, newIds, depts, codes)), ct);
        return TypedResults.NoContent();
    }

    private static ProjectSnapshot Snapshot(Project p, IEnumerable<Guid> contractIds, IReadOnlyDictionary<Guid, string> depts, IReadOnlyDictionary<Guid, string> codes) =>
        new(p.Name, p.Kind, p.Status, p.Description,
            p.Departments.Count == 0 ? null : string.Join(", ", DepartmentsOf(p, depts).Select(d => d.IsLead ? $"{d.Name} (chủ trì)" : d.Name)), p.BusinessLineId,
            contractIds.Select(c => codes.GetValueOrDefault(c, "(hợp đồng)")).ToList(), p.StartOn, p.EndOn, p.BudgetManDays, p.Sequential, p.WorkGuide);

    /// <summary>
    /// TEST-38: chuông "Dự án … đã được cập nhật" cho mọi thành viên còn làm (<see cref="ProjectChangeRules"/>). Gọi ở mọi đường sửa dự án (web + token AI / MCP)
    /// sau khi lưu; không có thay đổi → không gửi. Qua token AI chủ token cũng nhận (biết bot vừa đổi gì).
    /// </summary>
    private static async Task NotifyChangedAsync(INotifier notifier, ProjectAccess access, ProjectsDbContext db, Project p, ProjectViewer v, ClaimsPrincipal user,
        List<string> changes, CancellationToken ct)
    {
        if (changes.Count == 0) return;
        var emps = await access.EmployeesAsync(ct);
        var memberIds = await db.Members.AsNoTracking().Where(m => m.ProjectId == p.Id).Select(m => m.EmployeeId).ToListAsync(ct);
        var byToken = user.IsAccessToken();
        var to = ProjectChangeRules.Recipients(memberIds.Select(m => emps.TryGetValue(m, out var e) ? (e.UserId, e.IsActive) : ((Guid?)null, false)), v.UserId, byToken);
        if (to.Count == 0) return;
        var guideOnly = changes.All(c => c.StartsWith(ProjectChangeRules.GuideField, StringComparison.Ordinal));
        await notifier.NotifyAsync(new NotificationRequest(to, NotificationCategories.ProjectTask, $"Dự án {p.Code} đã được cập nhật",
            ProjectChangeRules.Body(ProjectChangeRules.Actor(v.Name, byToken), changes), $"/projects/{p.Id}{(guideOnly ? "?tab=guide" : "")}", SendEmail: false), ct);
    }

    /// <summary>
    /// Chỉ sửa hướng dẫn làm việc (tool MCP update_project_guide — không phải gửi lại cả dự án như PUT /{id}). Quản lý dự án / HR, dự án đang chạy;
    /// null / "" = xoá. Project có [Audited] → lịch sử sửa ghi như sửa trên web.
    /// </summary>
    private static async Task<Results<Ok<ProjectGuideDto>, NotFound, ValidationProblem, ProblemHttpResult>> UpdateGuideAsync(Guid id, UpdateProjectGuide r,
        ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access, INotifier notifier, ProjectClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var p = await db.Projects.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p is null || !v.CanSee(id)) return TypedResults.NotFound();
        if (!v.CanManage(id)) return Forbidden("Chỉ quản lý dự án hoặc HR được sửa hướng dẫn làm việc");
        if (p.Status != ProjectStatus.Active) return Problems.Conflict("Dự án đã đóng");
        var val = new Validation().MaxLength(r.WorkGuide, TaskRules.MaxDescription, "workGuide", "Hướng dẫn làm việc");
        if (val.Failed) return val.Problem();
        var guide = Clean(r.WorkGuide);
        if (guide != p.WorkGuide)
        {
            p.WorkGuide = guide;
            p.UpdatedAt = clock.Now;
            await db.SaveChangesAsync(ct);
            await NotifyChangedAsync(notifier, access, db, p, v, user, [$"{ProjectChangeRules.GuideField}: đã sửa"], ct);
        }
        return TypedResults.Ok(new ProjectGuideDto(p.WorkGuide));
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
        var month = EffortRules.MonthStart(r.Month);
        // Tháng đã chốt: chỉ HR / Quản trị tài chính (kể cả khi không quản lý dự án). Tháng chưa chốt: quản lý dự án / HR.
        if (await db.Freezes.AnyAsync(f => f.Month == month && f.FrozenAt >= p.CreatedAt, ct))
        {
            if (!v.IsHr && !v.FinanceAdmin) return Forbidden($"Phân bổ tháng {month:MM/yyyy} đã chốt — chỉ HR hoặc Quản trị tài chính sửa được");
        }
        else if (!v.CanManage(id)) return Forbidden("Chỉ quản lý dự án hoặc HR được phân bổ");
        var val = new Validation();
        var emps = await access.EmployeesAsync(ct);
        foreach (var it in r.Items ?? [])
        {
            // Người đã rời dự án nhưng còn dòng % của tháng này (tháng đã chốt) vẫn sửa được.
            if (!p.Members.Any(m => m.EmployeeId == it.EmployeeId)
                && !await db.Allocations.AnyAsync(a => a.ProjectId == id && a.EmployeeId == it.EmployeeId && a.Month == month, ct))
            { val.Add("items", "Có người không phải thành viên dự án"); continue; }
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
        EffortCalculator calc, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var p = await db.Projects.AsNoTracking().Include(x => x.Members).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p is null || !v.CanSee(id)) return TypedResults.NotFound();
        if (!v.CanSeeEffort(id)) return Forbidden("Chỉ quản lý dự án, HR hoặc Ban giám đốc xem ngày công");
        var rows = await calc.ComputeAsync([p], ct);
        var cells = rows.Select(r => new EffortCell(r.EmployeeId, r.Month, r.PresentDays, r.Percent, r.Explicit, r.ManDays)).ToList();
        var months = calc.MonthsOf(p);
        var frozen = await db.Freezes.AsNoTracking().Where(f => months.Contains(f.Month) && f.FrozenAt >= p.CreatedAt).Select(f => f.Month).ToListAsync(ct);
        // Thành viên hiện tại + người đã rời nhưng còn ngày công ở tháng đã chốt.
        var members = await MembersAsync(p, access, ct);
        var emps = await access.EmployeesAsync(ct);
        foreach (var eid in cells.Select(c => c.EmployeeId).Distinct().Where(e => members.All(m => m.EmployeeId != e)))
            members.Add(emps.TryGetValue(eid, out var e) ? new MemberDto(eid, e.Code, $"{e.FullName} (đã rời dự án)", null, ProjectMemberRole.Member, e.IsActive)
                : new MemberDto(eid, null, "(không rõ)", null, ProjectMemberRole.Member, false));
        return TypedResults.Ok(new EffortDto(months, members, cells, cells.Sum(c => c.ManDays), p.BudgetManDays, frozen, v.IsHr || v.FinanceAdmin));

    }

    private static async Task<Results<Ok<IReadOnlyList<SalesContractRef>>, ProblemHttpResult>> SalesContractsAsync(ClaimsPrincipal user, ProjectAccess access,
        ISalesContractsLookup sales, string? search, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        if (!v.CanCreate && !v.Roles.Values.Contains(ProjectMemberRole.Manager)) return Forbidden("Chỉ quản lý dự án / HR được gắn hợp đồng");
        // Chỉ gợi ý hợp đồng người này được xem bên Sales (không lộ tên hợp đồng / khách của người khác).
        var found = await sales.SearchActiveAsync(search, ct);
        var visible = await sales.VisibleToAsync(v.UserId, found.Select(c => c.Id).ToList(), ct);
        return TypedResults.Ok<IReadOnlyList<SalesContractRef>>([.. found.Where(c => visible.Contains(c.Id))]);
    }

    private static async Task<Results<Ok<IReadOnlyList<InstallmentRef>>, ProblemHttpResult>> InstallmentsAsync(Guid contractId, ClaimsPrincipal user, ProjectAccess access,
        ProjectsDbContext db, ISalesContractsLookup sales, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var projectIds = await db.ProjectContracts.Where(x => x.ContractId == contractId).Select(x => x.ProjectId).ToListAsync(ct);
        if (!projectIds.Any(v.CanSee)) return Forbidden("Hợp đồng này không gắn với dự án bạn tham gia");
        return TypedResults.Ok(await sales.InstallmentsAsync(contractId, ct));
    }

    internal static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
