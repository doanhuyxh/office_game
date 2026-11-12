using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Organization.Contracts;
using OfficeHub.Modules.Projects.Contracts;
using OfficeHub.Modules.Projects.Domain;
using OfficeHub.Modules.Projects.Infrastructure;

namespace OfficeHub.Modules.Projects.Features;

/// <param name="CreatedByBot">Tạo qua token AI / MCP (nhãn BOT).</param>
/// <param name="WaitingOn">Số việc phải chờ chưa xong (0 = bắt đầu được).</param>
/// <param name="Done">Đang ở cột hoàn thành.</param>
public sealed record TaskDto(Guid Id, Guid ProjectId, string Code, string Title, string? Description, Guid ColumnId, string ColumnName, string ColumnColor, bool Done, double Rank, Guid? AssigneeEmployeeId, string? AssigneeName,
    Guid? MilestoneId, DateOnly? DueOn, decimal? EstimateDays, bool Overdue, int CommentCount, DateTimeOffset CreatedAt, string CreatedByName, DateTimeOffset? CompletedAt,
    List<string> MediaLinks, string? ProjectName = null, bool CreatedByBot = false, int WaitingOn = 0);
/// <summary>Việc liên quan (chờ / đang chặn) — mã, tên, đã xong chưa.</summary>
public sealed record TaskRefDto(Guid Id, string Code, string Title, bool Done);
/// <param name="DependsOn">Mã / id các việc phải xong trước (tối đa 10, cùng dự án) — thay toàn bộ danh sách; rỗng = bỏ hết.</param>
public sealed record SetDependencies(List<Guid> DependsOn);
/// <param name="ColumnId">Cột trạng thái — tạo: bỏ trống = cột đầu; sửa: bỏ trống = giữ nguyên.</param>
/// <param name="Note">Lý do khi chuyển lùi — bắt buộc nếu dự án đi lần lượt.</param>
public sealed record UpsertTask(string Title, string? Description = null, Guid? ColumnId = null, Guid? AssigneeEmployeeId = null, Guid? MilestoneId = null,
    DateOnly? DueOn = null, decimal? EstimateDays = null, List<string>? MediaLinks = null, string? Note = null);
public sealed record MoveTask(Guid ColumnId, double? Rank = null, string? Note = null);
public sealed record CommentDto(Guid Id, string Content, string AuthorName, DateTimeOffset CreatedAt, bool ByBot);
public sealed record NewComment(string Content);
public sealed record TaskActivityDto(Guid Id, TaskActivityKind Kind, string? From, string? To, string? Note, string ActorName, bool ByBot, DateTimeOffset At);
/// <param name="Sequential">Dự án đi lần lượt (tiến từng cột, lùi phải có lý do).</param>
/// <param name="CanApprove">Người xem được chuyển việc vào / lùi ra khỏi cột cần người duyệt (quản lý dự án / HR).</param>
/// <param name="DependsOn">Việc phải xong trước việc này.</param><param name="Blocks">Việc đang chờ việc này.</param>
public sealed record TaskDetailDto(TaskDto Task, List<CommentDto> Comments, List<TaskActivityDto> Activities, bool Sequential, bool CanApprove, List<TaskColumnDto> Columns,
    List<TaskRefDto>? DependsOn = null, List<TaskRefDto>? Blocks = null);

/// <summary>
/// Công việc dạng kanban theo cột trạng thái tự do của dự án (<see cref="TaskColumn"/>). Thành viên tạo / sửa / kéo; xoá: người tạo hoặc quản lý dự án.
/// Quy trình (đi lần lượt, cột cần người duyệt): <see cref="TaskWorkflow"/>. Mọi thay đổi ghi <see cref="TaskActivity"/>; qua token AI → BOT.
/// </summary>
internal static class TaskEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/{id:guid}/tasks", ListAsync);
        g.MapPost("/{id:guid}/tasks", CreateAsync);
        g.MapGet("/tasks/mine", MineAsync);
        g.MapGet("/tasks/{tid:guid}", DetailAsync);
        g.MapPut("/tasks/{tid:guid}", UpdateAsync);
        g.MapPost("/tasks/{tid:guid}/move", MoveAsync);
        g.MapDelete("/tasks/{tid:guid}", DeleteAsync);
        g.MapGet("/tasks/{tid:guid}/comments", CommentsAsync);
        g.MapPost("/tasks/{tid:guid}/comments", AddCommentAsync);
        g.MapPut("/tasks/{tid:guid}/dependencies", SetDependenciesAsync);
    }

    private static async Task<List<TaskDto>> ToDtosAsync(IReadOnlyList<TaskItem> rows, ProjectsDbContext db, ProjectAccess access, ProjectClock clock, CancellationToken ct,
        bool withProject = false)
    {
        var ids = rows.Select(t => t.Id).ToList();
        var counts = await db.Comments.AsNoTracking().Where(c => ids.Contains(c.TaskId)).GroupBy(c => c.TaskId).Select(g => new { g.Key, N = g.Count() })
            .ToDictionaryAsync(x => x.Key, x => x.N, ct);
        var projects = await db.Projects.AsNoTracking().Where(p => rows.Select(t => t.ProjectId).Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => new { p.Code, p.Name }, ct);
        var columnIds = rows.Select(t => t.ColumnId).Distinct().ToList();
        var columns = await db.Columns.AsNoTracking().Where(c => columnIds.Contains(c.Id)).ToDictionaryAsync(c => c.Id, c => new { c.Name, c.Color }, ct);
        var emps = await access.EmployeesAsync(ct);
        var today = clock.Today;
        var waiting = await (from d in db.Dependencies.AsNoTracking()
                             join x in db.Tasks.AsNoTracking() on d.DependsOnId equals x.Id
                             where ids.Contains(d.TaskId) && x.CompletedAt == null
                             group d by d.TaskId into g
                             select new { g.Key, N = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.N, ct);
        return rows.Select(t => new TaskDto(t.Id, t.ProjectId, EffortRules.TaskCode(projects[t.ProjectId].Code, t.Number), t.Title, t.Description, t.ColumnId,
            columns.GetValueOrDefault(t.ColumnId)?.Name ?? "?", columns.GetValueOrDefault(t.ColumnId)?.Color ?? TaskColumnRules.DefaultColor, t.CompletedAt != null, t.Rank,
            t.AssigneeEmployeeId, t.AssigneeEmployeeId is { } a && emps.TryGetValue(a, out var e) ? e.FullName : null, t.MilestoneId, t.DueOn, t.EstimateDays,
            EffortRules.IsOverdue(t.DueOn, t.CompletedAt != null, today), counts.GetValueOrDefault(t.Id), t.CreatedAt, t.CreatedByName, t.CompletedAt, t.MediaLinks,
            withProject ? projects[t.ProjectId].Name : null, t.CreatedByBot, waiting.GetValueOrDefault(t.Id))).ToList();
    }

    private static async Task<Results<Ok<List<TaskDto>>, NotFound>> ListAsync(Guid id, ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access, ProjectClock clock,
        CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        if (!v.CanSee(id) || !await db.Projects.AnyAsync(p => p.Id == id, ct)) return TypedResults.NotFound();
        var rows = await db.Tasks.AsNoTracking().Where(t => t.ProjectId == id).OrderBy(t => t.Rank).ThenBy(t => t.Number).ToListAsync(ct);
        return TypedResults.Ok(await ToDtosAsync(rows, db, access, clock, ct));
    }

    /// <summary>Việc chưa xong được giao cho tôi, ở mọi dự án.</summary>
    private static async Task<Ok<List<TaskDto>>> MineAsync(ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access, ProjectClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        if (v.Employee is null) return TypedResults.Ok(new List<TaskDto>());
        var rows = await db.Tasks.AsNoTracking().Where(t => t.AssigneeEmployeeId == v.Employee.Id && t.CompletedAt == null)
            .OrderBy(t => t.DueOn == null).ThenBy(t => t.DueOn).ThenBy(t => t.Id).Take(200).ToListAsync(ct);
        return TypedResults.Ok(await ToDtosAsync(rows, db, access, clock, ct, withProject: true));
    }

    /// <summary>Một việc + bình luận + lịch sử (hộp thoại việc trên web, tool MCP get_task).</summary>
    private static async Task<Results<Ok<TaskDetailDto>, NotFound>> DetailAsync(Guid tid, ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access, ProjectClock clock,
        CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var t = await db.Tasks.AsNoTracking().FirstOrDefaultAsync(x => x.Id == tid, ct);
        if (t is null || !v.CanSee(t.ProjectId)) return TypedResults.NotFound();
        var sequential = await db.Projects.Where(p => p.Id == t.ProjectId).Select(p => p.Sequential).FirstAsync(ct);
        var dto = (await ToDtosAsync([t], db, access, clock, ct, withProject: true))[0];
        var comments = await db.Comments.AsNoTracking().Where(c => c.TaskId == tid).OrderBy(c => c.CreatedAt)
            .Select(c => new CommentDto(c.Id, c.Content, c.AuthorName, c.CreatedAt, c.ByBot)).ToListAsync(ct);
        var activities = await db.Activities.AsNoTracking().Where(a => a.TaskId == tid).OrderBy(a => a.At)
            .Select(a => new TaskActivityDto(a.Id, a.Kind, a.From, a.To, a.Note, a.ActorName, a.ByBot, a.At)).ToListAsync(ct);
        var code = dto.Code[..dto.Code.LastIndexOf('-')];
        var dependsOn = await (from d in db.Dependencies.AsNoTracking() join x in db.Tasks.AsNoTracking() on d.DependsOnId equals x.Id
                               where d.TaskId == tid orderby x.Number select new { x.Id, x.Number, x.Title, Done = x.CompletedAt != null }).ToListAsync(ct);
        var blocks = await (from d in db.Dependencies.AsNoTracking() join x in db.Tasks.AsNoTracking() on d.TaskId equals x.Id
                            where d.DependsOnId == tid orderby x.Number select new { x.Id, x.Number, x.Title, Done = x.CompletedAt != null }).ToListAsync(ct);
        return TypedResults.Ok(new TaskDetailDto(dto, comments, activities, sequential, CanApprove(v, user, t.ProjectId),
            await TaskColumnEndpoints.ListForAsync(db, t.ProjectId, ct),
            dependsOn.Select(x => new TaskRefDto(x.Id, EffortRules.TaskCode(code, x.Number), x.Title, x.Done)).ToList(),
            blocks.Select(x => new TaskRefDto(x.Id, EffortRules.TaskCode(code, x.Number), x.Title, x.Done)).ToList()));
    }

    private static async Task<Validation> ValidateAsync(UpsertTask r, Project p, ProjectsDbContext db, DateOnly today, DateOnly? previousDue, CancellationToken ct)
    {
        var v = new Validation().Required(r.Title, "title", "Tên việc").MaxLength(r.Title, 300, "title", "Tên việc").MaxLength(r.Description, TaskRules.MaxDescription, "description", "Mô tả")
            .MaxLength(r.Note, TaskWorkflow.MaxNote, "note", "Lý do")
            .When(r.EstimateDays is < 0 or > 1000, "estimateDays", "Ước lượng không hợp lệ");
        if (r.MediaLinks is not null && TaskRules.MediaLinksError(TaskRules.NormalizeLinks(r.MediaLinks)) is { } linkErr) v.Add("mediaLinks", linkErr);
        if (EffortRules.DueDateError(r.DueOn, previousDue, today) is { } dueErr) v.Add("dueOn", dueErr);
        if (r.AssigneeEmployeeId is { } a && !p.Members.Any(m => m.EmployeeId == a)) v.Add("assigneeEmployeeId", "Người được giao phải là thành viên dự án");
        if (r.MilestoneId is { } mid && !await db.Milestones.AnyAsync(m => m.Id == mid && m.ProjectId == p.Id, ct)) v.Add("milestoneId", "Mốc không thuộc dự án");
        return v;
    }

    /// <summary>Được duyệt (vào / ra cột cần người duyệt): quản lý dự án / HR và KHÔNG qua token AI (<see cref="AgentTeamRules"/>).</summary>
    private static bool CanApprove(ProjectViewer v, ClaimsPrincipal user, Guid projectId) => v.CanManage(projectId) && !user.IsAccessToken();

    /// <summary>Token AI: việc đã qua tay bot quá nhiều lần liên tiếp → chặn (null = được làm).</summary>
    private static async Task<string?> StreakErrorAsync(ClaimsPrincipal user, Guid tid, ProjectsDbContext db, CancellationToken ct)
    {
        if (!user.IsAccessToken()) return null;
        var acts = await db.Activities.AsNoTracking().Where(a => a.TaskId == tid).OrderByDescending(a => a.At).Take(50)
            .Select(a => new { a.At, a.ByBot, a.Kind }).ToListAsync(ct);
        var comments = await db.Comments.AsNoTracking().Where(c => c.TaskId == tid).OrderByDescending(c => c.CreatedAt).Take(50)
            .Select(c => new { c.CreatedAt, c.ByBot }).ToListAsync(ct);
        var events = acts.Select(a => new TaskEvent(a.At, a.ByBot, a.Kind is TaskActivityKind.Moved or TaskActivityKind.Assigned))
            .Concat(comments.Select(c => new TaskEvent(c.CreatedAt, c.ByBot, true))); // bình luận bot cũng tính: chặn hai bot @nhắc nhau qua lại
        var limit = (await db.AgentLimitsAsync(ct)).Streak;
        return AgentTeamRules.StreakAllows(AgentTeamRules.BotStreak(events), limit) ? null : AgentTeamRules.StreakMessage(limit);
    }

    private static TaskActivity Activity(TaskItem t, TaskActivityKind kind, ProjectViewer v, ClaimsPrincipal user, DateTimeOffset now,
        string? from = null, string? to = null, string? note = null) =>
        new() { TaskId = t.Id, Kind = kind, From = Cut(from), To = Cut(to), Note = note, ActorEmployeeId = v.Employee?.Id, ActorName = v.Name, ByBot = user.IsAccessToken(), At = now };

    private static string? Cut(string? s) => s is { Length: > 200 } ? s[..200] : s;

    private static async Task<string?> NameOfAsync(ProjectAccess access, Guid? employeeId, CancellationToken ct) =>
        employeeId is { } id ? (await access.EmployeesAsync(ct)).TryGetValue(id, out var e) ? e.FullName : "(không rõ)" : null;

    private static async Task<Guid?> UserOfAsync(IEmployeeDirectory dir, Guid? employeeId, CancellationToken ct) =>
        employeeId is { } id ? (await dir.GetAsync(id, ct))?.UserId : null;

    /// <returns>Tài khoản đã nhận chuông (null = không gửi).</returns>
    private static async Task<Guid?> NotifyAssignedAsync(INotifier notifier, IEmployeeDirectory dir, Project p, TaskItem t, ProjectViewer v, CancellationToken ct)
    {
        if (t.AssigneeEmployeeId is not { } a || a == v.Employee?.Id) return null;
        if (await UserOfAsync(dir, a, ct) is not { } uid) return null;
        await notifier.NotifyAsync(new NotificationRequest([uid], NotificationCategories.ProjectTask, $"Bạn được giao việc {EffortRules.TaskCode(p.Code, t.Number)}: {t.Title}",
            $"{v.Name} giao trong dự án {p.Name}{(t.DueOn is { } d ? $", hạn {d:dd/MM/yyyy}" : "")}.", $"/projects/{p.Id}", SendEmail: false), ct);
        return uid;
    }

    /// <summary>Chuông chung cho mọi thành viên dự án, trừ người thao tác và <paramref name="alreadyNotified"/> (<see cref="TaskNotifyRules"/>).</summary>
    private static async Task NotifyMembersAsync(INotifier notifier, ProjectAccess access, Project p, ProjectViewer v, IEnumerable<Guid> alreadyNotified,
        string title, string body, CancellationToken ct)
    {
        var emps = await access.EmployeesAsync(ct);
        var to = TaskNotifyRules.Recipients(
            p.Members.Select(m => emps.TryGetValue(m.EmployeeId, out var e) ? (e.UserId, e.IsActive) : ((Guid?)null, false)), v.UserId, alreadyNotified);
        if (to.Count == 0) return;
        await notifier.NotifyAsync(new NotificationRequest(to, NotificationCategories.ProjectTask, title, TaskNotifyRules.Body(body), $"/projects/{p.Id}", SendEmail: false), ct);
    }

    private static Task NotifyMembersMovedAsync(INotifier notifier, ProjectAccess access, Project p, TaskItem t, List<ColumnInfo> cols, Guid from, string? note,
        ProjectViewer v, IEnumerable<Guid> alreadyNotified, CancellationToken ct)
    {
        if (from == t.ColumnId) return Task.CompletedTask;
        string Name(Guid id) => cols.FirstOrDefault(c => c.Id == id)?.Name ?? "?";
        return NotifyMembersAsync(notifier, access, p, v, alreadyNotified, $"{v.Name} chuyển {EffortRules.TaskCode(p.Code, t.Number)} sang \"{Name(t.ColumnId)}\"",
            $"{t.Title} ({Name(from)} → {Name(t.ColumnId)}), dự án {p.Name}.{(note is null ? "" : $" Lý do: {note}")}", ct);
    }

    /// <summary>
    /// Báo theo quy trình (<see cref="TaskWorkflow.Notice"/>): vào cột ngay trước cột cần duyệt → quản lý dự án; vào cột cần duyệt → người làm (đã duyệt);
    /// lùi kèm lý do → người làm. Bỏ chính người thao tác.
    /// </summary>
    /// <returns>Tài khoản đã nhận chuông.</returns>
    private static async Task<List<Guid>> NotifyMovedAsync(INotifier notifier, IEmployeeDirectory dir, Project p, TaskItem t, List<ColumnInfo> cols, Guid from, string? note,
        ProjectViewer v, CancellationToken ct)
    {
        var kind = TaskWorkflow.Notice(cols, from, t.ColumnId, note is not null);
        if (kind == MoveNotice.None) return [];
        var code = EffortRules.TaskCode(p.Code, t.Number);
        string Name(Guid id) => cols.FirstOrDefault(c => c.Id == id)?.Name ?? "?";
        var to = new List<Guid>();
        string title, body;
        if (kind == MoveNotice.AwaitingApproval)
        {
            foreach (var m in p.Members.Where(m => m.Role == ProjectMemberRole.Manager && m.EmployeeId != v.Employee?.Id))
                if (await UserOfAsync(dir, m.EmployeeId, ct) is { } u) to.Add(u);
            (title, body) = ($"Chờ duyệt: {code} {t.Title}", $"{v.Name} chuyển sang \"{Name(t.ColumnId)}\" trong dự án {p.Name}.");
        }
        else if (t.AssigneeEmployeeId != v.Employee?.Id && await UserOfAsync(dir, t.AssigneeEmployeeId, ct) is { } u)
        {
            to.Add(u);
            (title, body) = kind == MoveNotice.Approved
                ? ($"Đã duyệt: {code} {t.Title}", $"{v.Name} chuyển sang \"{Name(t.ColumnId)}\" trong dự án {p.Name}.")
                : ($"Trả lại việc: {code} {t.Title}", $"{v.Name} ({Name(from)} → {Name(t.ColumnId)}): {note}");
        }
        else return [];
        if (to.Count == 0) return [];
        await notifier.NotifyAsync(new NotificationRequest(to, NotificationCategories.ProjectTask, title, TaskNotifyRules.Body(body),
            $"/projects/{p.Id}", SendEmail: false), ct);
        return to;
    }

    private static async Task<Results<Created<Guid>, NotFound, ValidationProblem, ProblemHttpResult>> CreateAsync(Guid id, UpsertTask r, ClaimsPrincipal user,
        ProjectsDbContext db, ProjectAccess access, IEmployeeDirectory dir, INotifier notifier, ProjectClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var p = await db.Projects.AsNoTracking().Include(x => x.Members).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p is null || !v.CanSee(id)) return TypedResults.NotFound();
        if (!v.CanWork(id)) return ProjectEndpoints.Forbidden("Chỉ thành viên dự án được tạo việc");
        if (p.Status != ProjectStatus.Active) return Problems.Conflict("Dự án đã đóng");
        var val = await ValidateAsync(r, p, db, clock.Today, null, ct);
        var cols = TaskColumnEndpoints.Infos(await TaskColumnEndpoints.LoadAsync(db, id, ct));
        if (cols.Count == 0) return Problems.Conflict("Dự án chưa có trạng thái công việc");
        var column = cols.FirstOrDefault(c => c.Id == (r.ColumnId ?? cols[0].Id));
        if (column is null) val.Add("columnId", "Trạng thái không thuộc dự án");
        else if (TaskWorkflow.CreateError(cols, column.Id, p.Sequential, CanApprove(v, user, id)) is { } colErr) val.Add("columnId", colErr);
        if (val.Failed) return val.Problem();
        if (user.IsAccessToken())
        {
            var since = clock.StartOfToday;
            var me = v.Employee?.Id;
            var createdToday = await db.Activities.CountAsync(a => a.Kind == TaskActivityKind.Created && a.ByBot && a.ActorEmployeeId == me && a.At >= since, ct);
            var limit = (await db.AgentLimitsAsync(ct)).TasksPerDay;
            if (!AgentTeamRules.TaskQuotaLeft(createdToday, limit))
                return TypedResults.Problem(AgentTeamRules.TaskQuotaMessage(limit), statusCode: StatusCodes.Status429TooManyRequests);
        }
        for (var attempt = 0; ; attempt++)
        {
            var number = (await db.Tasks.Where(t => t.ProjectId == id).MaxAsync(t => (int?)t.Number, ct) ?? 0) + 1;
            var rank = (await db.Tasks.Where(t => t.ColumnId == column!.Id).MaxAsync(t => (double?)t.Rank, ct) ?? 0) + 1;
            var t = new TaskItem
            {
                ProjectId = id, Number = number, Title = r.Title.Trim(), Description = ProjectEndpoints.Clean(r.Description), MediaLinks = TaskRules.NormalizeLinks(r.MediaLinks),
                ColumnId = column!.Id, Rank = rank,
                AssigneeEmployeeId = r.AssigneeEmployeeId, MilestoneId = r.MilestoneId, DueOn = r.DueOn, EstimateDays = r.EstimateDays, CreatedAt = clock.Now, CreatedByName = v.Name,
                CreatedByBot = user.IsAccessToken(), CompletedAt = column.IsDone ? clock.Now : null,
            };
            db.Tasks.Add(t);
            var created = Activity(t, TaskActivityKind.Created, v, user, clock.Now, to: column.Name);
            db.Activities.Add(created);
            try { await db.SaveChangesAsync(ct); }
            catch (DbUpdateException) when (attempt < 3) { db.Tasks.Remove(t); db.Activities.Remove(created); continue; } // hai người tạo cùng lúc → số trùng, thử số kế
            var assigned = await NotifyAssignedAsync(notifier, dir, p, t, v, ct);
            await NotifyMembersAsync(notifier, access, p, v, assigned is { } au ? [au] : [], $"Việc mới {EffortRules.TaskCode(p.Code, t.Number)}: {t.Title}",
                $"{v.Name} tạo trong dự án {p.Name} (\"{column.Name}\").", ct);
            return TypedResults.Created($"/api/projects/tasks/{t.Id}", t.Id);
        }
    }

    private static async Task<(TaskItem? T, Project? P)> LoadAsync(Guid tid, ProjectsDbContext db, CancellationToken ct)
    {
        var t = await db.Tasks.FirstOrDefaultAsync(x => x.Id == tid, ct);
        return t is null ? (null, null) : (t, await db.Projects.Include(p => p.Members).FirstOrDefaultAsync(p => p.Id == t.ProjectId, ct));
    }

    /// <summary>Đổi cột theo quy trình + ghi lịch sử (lý do khi lùi cũng thành bình luận để cả nhóm thấy). Trả lỗi (409) nếu sai quy trình.</summary>
    private static string? ApplyColumn(TaskItem t, Project p, List<ColumnInfo> cols, Guid to, string? note, ProjectViewer v, ClaimsPrincipal user, ProjectsDbContext db,
        DateTimeOffset now)
    {
        if (t.ColumnId == to) return null;
        note = ProjectEndpoints.Clean(note);
        if (TaskWorkflow.MoveError(cols, t.ColumnId, to, p.Sequential, CanApprove(v, user, p.Id), note is not null) is { } err) return err;
        var src = cols.FirstOrDefault(c => c.Id == t.ColumnId)?.Name ?? "?";
        var dst = cols.First(c => c.Id == to);
        db.Activities.Add(Activity(t, TaskActivityKind.Moved, v, user, now, src, dst.Name, note));
        if (note is not null)
            db.Comments.Add(new TaskComment
            {
                TaskId = t.Id, AuthorEmployeeId = v.Employee?.Id, AuthorName = v.Name, ByBot = user.IsAccessToken(), CreatedAt = now,
                Content = $"**{src} → {dst.Name}:** {note}",
            });
        t.CompletedAt = dst.IsDone ? t.CompletedAt ?? now : null; // giữa hai cột hoàn thành: giữ ngày xong cũ
        t.ColumnId = to;
        return null;
    }

    private static async Task<Results<NoContent, NotFound, ValidationProblem, ProblemHttpResult>> UpdateAsync(Guid tid, UpsertTask r, ClaimsPrincipal user, ProjectsDbContext db,
        ProjectAccess access, IEmployeeDirectory dir, INotifier notifier, ProjectClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var (t, p) = await LoadAsync(tid, db, ct);
        if (t is null || p is null || !v.CanSee(p.Id)) return TypedResults.NotFound();
        if (!v.CanWork(p.Id)) return ProjectEndpoints.Forbidden("Chỉ thành viên dự án được sửa việc");
        if (p.Status != ProjectStatus.Active) return Problems.Conflict("Dự án đã đóng");
        var val = await ValidateAsync(r, p, db, clock.Today, t.DueOn, ct);
        if (val.Failed) return val.Problem();
        var changesFlow = (r.ColumnId is { } nc && nc != t.ColumnId) || r.AssigneeEmployeeId != t.AssigneeEmployeeId;
        if (changesFlow && await StreakErrorAsync(user, t.Id, db, ct) is { } streakErr) return Problems.Conflict(streakErr);
        var now = clock.Now;
        var from = t.ColumnId;
        var cols = TaskColumnEndpoints.Infos(await TaskColumnEndpoints.LoadAsync(db, p.Id, ct));
        var wasDone = t.CompletedAt != null;
        if (r.ColumnId is { } sc && await StartErrorAsync(user, t, cols, sc, db, ct) is { } startErr) return Problems.Conflict(startErr);
        if (r.ColumnId is { } cid && ApplyColumn(t, p, cols, cid, r.Note, v, user, db, now) is { } stateErr) return Problems.Conflict(stateErr);
        var reassigned = r.AssigneeEmployeeId != t.AssigneeEmployeeId;
        if (reassigned)
            db.Activities.Add(Activity(t, TaskActivityKind.Assigned, v, user, now, await NameOfAsync(access, t.AssigneeEmployeeId, ct), await NameOfAsync(access, r.AssigneeEmployeeId, ct)));
        if (r.DueOn != t.DueOn)
            db.Activities.Add(Activity(t, TaskActivityKind.DueChanged, v, user, now, t.DueOn?.ToString("yyyy-MM-dd"), r.DueOn?.ToString("yyyy-MM-dd")));
        var links = r.MediaLinks is null ? t.MediaLinks : TaskRules.NormalizeLinks(r.MediaLinks); // null (client cũ) → giữ nguyên
        var title = r.Title.Trim();
        var description = ProjectEndpoints.Clean(r.Description);
        if (title != t.Title || description != t.Description || r.EstimateDays != t.EstimateDays || r.MilestoneId != t.MilestoneId || !links.SequenceEqual(t.MediaLinks))
            db.Activities.Add(Activity(t, TaskActivityKind.Edited, v, user, now));
        if (r.DueOn != t.DueOn || reassigned) t.DueRemindedAt = null; // đổi hạn / người → nhắc lại theo hạn mới
        t.Title = title; t.Description = description; t.AssigneeEmployeeId = r.AssigneeEmployeeId; t.MilestoneId = r.MilestoneId;
        t.DueOn = r.DueOn; t.EstimateDays = r.EstimateDays; t.MediaLinks = links;
        await db.SaveChangesAsync(ct);
        var notified = new List<Guid>();
        if (reassigned && await NotifyAssignedAsync(notifier, dir, p, t, v, ct) is { } au) notified.Add(au);
        var note = ProjectEndpoints.Clean(r.Note);
        notified.AddRange(await NotifyMovedAsync(notifier, dir, p, t, cols, from, note, v, ct));
        await NotifyMembersMovedAsync(notifier, access, p, t, cols, from, note, v, notified, ct);
        if (!wasDone && t.CompletedAt != null) await NotifyUnblockedAsync(notifier, dir, db, p, t, v, ct);
        return TypedResults.NoContent();
    }

    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> MoveAsync(Guid tid, MoveTask r, ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access,
        IEmployeeDirectory dir, INotifier notifier, ProjectClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var (t, p) = await LoadAsync(tid, db, ct);
        if (t is null || p is null || !v.CanSee(p.Id)) return TypedResults.NotFound();
        if (!v.CanWork(p.Id)) return ProjectEndpoints.Forbidden("Chỉ thành viên dự án được chuyển việc");
        if (p.Status != ProjectStatus.Active) return Problems.Conflict("Dự án đã đóng");
        if (r.Note is { Length: > TaskWorkflow.MaxNote }) return Problems.Conflict($"Lý do dài quá {TaskWorkflow.MaxNote} ký tự");
        var cols = TaskColumnEndpoints.Infos(await TaskColumnEndpoints.LoadAsync(db, p.Id, ct));
        if (cols.All(c => c.Id != r.ColumnId)) return Problems.Conflict("Trạng thái không thuộc dự án");
        var from = t.ColumnId;
        var wasDone = t.CompletedAt != null;
        if (r.ColumnId != t.ColumnId && await StreakErrorAsync(user, t.Id, db, ct) is { } streakErr) return Problems.Conflict(streakErr);
        if (await StartErrorAsync(user, t, cols, r.ColumnId, db, ct) is { } startErr) return Problems.Conflict(startErr);
        if (ApplyColumn(t, p, cols, r.ColumnId, r.Note, v, user, db, clock.Now) is { } err) return Problems.Conflict(err);
        t.Rank = r.Rank ?? (await db.Tasks.Where(x => x.ColumnId == r.ColumnId && x.Id != t.Id).MaxAsync(x => (double?)x.Rank, ct) ?? 0) + 1;
        await db.SaveChangesAsync(ct);
        var note = ProjectEndpoints.Clean(r.Note);
        var notified = await NotifyMovedAsync(notifier, dir, p, t, cols, from, note, v, ct);
        await NotifyMembersMovedAsync(notifier, access, p, t, cols, from, note, v, notified, ct);
        if (!wasDone && t.CompletedAt != null) await NotifyUnblockedAsync(notifier, dir, db, p, t, v, ct);
        return TypedResults.NoContent();
    }

    /// <summary>Bot đưa việc còn chờ ra khỏi cột đầu → lỗi (<see cref="DependencyRules.StartError"/>).</summary>
    private static async Task<string?> StartErrorAsync(ClaimsPrincipal user, TaskItem t, List<ColumnInfo> cols, Guid to, ProjectsDbContext db, CancellationToken ct)
    {
        if (!user.IsAccessToken() || cols.Count == 0 || t.ColumnId != cols[0].Id || to == t.ColumnId) return null;
        var unfinished = await (from d in db.Dependencies join x in db.Tasks on d.DependsOnId equals x.Id
                                where d.TaskId == t.Id && x.CompletedAt == null select d).CountAsync(ct);
        return DependencyRules.StartError(unfinished, leavingFirstColumn: true, byBot: true);
    }

    /// <summary>
    /// <paramref name="done"/> vừa xong → các việc đang chờ nó mà nay đã hết chờ: báo người làm (chưa giao → quản lý dự án).
    /// Chuông + webhook → agent được giao tự bắt đầu, không cần ai điều phối.
    /// </summary>
    private static async Task NotifyUnblockedAsync(INotifier notifier, IEmployeeDirectory dir, ProjectsDbContext db, Project p, TaskItem done, ProjectViewer v,
        CancellationToken ct)
    {
        var dependents = await (from d in db.Dependencies.AsNoTracking() join x in db.Tasks.AsNoTracking() on d.TaskId equals x.Id
                                where d.DependsOnId == done.Id && x.CompletedAt == null select x).ToListAsync(ct);
        foreach (var x in dependents)
        {
            var stillWaiting = await (from d in db.Dependencies.AsNoTracking() join y in db.Tasks.AsNoTracking() on d.DependsOnId equals y.Id
                                      where d.TaskId == x.Id && y.CompletedAt == null select d).AnyAsync(ct);
            if (stillWaiting) continue;
            var to = new List<Guid>();
            if (x.AssigneeEmployeeId is { } a)
            {
                if (await UserOfAsync(dir, a, ct) is { } u) to.Add(u);
            }
            else
                foreach (var m in p.Members.Where(m => m.Role == ProjectMemberRole.Manager))
                    if (await UserOfAsync(dir, m.EmployeeId, ct) is { } u) to.Add(u);
            to.Remove(v.UserId);
            if (to.Count == 0) continue;
            await notifier.NotifyAsync(new NotificationRequest(to, NotificationCategories.ProjectTask,
                $"Sẵn sàng: {EffortRules.TaskCode(p.Code, x.Number)} {x.Title}",
                $"{EffortRules.TaskCode(p.Code, done.Number)} \"{done.Title}\" đã xong — việc này hết phải chờ, có thể bắt đầu.", $"/projects/{p.Id}", SendEmail: false), ct);
        }
    }

    /// <summary>Đặt danh sách việc phải chờ (thay toàn bộ). Thành viên dự án đang chạy; cùng dự án, không vòng, ≤ 10.</summary>
    private static async Task<Results<NoContent, NotFound, ValidationProblem, ProblemHttpResult>> SetDependenciesAsync(Guid tid, SetDependencies r, ClaimsPrincipal user,
        ProjectsDbContext db, ProjectAccess access, ProjectClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var (t, p) = await LoadAsync(tid, db, ct);
        if (t is null || p is null || !v.CanSee(p.Id)) return TypedResults.NotFound();
        if (!v.CanWork(p.Id)) return ProjectEndpoints.Forbidden("Chỉ thành viên dự án được sửa việc phải chờ");
        if (p.Status != ProjectStatus.Active) return Problems.Conflict("Dự án đã đóng");
        if (await StreakErrorAsync(user, t.Id, db, ct) is { } streakErr) return Problems.Conflict(streakErr);
        var wanted = (r.DependsOn ?? []).Where(x => x != Guid.Empty).Distinct().ToList();
        var projectTasks = (await db.Tasks.AsNoTracking().Where(x => x.ProjectId == p.Id).Select(x => new { x.Id, x.Number }).ToListAsync(ct));
        var numbers = projectTasks.ToDictionary(x => x.Id, x => x.Number);
        var edges = await (from d in db.Dependencies.AsNoTracking() join x in db.Tasks.AsNoTracking() on d.TaskId equals x.Id
                           where x.ProjectId == p.Id && d.TaskId != tid select new { d.TaskId, d.DependsOnId }).ToListAsync(ct);
        if (DependencyRules.Error(tid, wanted, numbers.Keys.ToHashSet(), edges.Select(e => (e.TaskId, e.DependsOnId))) is { } err)
            return new Validation().Add("dependsOn", err).Problem();
        var current = await db.Dependencies.Where(d => d.TaskId == tid).ToListAsync(ct);
        var before = current.Select(d => d.DependsOnId).ToHashSet();
        if (before.SetEquals(wanted)) return TypedResults.NoContent();
        db.Dependencies.RemoveRange(current.Where(d => !wanted.Contains(d.DependsOnId)));
        var now = clock.Now;
        foreach (var id in wanted.Where(x => !before.Contains(x))) db.Dependencies.Add(new TaskDependency { TaskId = tid, DependsOnId = id, CreatedAt = now });
        string Codes(IEnumerable<Guid> ids) => string.Join(", ", ids.Select(i => EffortRules.TaskCode(p.Code, numbers[i])).Order());
        db.Activities.Add(Activity(t, TaskActivityKind.Depends, v, user, now, before.Count == 0 ? null : Codes(before), wanted.Count == 0 ? null : Codes(wanted)));
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> DeleteAsync(Guid tid, ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var (t, p) = await LoadAsync(tid, db, ct);
        if (t is null || p is null || !v.CanSee(p.Id)) return TypedResults.NotFound();
        // TEST-14: so người tạo bằng Id nhân viên (hoạt động "Created"), không bằng tên — hai người trùng tên từng xoá được việc của nhau.
        // Việc tạo trước khi có lịch sử (không có hoạt động Created) → chỉ quản lý dự án xoá. Người tạo phải còn là thành viên (CanWork).
        if (!v.CanManage(p.Id))
        {
            var creator = await db.Activities.AsNoTracking().Where(a => a.TaskId == t.Id && a.Kind == TaskActivityKind.Created)
                .Select(a => a.ActorEmployeeId).FirstOrDefaultAsync(ct);
            if (!v.CanWork(p.Id) || v.Employee?.Id is not { } me || creator != me)
                return ProjectEndpoints.Forbidden("Chỉ người tạo việc hoặc quản lý dự án được xoá");
        }
        db.Tasks.Remove(t);
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private static async Task<Results<Ok<List<CommentDto>>, NotFound>> CommentsAsync(Guid tid, ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var t = await db.Tasks.AsNoTracking().FirstOrDefaultAsync(x => x.Id == tid, ct);
        if (t is null || !v.CanSee(t.ProjectId)) return TypedResults.NotFound();
        return TypedResults.Ok(await db.Comments.AsNoTracking().Where(c => c.TaskId == tid).OrderBy(c => c.CreatedAt)
            .Select(c => new CommentDto(c.Id, c.Content, c.AuthorName, c.CreatedAt, c.ByBot)).ToListAsync(ct));
    }

    private static async Task<Results<Created<Guid>, NotFound, ValidationProblem, ProblemHttpResult>> AddCommentAsync(Guid tid, NewComment r, ClaimsPrincipal user,
        ProjectsDbContext db, ProjectAccess access, IEmployeeDirectory dir, INotifier notifier, ProjectClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var (t, p) = await LoadAsync(tid, db, ct);
        if (t is null || p is null || !v.CanSee(p.Id)) return TypedResults.NotFound();
        if (!v.CanWork(p.Id)) return ProjectEndpoints.Forbidden("Chỉ thành viên dự án được bình luận");
        var val = new Validation().Required(r.Content, "content", "Nội dung").MaxLength(r.Content, 3000, "content", "Nội dung");
        if (val.Failed) return val.Problem();
        if (await StreakErrorAsync(user, t.Id, db, ct) is { } streakErr) return Problems.Conflict(streakErr);
        var c = new TaskComment { TaskId = tid, Content = r.Content.Trim(), AuthorEmployeeId = v.Employee?.Id, AuthorName = v.Name, ByBot = user.IsAccessToken(), CreatedAt = clock.Now };
        db.Comments.Add(c);
        await db.SaveChangesAsync(ct);
        var code = EffortRules.TaskCode(p.Code, t.Number);
        var preview = c.Content.Length > 200 ? c.Content[..200] + "…" : c.Content;
        var notified = new List<Guid>();
        if (t.AssigneeEmployeeId is { } a && a != v.Employee?.Id && (await dir.GetAsync(a, ct))?.UserId is { } uid)
        {
            await notifier.NotifyAsync(new NotificationRequest([uid], NotificationCategories.ProjectTask, $"{v.Name} bình luận việc {code}",
                preview, $"/projects/{p.Id}", SendEmail: false), ct);
            notified.Add(uid);
        }
        // @mã-nhân-viên → báo thành viên dự án được nhắc (trừ người viết và người làm việc — đã nhận chuông bình luận ở trên)
        var codes = AgentTeamRules.MentionedCodes(c.Content);
        if (codes.Count > 0)
        {
            var emps = await access.EmployeesAsync(ct);
            var memberIds = p.Members.Select(m => m.EmployeeId).ToHashSet();
            var mentioned = new List<Guid>();
            foreach (var e in emps.Values.Where(e => memberIds.Contains(e.Id) && e.Id != v.Employee?.Id && e.Id != t.AssigneeEmployeeId
                         && codes.Contains(e.Code, StringComparer.OrdinalIgnoreCase)))
                if (e.UserId is { } mu) mentioned.Add(mu);
            if (mentioned.Count > 0)
                await notifier.NotifyAsync(new NotificationRequest(mentioned, NotificationCategories.ProjectTask, $"{v.Name} nhắc bạn trong việc {code}",
                    preview, $"/projects/{p.Id}", SendEmail: false), ct);
            notified.AddRange(mentioned);
        }
        await NotifyMembersAsync(notifier, access, p, v, notified, $"{v.Name} bình luận việc {code}", $"{t.Title}: {preview}", ct);
        return TypedResults.Created($"/api/projects/comments/{c.Id}", c.Id);
    }
}
