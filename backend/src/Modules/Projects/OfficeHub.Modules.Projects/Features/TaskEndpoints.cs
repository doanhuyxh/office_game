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
public sealed record TaskDto(Guid Id, Guid ProjectId, string Code, string Title, string? Description, TaskState State, double Rank, Guid? AssigneeEmployeeId, string? AssigneeName,
    Guid? MilestoneId, DateOnly? DueOn, decimal? EstimateDays, bool Overdue, int CommentCount, DateTimeOffset CreatedAt, string CreatedByName, DateTimeOffset? CompletedAt,
    List<string> MediaLinks, string? ProjectName = null, bool CreatedByBot = false);
/// <param name="Note">Lý do khi chuyển lùi (review chưa đạt / mở lại việc) — bắt buộc nếu dự án cần duyệt.</param>
public sealed record UpsertTask(string Title, string? Description = null, TaskState State = TaskState.Todo, Guid? AssigneeEmployeeId = null, Guid? MilestoneId = null,
    DateOnly? DueOn = null, decimal? EstimateDays = null, List<string>? MediaLinks = null, string? Note = null);
public sealed record MoveTask(TaskState State, double? Rank = null, string? Note = null);
public sealed record CommentDto(Guid Id, string Content, string AuthorName, DateTimeOffset CreatedAt, bool ByBot);
public sealed record NewComment(string Content);
public sealed record TaskActivityDto(Guid Id, TaskActivityKind Kind, string? From, string? To, string? Note, string ActorName, bool ByBot, DateTimeOffset At);
/// <param name="CanApprove">Người xem được chuyển Chờ review → Xong (quản lý dự án / HR).</param>
public sealed record TaskDetailDto(TaskDto Task, List<CommentDto> Comments, List<TaskActivityDto> Activities, bool RequireReview, bool CanApprove);

/// <summary>
/// Công việc dạng kanban: Cần làm → Đang làm → Chờ review → Xong. Thành viên tạo / sửa / kéo; xoá: người tạo hoặc quản lý dự án.
/// Dự án bật "Xong cần duyệt" → đi lần lượt, chỉ quản lý duyệt Xong (<see cref="TaskWorkflow"/>). Mọi thay đổi ghi <see cref="TaskActivity"/>; qua token AI → BOT.
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
    }

    private static async Task<List<TaskDto>> ToDtosAsync(IReadOnlyList<TaskItem> rows, ProjectsDbContext db, ProjectAccess access, ProjectClock clock, CancellationToken ct,
        bool withProject = false)
    {
        var ids = rows.Select(t => t.Id).ToList();
        var counts = await db.Comments.AsNoTracking().Where(c => ids.Contains(c.TaskId)).GroupBy(c => c.TaskId).Select(g => new { g.Key, N = g.Count() })
            .ToDictionaryAsync(x => x.Key, x => x.N, ct);
        var projects = await db.Projects.AsNoTracking().Where(p => rows.Select(t => t.ProjectId).Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => new { p.Code, p.Name }, ct);
        var emps = await access.EmployeesAsync(ct);
        var today = clock.Today;
        return rows.Select(t => new TaskDto(t.Id, t.ProjectId, EffortRules.TaskCode(projects[t.ProjectId].Code, t.Number), t.Title, t.Description, t.State, t.Rank,
            t.AssigneeEmployeeId, t.AssigneeEmployeeId is { } a && emps.TryGetValue(a, out var e) ? e.FullName : null, t.MilestoneId, t.DueOn, t.EstimateDays,
            EffortRules.IsOverdue(t.DueOn, t.State, today), counts.GetValueOrDefault(t.Id), t.CreatedAt, t.CreatedByName, t.CompletedAt, t.MediaLinks,
            withProject ? projects[t.ProjectId].Name : null, t.CreatedByBot)).ToList();
    }

    private static async Task<Results<Ok<List<TaskDto>>, NotFound>> ListAsync(Guid id, ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access, ProjectClock clock,
        CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        if (!v.CanSee(id) || !await db.Projects.AnyAsync(p => p.Id == id, ct)) return TypedResults.NotFound();
        var rows = await db.Tasks.AsNoTracking().Where(t => t.ProjectId == id).OrderBy(t => t.State).ThenBy(t => t.Rank).ThenBy(t => t.Number).ToListAsync(ct);
        return TypedResults.Ok(await ToDtosAsync(rows, db, access, clock, ct));
    }

    /// <summary>Việc chưa xong được giao cho tôi, ở mọi dự án.</summary>
    private static async Task<Ok<List<TaskDto>>> MineAsync(ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access, ProjectClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        if (v.Employee is null) return TypedResults.Ok(new List<TaskDto>());
        var rows = await db.Tasks.AsNoTracking().Where(t => t.AssigneeEmployeeId == v.Employee.Id && t.State != TaskState.Done)
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
        var requireReview = await db.Projects.Where(p => p.Id == t.ProjectId).Select(p => p.RequireReview).FirstAsync(ct);
        var dto = (await ToDtosAsync([t], db, access, clock, ct, withProject: true))[0];
        var comments = await db.Comments.AsNoTracking().Where(c => c.TaskId == tid).OrderBy(c => c.CreatedAt)
            .Select(c => new CommentDto(c.Id, c.Content, c.AuthorName, c.CreatedAt, c.ByBot)).ToListAsync(ct);
        var activities = await db.Activities.AsNoTracking().Where(a => a.TaskId == tid).OrderBy(a => a.At)
            .Select(a => new TaskActivityDto(a.Id, a.Kind, a.From, a.To, a.Note, a.ActorName, a.ByBot, a.At)).ToListAsync(ct);
        return TypedResults.Ok(new TaskDetailDto(dto, comments, activities, requireReview, v.CanManage(t.ProjectId)));
    }

    private static async Task<Validation> ValidateAsync(UpsertTask r, Project p, ProjectsDbContext db, DateOnly today, DateOnly? previousDue, CancellationToken ct)
    {
        var v = new Validation().Required(r.Title, "title", "Tên việc").MaxLength(r.Title, 300, "title", "Tên việc").MaxLength(r.Description, TaskRules.MaxDescription, "description", "Mô tả")
            .MaxLength(r.Note, TaskWorkflow.MaxNote, "note", "Lý do")
            .When(r.EstimateDays is < 0 or > 1000, "estimateDays", "Ước lượng không hợp lệ")
            .When(!Enum.IsDefined(r.State), "state", "Trạng thái không hợp lệ");
        if (r.MediaLinks is not null && TaskRules.MediaLinksError(TaskRules.NormalizeLinks(r.MediaLinks)) is { } linkErr) v.Add("mediaLinks", linkErr);
        if (EffortRules.DueDateError(r.DueOn, previousDue, today) is { } dueErr) v.Add("dueOn", dueErr);
        if (r.AssigneeEmployeeId is { } a && !p.Members.Any(m => m.EmployeeId == a)) v.Add("assigneeEmployeeId", "Người được giao phải là thành viên dự án");
        if (r.MilestoneId is { } mid && !await db.Milestones.AnyAsync(m => m.Id == mid && m.ProjectId == p.Id, ct)) v.Add("milestoneId", "Mốc không thuộc dự án");
        return v;
    }

    private static TaskActivity Activity(TaskItem t, TaskActivityKind kind, ProjectViewer v, ClaimsPrincipal user, DateTimeOffset now,
        string? from = null, string? to = null, string? note = null) =>
        new() { TaskId = t.Id, Kind = kind, From = Cut(from), To = Cut(to), Note = note, ActorEmployeeId = v.Employee?.Id, ActorName = v.Name, ByBot = user.IsAccessToken(), At = now };

    private static string? Cut(string? s) => s is { Length: > 200 } ? s[..200] : s;

    private static async Task<string?> NameOfAsync(ProjectAccess access, Guid? employeeId, CancellationToken ct) =>
        employeeId is { } id ? (await access.EmployeesAsync(ct)).TryGetValue(id, out var e) ? e.FullName : "(không rõ)" : null;

    private static async Task<Guid?> UserOfAsync(IEmployeeDirectory dir, Guid? employeeId, CancellationToken ct) =>
        employeeId is { } id ? (await dir.GetAsync(id, ct))?.UserId : null;

    private static async Task NotifyAssignedAsync(INotifier notifier, IEmployeeDirectory dir, Project p, TaskItem t, ProjectViewer v, CancellationToken ct)
    {
        if (t.AssigneeEmployeeId is not { } a || a == v.Employee?.Id) return;
        if (await UserOfAsync(dir, a, ct) is not { } uid) return;
        await notifier.NotifyAsync(new NotificationRequest([uid], NotificationCategories.ProjectTask, $"Bạn được giao việc {EffortRules.TaskCode(p.Code, t.Number)}: {t.Title}",
            $"{v.Name} giao trong dự án {p.Name}{(t.DueOn is { } d ? $", hạn {d:dd/MM/yyyy}" : "")}.", $"/projects/{p.Id}", SendEmail: false), ct);
    }

    /// <summary>
    /// Báo theo quy trình (chỉ dự án cần duyệt): gửi review → quản lý dự án; review chưa đạt / mở lại → người làm (kèm lý do); duyệt Xong → người làm.
    /// Bỏ chính người thao tác.
    /// </summary>
    private static async Task NotifyMovedAsync(INotifier notifier, IEmployeeDirectory dir, Project p, TaskItem t, TaskState from, string? note, ProjectViewer v, CancellationToken ct)
    {
        if (!p.RequireReview || from == t.State) return;
        var code = EffortRules.TaskCode(p.Code, t.Number);
        var to = new List<Guid>();
        string title, body;
        if (t.State == TaskState.Review && from < TaskState.Review)
        {
            foreach (var m in p.Members.Where(m => m.Role == ProjectMemberRole.Manager && m.EmployeeId != v.Employee?.Id))
                if (await UserOfAsync(dir, m.EmployeeId, ct) is { } u) to.Add(u);
            (title, body) = ($"Chờ review: {code} {t.Title}", $"{v.Name} gửi review trong dự án {p.Name}.");
        }
        else if (t.AssigneeEmployeeId != v.Employee?.Id && await UserOfAsync(dir, t.AssigneeEmployeeId, ct) is { } u)
        {
            to.Add(u);
            if (t.State == TaskState.Done) (title, body) = ($"Đã duyệt xong: {code} {t.Title}", $"{v.Name} duyệt trong dự án {p.Name}.");
            else if (from >= TaskState.Review && t.State < from)
                (title, body) = (from == TaskState.Done ? $"Mở lại việc: {code} {t.Title}" : $"Review chưa đạt: {code} {t.Title}", $"{v.Name}: {note}");
            else return;
        }
        else return;
        if (to.Count == 0) return;
        await notifier.NotifyAsync(new NotificationRequest(to, NotificationCategories.ProjectTask, title, body.Length > 300 ? body[..300] + "…" : body,
            $"/projects/{p.Id}", SendEmail: false), ct);
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
        if (TaskWorkflow.CreateStateError(r.State, p.RequireReview) is { } stateErr) val.Add("state", stateErr);
        if (val.Failed) return val.Problem();
        for (var attempt = 0; ; attempt++)
        {
            var number = (await db.Tasks.Where(t => t.ProjectId == id).MaxAsync(t => (int?)t.Number, ct) ?? 0) + 1;
            var rank = (await db.Tasks.Where(t => t.ProjectId == id && t.State == r.State).MaxAsync(t => (double?)t.Rank, ct) ?? 0) + 1;
            var t = new TaskItem
            {
                ProjectId = id, Number = number, Title = r.Title.Trim(), Description = ProjectEndpoints.Clean(r.Description), MediaLinks = TaskRules.NormalizeLinks(r.MediaLinks),
                State = r.State, Rank = rank,
                AssigneeEmployeeId = r.AssigneeEmployeeId, MilestoneId = r.MilestoneId, DueOn = r.DueOn, EstimateDays = r.EstimateDays, CreatedAt = clock.Now, CreatedByName = v.Name,
                CreatedByBot = user.IsAccessToken(), CompletedAt = r.State == TaskState.Done ? clock.Now : null,
            };
            db.Tasks.Add(t);
            var created = Activity(t, TaskActivityKind.Created, v, user, clock.Now, to: r.State.ToString());
            db.Activities.Add(created);
            try { await db.SaveChangesAsync(ct); }
            catch (DbUpdateException) when (attempt < 3) { db.Tasks.Remove(t); db.Activities.Remove(created); continue; } // hai người tạo cùng lúc → số trùng, thử số kế
            await NotifyAssignedAsync(notifier, dir, p, t, v, ct);
            return TypedResults.Created($"/api/projects/tasks/{t.Id}", t.Id);
        }
    }

    private static async Task<(TaskItem? T, Project? P)> LoadAsync(Guid tid, ProjectsDbContext db, CancellationToken ct)
    {
        var t = await db.Tasks.FirstOrDefaultAsync(x => x.Id == tid, ct);
        return t is null ? (null, null) : (t, await db.Projects.Include(p => p.Members).FirstOrDefaultAsync(p => p.Id == t.ProjectId, ct));
    }

    /// <summary>Đổi trạng thái theo quy trình + ghi lịch sử (lý do khi lùi cũng thành bình luận để cả nhóm thấy). Trả lỗi (409) nếu sai quy trình.</summary>
    private static string? ApplyState(TaskItem t, Project p, TaskState to, string? note, ProjectViewer v, ClaimsPrincipal user, ProjectsDbContext db, DateTimeOffset now)
    {
        if (t.State == to) return null;
        note = ProjectEndpoints.Clean(note);
        if (TaskWorkflow.MoveError(t.State, to, p.RequireReview, v.CanManage(p.Id), note is not null) is { } err) return err;
        db.Activities.Add(Activity(t, TaskActivityKind.Moved, v, user, now, t.State.ToString(), to.ToString(), note));
        if (note is not null)
            db.Comments.Add(new TaskComment
            {
                TaskId = t.Id, AuthorEmployeeId = v.Employee?.Id, AuthorName = v.Name, ByBot = user.IsAccessToken(), CreatedAt = now,
                Content = $"**{TaskWorkflow.Label(t.State)} → {TaskWorkflow.Label(to)}:** {note}",
            });
        t.CompletedAt = to == TaskState.Done ? now : null;
        t.State = to;
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
        var now = clock.Now;
        var from = t.State;
        if (ApplyState(t, p, r.State, r.Note, v, user, db, now) is { } stateErr) return Problems.Conflict(stateErr);
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
        if (reassigned) await NotifyAssignedAsync(notifier, dir, p, t, v, ct);
        await NotifyMovedAsync(notifier, dir, p, t, from, ProjectEndpoints.Clean(r.Note), v, ct);
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
        if (!Enum.IsDefined(r.State)) return Problems.Conflict("Trạng thái không hợp lệ");
        if (r.Note is { Length: > TaskWorkflow.MaxNote }) return Problems.Conflict($"Lý do dài quá {TaskWorkflow.MaxNote} ký tự");
        var from = t.State;
        if (ApplyState(t, p, r.State, r.Note, v, user, db, clock.Now) is { } err) return Problems.Conflict(err);
        t.Rank = r.Rank ?? (await db.Tasks.Where(x => x.ProjectId == p.Id && x.State == r.State && x.Id != t.Id).MaxAsync(x => (double?)x.Rank, ct) ?? 0) + 1;
        await db.SaveChangesAsync(ct);
        await NotifyMovedAsync(notifier, dir, p, t, from, ProjectEndpoints.Clean(r.Note), v, ct);
        return TypedResults.NoContent();
    }

    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> DeleteAsync(Guid tid, ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var (t, p) = await LoadAsync(tid, db, ct);
        if (t is null || p is null || !v.CanSee(p.Id)) return TypedResults.NotFound();
        if (!v.CanManage(p.Id) && t.CreatedByName != v.Name) return ProjectEndpoints.Forbidden("Chỉ người tạo việc hoặc quản lý dự án được xoá");
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
        var c = new TaskComment { TaskId = tid, Content = r.Content.Trim(), AuthorEmployeeId = v.Employee?.Id, AuthorName = v.Name, ByBot = user.IsAccessToken(), CreatedAt = clock.Now };
        db.Comments.Add(c);
        await db.SaveChangesAsync(ct);
        if (t.AssigneeEmployeeId is { } a && a != v.Employee?.Id && (await dir.GetAsync(a, ct))?.UserId is { } uid)
            await notifier.NotifyAsync(new NotificationRequest([uid], NotificationCategories.ProjectTask, $"{v.Name} bình luận việc {EffortRules.TaskCode(p.Code, t.Number)}",
                c.Content.Length > 200 ? c.Content[..200] + "…" : c.Content, $"/projects/{p.Id}", SendEmail: false), ct);
        return TypedResults.Created($"/api/projects/comments/{c.Id}", c.Id);
    }
}
