using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.BuildingBlocks.Storage;
using OfficeHub.Modules.Identity.Contracts;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Organization.Contracts;
using OfficeHub.Modules.Projects.Contracts;
using OfficeHub.Modules.Projects.Domain;
using OfficeHub.Modules.Projects.Infrastructure;

namespace OfficeHub.Modules.Projects.Features;

/// <param name="CreatedByBot">Tạo qua token AI / MCP (nhãn BOT).</param>
/// <param name="WaitingOn">Số việc phải chờ chưa "đủ" (0 = bắt đầu được) — đủ = đã xong hoặc ở cột "Việc sau được bắt đầu từ cột này" (TEST-199, <see cref="DependencyRules.IsReady"/>).</param>
/// <param name="Done">Đang ở cột hoàn thành.</param>
/// <param name="AwaitingHuman">Chỉ <c>/tasks/mine</c> (TEST-157): người làm là bot và đã báo, đang chờ người duyệt / trả lời (<see cref="BotWaitRules.AwaitingHuman"/>).</param>
/// <param name="ProjectActive">Chỉ <c>/tasks/mine</c> tính thật (nơi khác mặc định true): dự án đang chạy.</param>
/// <param name="FollowerCount">Số người theo dõi (TEST-160).</param>
/// <param name="MediaCount">Số link ảnh / video (TEST-240) — luôn có; bản gọn <c>?summary=true</c> để <c>Description</c> = null, <c>MediaLinks</c> rỗng.</param>
public sealed record TaskDto(Guid Id, Guid ProjectId, string Code, string Title, string? Description, Guid ColumnId, string ColumnName, string ColumnColor, bool Done, double Rank, Guid? AssigneeEmployeeId, string? AssigneeName,
    Guid? MilestoneId, DateOnly? DueOn, decimal? EstimateDays, bool Overdue, int CommentCount, DateTimeOffset CreatedAt, string CreatedByName, DateTimeOffset? CompletedAt,
    List<string> MediaLinks, string? ProjectName = null, bool CreatedByBot = false, int WaitingOn = 0,
    bool AwaitingHuman = false, bool ProjectActive = true, int FollowerCount = 0, int MediaCount = 0);
/// <summary>Việc liên quan (chờ / đang chặn) — mã, tên, đã xong chưa.</summary>
/// <param name="Ready">TEST-199: việc này "đủ" cho việc đang chờ nó (đã xong, hoặc đã tới cột "Việc sau được bắt đầu từ cột này") — <see cref="DependencyRules.IsReady"/>.</param>
public sealed record TaskRefDto(Guid Id, string Code, string Title, bool Done, bool Ready);
/// <param name="DependsOn">Mã / id các việc phải xong trước (tối đa 10, cùng dự án) — thay toàn bộ danh sách; rỗng = bỏ hết.</param>
public sealed record SetDependencies(List<Guid> DependsOn);
/// <param name="ColumnId">Cột trạng thái — tạo: bỏ trống = cột đầu; sửa: bỏ trống = giữ nguyên.</param>
/// <param name="Note">Lý do khi chuyển lùi — bắt buộc nếu dự án đi lần lượt.</param>
public sealed record UpsertTask(string Title, string? Description = null, Guid? ColumnId = null, Guid? AssigneeEmployeeId = null, Guid? MilestoneId = null,
    DateOnly? DueOn = null, decimal? EstimateDays = null, List<string>? MediaLinks = null, string? Note = null);
public sealed record MoveTask(Guid ColumnId, double? Rank = null, string? Note = null);
/// <param name="CanDelete">Người xem được xoá (chỉ chính người viết, trên web — TEST-39; dự án đã đóng vẫn xoá được — TEST-213).</param>
/// <param name="Attachments">Ảnh / tệp đính kèm (TEST-153) — link presigned cấp mỗi lần đọc.</param>
/// <param name="ViaUploadLink">Gửi qua link tải lên từ thiết bị khác (TEST-175) — nhãn "Qua link tải lên".</param>
public sealed record CommentDto(Guid Id, string Content, string AuthorName, DateTimeOffset CreatedAt, bool ByBot, bool CanDelete = false,
    List<CommentAttachmentDto>? Attachments = null, bool ViaUploadLink = false);
/// <summary>Nguồn bình luận gửi qua link tải lên (TEST-175): id link + IP / User-Agent lần tải (tra soát, không trả ra API).</summary>
internal sealed record CommentVia(Guid LinkId, string? Ip, string? UserAgent);
/// <param name="Content">Bỏ trống được khi có <paramref name="UploadIds"/>.</param>
/// <param name="UploadIds">Vé từ <c>POST /tasks/{tid}/uploads</c> (đã PUT file xong), ≤ <see cref="CommentFileRules.MaxAttachments"/>.</param>
public sealed record NewComment(string? Content, List<Guid>? UploadIds = null);
public sealed record TaskActivityDto(Guid Id, TaskActivityKind Kind, string? From, string? To, string? Note, string ActorName, bool ByBot, DateTimeOffset At);
/// <param name="Sequential">Dự án đi lần lượt (tiến từng cột, lùi phải có lý do).</param>
/// <param name="CanApprove">Người xem được chuyển việc vào / lùi ra khỏi cột cần người duyệt (quản lý dự án / HR).</param>
/// <param name="DependsOn">Việc phải xong trước việc này.</param><param name="Blocks">Việc đang chờ việc này.</param>
/// <param name="Followers">Người theo dõi việc (TEST-160).</param>
/// <param name="ColumnGuide">TEST-186: hướng dẫn của cột hiện tại của việc (null khi cột không có / không bật đánh thức bot theo dõi).</param>
public sealed record TaskDetailDto(TaskDto Task, List<CommentDto> Comments, List<TaskActivityDto> Activities, bool Sequential, bool CanApprove, List<TaskColumnDto> Columns,
    List<TaskRefDto>? DependsOn = null, List<TaskRefDto>? Blocks = null, List<TaskFollowerDto>? Followers = null, string? ColumnGuide = null);

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
        g.MapDelete("/comments/{cid:guid}", DeleteCommentAsync);
        g.MapPut("/tasks/{tid:guid}/dependencies", SetDependenciesAsync);
    }

    /// <summary>Một dòng việc đã chiếu từ DB (TEST-240): tên cột / mã dự án + đếm bình luận / theo dõi / việc còn chờ trong CÙNG truy vấn (subquery).</summary>
    private sealed record TaskRow(Guid Id, Guid ProjectId, string ProjectCode, string ProjectName, int Number, string Title, string? Description, Guid ColumnId,
        string? ColumnName, string? ColumnColor, double Rank, Guid? AssigneeEmployeeId, Guid? MilestoneId, DateOnly? DueOn, decimal? EstimateDays,
        DateTimeOffset CreatedAt, string CreatedByName, DateTimeOffset? CompletedAt, List<string>? MediaLinks, int MediaCount, bool CreatedByBot,
        int CommentCount, int FollowerCount, int WaitingOn);

    /// <summary>
    /// Chiếu <paramref name="tasks"/> (đã lọc + sắp xếp) sang <see cref="TaskDto"/> — TEST-240: 1 truy vấn cột "đủ" của các dự án liên quan + 1 truy vấn việc gộp
    /// (projection, subquery Count) + 1 tra tên người làm theo id. <paramref name="summary"/> = true (danh sách web): không đọc Description / MediaLinks, chỉ MediaCount.
    /// </summary>
    private static async Task<List<TaskDto>> ToDtosAsync(IQueryable<TaskItem> tasks, IReadOnlyCollection<Guid> projectIds, ProjectsDbContext db, ProjectAccess access,
        ProjectClock clock, CancellationToken ct, bool withProject = false, bool summary = false)
    {
        var ready = await db.UnblockingColumnIdsAsync(ct, projectIds);
        var rows = await tasks.Select(t => new TaskRow(t.Id, t.ProjectId,
                db.Projects.Where(p => p.Id == t.ProjectId).Select(p => p.Code).First(),
                db.Projects.Where(p => p.Id == t.ProjectId).Select(p => p.Name).First(),
                t.Number, t.Title, summary ? null : t.Description, t.ColumnId,
                db.Columns.Where(c => c.Id == t.ColumnId).Select(c => c.Name).FirstOrDefault(),
                db.Columns.Where(c => c.Id == t.ColumnId).Select(c => c.Color).FirstOrDefault(),
                t.Rank, t.AssigneeEmployeeId, t.MilestoneId, t.DueOn, t.EstimateDays, t.CreatedAt, t.CreatedByName, t.CompletedAt,
                summary ? null : t.MediaLinks, t.MediaLinks.Count, t.CreatedByBot,
                db.Comments.Count(c => c.TaskId == t.Id),
                db.Followers.Count(f => f.TaskId == t.Id),
                (from d in db.Dependencies
                 join x in db.Tasks on d.DependsOnId equals x.Id
                 where d.TaskId == t.Id && x.CompletedAt == null && !ready.Contains(x.ColumnId)
                 select d.TaskId).Count()))
            .AsNoTracking().ToListAsync(ct);
        var emps = await access.EmployeesByIdAsync(rows.Where(t => t.AssigneeEmployeeId != null).Select(t => t.AssigneeEmployeeId!.Value).Distinct().ToList(), ct);
        var today = clock.Today;
        return rows.Select(t => new TaskDto(t.Id, t.ProjectId, EffortRules.TaskCode(t.ProjectCode, t.Number), t.Title, t.Description, t.ColumnId,
            t.ColumnName ?? "?", t.ColumnColor ?? TaskColumnRules.DefaultColor, t.CompletedAt != null, t.Rank,
            t.AssigneeEmployeeId, t.AssigneeEmployeeId is { } a && emps.TryGetValue(a, out var e) ? e.FullName : null, t.MilestoneId, t.DueOn, t.EstimateDays,
            EffortRules.IsOverdue(t.DueOn, t.CompletedAt != null, today), t.CommentCount, t.CreatedAt, t.CreatedByName, t.CompletedAt, t.MediaLinks ?? [],
            withProject ? t.ProjectName : null, t.CreatedByBot, t.WaitingOn,
            FollowerCount: t.FollowerCount, MediaCount: t.MediaCount)).ToList();
    }

    /// <summary>
    /// Việc của một dự án. <paramref name="summary"/> = true (web: kanban / danh sách, TEST-240): bỏ <c>description</c> / <c>mediaLinks</c> (chỉ <c>mediaCount</c>) —
    /// hộp thoại việc lấy chi tiết riêng qua <c>GET /tasks/{tid}</c>. Mặc định false giữ nguyên cho MCP (list_project_tasks, create_task).
    /// </summary>
    private static async Task<Results<Ok<List<TaskDto>>, NotFound>> ListAsync(Guid id, ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access, ProjectClock clock,
        CancellationToken ct, bool summary = false)
    {
        var v = await access.ViewerAsync(user, ct);
        if (!v.CanSee(id)) return TypedResults.NotFound();
        var dtos = await ToDtosAsync(db.Tasks.Where(t => t.ProjectId == id).OrderBy(t => t.Rank).ThenBy(t => t.Number), [id], db, access, clock, ct, summary: summary);
        // Dự án chưa có việc: chỉ lúc này mới kiểm tra dự án có tồn tại (dự án có việc thì chắc chắn tồn tại).
        if (dtos.Count == 0 && !await db.Projects.AnyAsync(p => p.Id == id, ct)) return TypedResults.NotFound();
        return TypedResults.Ok(dtos);
    }

    /// <summary>Việc chưa xong được giao cho tôi, ở mọi dự án. Thêm <c>awaitingHuman</c> + <c>projectActive</c> để agent-runner bỏ qua việc
    /// đang chờ người / dự án đã đóng khi bắt bù lúc khởi động (TEST-157) — tính theo lô, chỉ ở đây.</summary>
    private static async Task<Ok<List<TaskDto>>> MineAsync(ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access, ProjectClock clock,
        IAccountService accounts, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        if (v.Employee is null) return TypedResults.Ok(new List<TaskDto>());
        var me = v.Employee.Id;
        var mine = db.Tasks.Where(t => t.AssigneeEmployeeId == me && t.CompletedAt == null);
        var projectIds = await mine.Select(t => t.ProjectId).Distinct().ToListAsync(ct);
        if (projectIds.Count == 0) return TypedResults.Ok(new List<TaskDto>());
        var dtos = await ToDtosAsync(mine.OrderBy(t => t.DueOn == null).ThenBy(t => t.DueOn).ThenBy(t => t.Id).Take(200), projectIds, db, access, clock, ct,
            withProject: true);
        var active = (await db.Projects.AsNoTracking().Where(p => projectIds.Contains(p.Id) && p.Status == ProjectStatus.Active).Select(p => p.Id).ToListAsync(ct))
            .ToHashSet();
        var isBot = (await accounts.GetAsync(v.UserId, ct))?.IsBot ?? false;
        var events = isBot ? await db.WaitEventsAsync(dtos.Select(t => t.Id).ToList(), ct) : null;
        return TypedResults.Ok(dtos.Select(d => d with
        {
            AwaitingHuman = events is not null && BotWaitRules.AwaitingHuman(events[d.Id], me, isBot),
            ProjectActive = active.Contains(d.ProjectId),
        }).ToList());
    }

    /// <summary>
    /// Một việc + bình luận + lịch sử (hộp thoại việc trên web, tool MCP get_task). <paramref name="comments"/> = false (web, TEST-194):
    /// bỏ tải bình luận (trả danh sách rỗng) vì web tải riêng qua <c>GET /tasks/{tid}/comments</c>; mặc định giữ nguyên cho MCP.
    /// </summary>
    private static async Task<Results<Ok<TaskDetailDto>, NotFound>> DetailAsync(Guid tid, ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access, ProjectClock clock,
        IFileStorage files, IAccountService accounts, CancellationToken ct, bool comments = true)
    {
        var v = await access.ViewerAsync(user, ct);
        var t = await db.Tasks.AsNoTracking().FirstOrDefaultAsync(x => x.Id == tid, ct);
        if (t is null || !v.CanSee(t.ProjectId)) return TypedResults.NotFound();
        var proj = await db.Projects.Where(p => p.Id == t.ProjectId).Select(p => new { p.Sequential, p.Status }).FirstAsync(ct);
        var sequential = proj.Sequential;
        var dto = (await ToDtosAsync(db.Tasks.Where(x => x.Id == tid), [t.ProjectId], db, access, clock, ct, withProject: true))[0];
        var commentList = comments ? await CommentListAsync(db, files, tid, CommentDeleter(v, user), ct) : [];
        var activities = await db.Activities.AsNoTracking().Where(a => a.TaskId == tid).OrderBy(a => a.At)
            .Select(a => new TaskActivityDto(a.Id, a.Kind, a.From, a.To, a.Note, a.ActorName, a.ByBot, a.At)).ToListAsync(ct);
        var code = dto.Code[..dto.Code.LastIndexOf('-')];
        var ready = await db.UnblockingColumnIdsAsync(ct, [t.ProjectId]);
        var dependsOn = await (from d in db.Dependencies.AsNoTracking() join x in db.Tasks.AsNoTracking() on d.DependsOnId equals x.Id
                               where d.TaskId == tid orderby x.Number
                               select new { x.Id, x.Number, x.Title, Done = x.CompletedAt != null, Ready = x.CompletedAt != null || ready.Contains(x.ColumnId) }).ToListAsync(ct);
        var blocks = await (from d in db.Dependencies.AsNoTracking() join x in db.Tasks.AsNoTracking() on d.TaskId equals x.Id
                            where d.DependsOnId == tid orderby x.Number
                            select new { x.Id, x.Number, x.Title, Done = x.CompletedAt != null, Ready = x.CompletedAt != null || ready.Contains(x.ColumnId) }).ToListAsync(ct);
        var columns = await TaskColumnEndpoints.ListForAsync(db, t.ProjectId, ct);
        var current = columns.FirstOrDefault(c => c.Id == t.ColumnId);
        return TypedResults.Ok(new TaskDetailDto(dto, commentList, activities, sequential, CanApprove(v, user, t.ProjectId),
            columns,
            dependsOn.Select(x => new TaskRefDto(x.Id, EffortRules.TaskCode(code, x.Number), x.Title, x.Done, x.Ready)).ToList(),
            blocks.Select(x => new TaskRefDto(x.Id, EffortRules.TaskCode(code, x.Number), x.Title, x.Done, x.Ready)).ToList(),
            await TaskFollowerEndpoints.ListAsync(db, access, accounts, tid, ct),
            current is { HasGuide: true } ? current.Guide : null));
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

    internal static TaskActivity Activity(TaskItem t, TaskActivityKind kind, ProjectViewer v, ClaimsPrincipal user, DateTimeOffset now,
        string? from = null, string? to = null, string? note = null) =>
        new() { TaskId = t.Id, Kind = kind, From = Cut(from), To = Cut(to), Note = note, ActorEmployeeId = v.Employee?.Id, ActorName = v.Name, ByBot = user.IsAccessToken(), At = now };

    private static string? Cut(string? s) => s is { Length: > 200 } ? s[..200] : s;

    private static async Task<string?> NameOfAsync(ProjectAccess access, Guid? employeeId, CancellationToken ct) =>
        employeeId is { } id ? (await access.EmployeesAsync(ct)).TryGetValue(id, out var e) ? e.FullName : "(không rõ)" : null;

    private static async Task<Guid?> UserOfAsync(IEmployeeDirectory dir, Guid? employeeId, CancellationToken ct) =>
        employeeId is { } id ? (await dir.GetAsync(id, ct))?.UserId : null;

    /// <returns>Tài khoản đã nhận chuông (null = không gửi).</returns>
    private static async Task<Guid?> NotifyAssignedAsync(INotifier notifier, IEmployeeDirectory dir, ITelegramWakeup telegram, Project p, TaskItem t, ProjectViewer v,
        CancellationToken ct)
    {
        if (t.AssigneeEmployeeId is not { } a || a == v.Employee?.Id) return null;
        if (await dir.GetAsync(a, ct) is not { UserId: { } uid } emp) return null;
        // TEST-42: tài khoản bot có bot Telegram → một tin đánh thức vào nhóm (Notification tự kiểm tra kênh bật / IsBot / username).
        if (ClosedProjectRules.WakesBots(p.Status == ProjectStatus.Active)) await telegram.TaskAssignedAsync(uid, emp.Code, p.Id, t.Id, EffortRules.TaskCode(p.Code, t.Number), ct);
        await notifier.NotifyAsync(new NotificationRequest([uid], NotificationCategories.ProjectTask, $"Bạn được giao việc {EffortRules.TaskCode(p.Code, t.Number)}: {t.Title}",
            $"{v.Name} giao trong dự án {p.Name}{(t.DueOn is { } d ? $", hạn {d:dd/MM/yyyy}" : "")}.", NotificationTarget.ProjectTask(p.Id, t.Id), SendEmail: false), ct);
        return uid;
    }

    /// <summary>Chuông chung cho mọi thành viên dự án, trừ người thao tác và <paramref name="alreadyNotified"/> (<see cref="TaskNotifyRules"/>).</summary>
    private static async Task NotifyMembersAsync(INotifier notifier, ProjectAccess access, Project p, ProjectViewer v, IEnumerable<Guid> alreadyNotified,
        string title, string body, NotificationTarget target, CancellationToken ct)
    {
        var emps = await access.EmployeesAsync(ct);
        var to = TaskNotifyRules.Recipients(
            p.Members.Select(m => emps.TryGetValue(m.EmployeeId, out var e) ? (e.UserId, e.IsActive) : ((Guid?)null, false)), v.UserId, alreadyNotified);
        if (to.Count == 0) return;
        await notifier.NotifyAsync(new NotificationRequest(to, NotificationCategories.ProjectTask, title, TaskNotifyRules.Body(body), target, SendEmail: false), ct);
    }

    private static Task NotifyMembersMovedAsync(INotifier notifier, ProjectAccess access, Project p, TaskItem t, List<ColumnInfo> cols, Guid from, string? note,
        ProjectViewer v, IEnumerable<Guid> alreadyNotified, CancellationToken ct)
    {
        if (from == t.ColumnId) return Task.CompletedTask;
        string Name(Guid id) => cols.FirstOrDefault(c => c.Id == id)?.Name ?? "?";
        return NotifyMembersAsync(notifier, access, p, v, alreadyNotified, $"{v.Name} chuyển {EffortRules.TaskCode(p.Code, t.Number)} sang \"{Name(t.ColumnId)}\"",
            $"{t.Title} ({Name(from)} → {Name(t.ColumnId)}), dự án {p.Name}.{(note is null ? "" : $" Lý do: {note}")}", NotificationTarget.ProjectTask(p.Id, t.Id), ct);
    }

    /// <summary>
    /// Báo theo quy trình (<see cref="TaskWorkflow.Notice"/>): vào cột ngay trước cột cần duyệt → quản lý dự án; vào cột cần duyệt → người làm (đã duyệt);
    /// lùi kèm lý do → người làm. Bỏ chính người thao tác.
    /// </summary>
    /// <returns>Tài khoản đã nhận chuông.</returns>
    private static async Task<List<Guid>> NotifyMovedAsync(INotifier notifier, IEmployeeDirectory dir, ITelegramWakeup telegram, Project p, TaskItem t, List<ColumnInfo> cols, Guid from, string? note,
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
            // Trả lại việc (lùi kèm lý do) cho bot → đánh thức lại qua Telegram (cùng tin JSON; runner kiểm tra lại việc qua MCP).
            if (kind != MoveNotice.Approved && ClosedProjectRules.WakesBots(p.Status == ProjectStatus.Active)) await telegram.TaskReturnedAsync(u, (await dir.GetAsync(t.AssigneeEmployeeId!.Value, ct))!.Code, p.Id, t.Id, code, ct);
            (title, body) = kind == MoveNotice.Approved
                ? ($"Đã duyệt: {code} {t.Title}", $"{v.Name} chuyển sang \"{Name(t.ColumnId)}\" trong dự án {p.Name}.")
                : ($"Trả lại việc: {code} {t.Title}", $"{v.Name} ({Name(from)} → {Name(t.ColumnId)}): {note}");
        }
        else return [];
        if (to.Count == 0) return [];
        await notifier.NotifyAsync(new NotificationRequest(to, NotificationCategories.ProjectTask, title, TaskNotifyRules.Body(body),
            NotificationTarget.ProjectTask(p.Id, t.Id), SendEmail: false), ct);
        return to;
    }

    private static async Task<Results<Created<Guid>, NotFound, ValidationProblem, ProblemHttpResult>> CreateAsync(Guid id, UpsertTask r, ClaimsPrincipal user,
        ProjectsDbContext db, ProjectAccess access, IEmployeeDirectory dir, INotifier notifier, ITelegramWakeup telegram, ProjectClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var p = await db.Projects.AsNoTracking().Include(x => x.Members).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p is null || !v.CanSee(id)) return TypedResults.NotFound();
        if (!v.CanWork(id)) return ProjectEndpoints.Forbidden("Chỉ thành viên dự án được tạo việc");
        if (v.ClosedError(p.Id, p.Status == ProjectStatus.Active) is { } closed) return Problems.Conflict(closed); // TEST-213: dự án đóng → chỉ quản lý dự án / HR
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
            var assigned = await NotifyAssignedAsync(notifier, dir, telegram, p, t, v, ct);
            await NotifyMembersAsync(notifier, access, p, v, assigned is { } au ? [au] : [], $"Việc mới {EffortRules.TaskCode(p.Code, t.Number)}: {t.Title}",
                $"{v.Name} tạo trong dự án {p.Name} (\"{column.Name}\").", NotificationTarget.ProjectTask(p.Id, t.Id), ct);
            return TypedResults.Created($"/api/projects/tasks/{t.Id}", t.Id);
        }
    }

    internal static async Task<(TaskItem? T, Project? P)> LoadAsync(Guid tid, ProjectsDbContext db, CancellationToken ct)
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

    internal static async Task<Results<NoContent, NotFound, ValidationProblem, ProblemHttpResult>> UpdateAsync(Guid tid, UpsertTask r, ClaimsPrincipal user, ProjectsDbContext db,
        ProjectAccess access, IEmployeeDirectory dir, INotifier notifier, ITelegramWakeup telegram, IWebhookPublisher webhooks, IAccountService accounts, ProjectClock clock,
        BotStreakGuard streak, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var (t, p) = await LoadAsync(tid, db, ct);
        if (t is null || p is null || !v.CanSee(p.Id)) return TypedResults.NotFound();
        if (!v.CanWork(p.Id)) return ProjectEndpoints.Forbidden("Chỉ thành viên dự án được sửa việc");
        if (v.ClosedError(p.Id, p.Status == ProjectStatus.Active) is { } closed) return Problems.Conflict(closed); // TEST-213: dự án đóng → chỉ quản lý dự án / HR
        var val = await ValidateAsync(r, p, db, clock.Today, t.DueOn, ct);
        if (val.Failed) return val.Problem();
        var changesFlow = (r.ColumnId is { } nc && nc != t.ColumnId) || r.AssigneeEmployeeId != t.AssigneeEmployeeId;
        if (changesFlow && await streak.ErrorAsync(user.IsAccessToken(), t, p, v, ct) is { } streakErr) return Problems.Conflict(streakErr);
        var now = clock.Now;
        var from = t.ColumnId;
        var cols = TaskColumnEndpoints.Infos(await TaskColumnEndpoints.LoadAsync(db, p.Id, ct));
        var readyCols = DependencyRules.ReadyColumnIds(cols, p.Sequential);
        var wasReady = DependencyRules.IsReady(t.CompletedAt != null, t.ColumnId, readyCols);
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
        if (reassigned && await NotifyAssignedAsync(notifier, dir, telegram, p, t, v, ct) is { } au) notified.Add(au);
        var note = ProjectEndpoints.Clean(r.Note);
        notified.AddRange(await NotifyMovedAsync(notifier, dir, telegram, p, t, cols, from, note, v, ct));
        await NotifyMembersMovedAsync(notifier, access, p, t, cols, from, note, v, notified, ct);
        await NotifyReadinessChangedAsync(notifier, dir, telegram, db, p, t, cols, wasReady, DependencyRules.IsReady(t.CompletedAt != null, t.ColumnId, readyCols), v, ct);
        if (FollowerWakeRules.ShouldWake(cols, from, t.ColumnId))
            await WakeFollowersAsync(dir, telegram, webhooks, accounts, access, db, p, t, cols, v, user, ct);
        if (ClosedTaskWakeRules.ShouldWake(cols, from, t.ColumnId))
            await WakeClosedAsync(telegram, accounts, access, db, p, t, ct);
        return TypedResults.NoContent();
    }

    internal static async Task<Results<NoContent, NotFound, ProblemHttpResult>> MoveAsync(Guid tid, MoveTask r, ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access,
        IEmployeeDirectory dir, INotifier notifier, ITelegramWakeup telegram, IWebhookPublisher webhooks, IAccountService accounts, ProjectClock clock, BotStreakGuard streak,
        CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var (t, p) = await LoadAsync(tid, db, ct);
        if (t is null || p is null || !v.CanSee(p.Id)) return TypedResults.NotFound();
        if (!v.CanWork(p.Id)) return ProjectEndpoints.Forbidden("Chỉ thành viên dự án được chuyển việc");
        if (v.ClosedError(p.Id, p.Status == ProjectStatus.Active) is { } closed) return Problems.Conflict(closed); // TEST-213: dự án đóng → chỉ quản lý dự án / HR
        if (r.Note is { Length: > TaskWorkflow.MaxNote }) return Problems.Conflict($"Lý do dài quá {TaskWorkflow.MaxNote} ký tự");
        var cols = TaskColumnEndpoints.Infos(await TaskColumnEndpoints.LoadAsync(db, p.Id, ct));
        if (cols.All(c => c.Id != r.ColumnId)) return Problems.Conflict("Trạng thái không thuộc dự án");
        var from = t.ColumnId;
        var readyCols = DependencyRules.ReadyColumnIds(cols, p.Sequential);
        var wasReady = DependencyRules.IsReady(t.CompletedAt != null, t.ColumnId, readyCols);
        if (r.ColumnId != t.ColumnId && await streak.ErrorAsync(user.IsAccessToken(), t, p, v, ct) is { } streakErr) return Problems.Conflict(streakErr);
        if (await StartErrorAsync(user, t, cols, r.ColumnId, db, ct) is { } startErr) return Problems.Conflict(startErr);
        if (ApplyColumn(t, p, cols, r.ColumnId, r.Note, v, user, db, clock.Now) is { } err) return Problems.Conflict(err);
        t.Rank = r.Rank ?? (await db.Tasks.Where(x => x.ColumnId == r.ColumnId && x.Id != t.Id).MaxAsync(x => (double?)x.Rank, ct) ?? 0) + 1;
        await db.SaveChangesAsync(ct);
        var note = ProjectEndpoints.Clean(r.Note);
        var notified = await NotifyMovedAsync(notifier, dir, telegram, p, t, cols, from, note, v, ct);
        await NotifyMembersMovedAsync(notifier, access, p, t, cols, from, note, v, notified, ct);
        await NotifyReadinessChangedAsync(notifier, dir, telegram, db, p, t, cols, wasReady, DependencyRules.IsReady(t.CompletedAt != null, t.ColumnId, readyCols), v, ct);
        if (FollowerWakeRules.ShouldWake(cols, from, t.ColumnId))
            await WakeFollowersAsync(dir, telegram, webhooks, accounts, access, db, p, t, cols, v, user, ct);
        if (ClosedTaskWakeRules.ShouldWake(cols, from, t.ColumnId))
            await WakeClosedAsync(telegram, accounts, access, db, p, t, ct);
        return TypedResults.NoContent();
    }

    /// <summary>Bot đưa việc còn chờ ra khỏi cột đầu → lỗi (<see cref="DependencyRules.StartError"/>).</summary>
    private static async Task<string?> StartErrorAsync(ClaimsPrincipal user, TaskItem t, List<ColumnInfo> cols, Guid to, ProjectsDbContext db, CancellationToken ct)
    {
        if (!user.IsAccessToken() || cols.Count == 0 || t.ColumnId != cols[0].Id || to == t.ColumnId) return null;
        var ready = await db.UnblockingColumnIdsAsync(ct);
        var unfinished = await (from d in db.Dependencies join x in db.Tasks on d.DependsOnId equals x.Id
                                where d.TaskId == t.Id && x.CompletedAt == null && !ready.Contains(x.ColumnId) select d).CountAsync(ct);
        return DependencyRules.StartError(unfinished, leavingFirstColumn: true, byBot: true);
    }

    /// <summary>
    /// TEST-199: việc <paramref name="t"/> vừa đổi cột (đã lưu). Chuyển từ chưa "đủ" sang "đủ" (<see cref="DependencyRules.IsReady"/> — tới cột hoàn thành hoặc cột
    /// "Việc sau được bắt đầu từ cột này") → các việc đang chờ nó mà nay hết chờ: báo "Sẵn sàng" (<see cref="NotifyReadyAsync"/>). Đi tiếp trong vùng "đủ" (vd Deploy → Xong)
    /// không báo lại. Bị kéo lùi ra khỏi vùng "đủ" → việc đang chờ đã bắt đầu thì chỉ chuông người làm kiểm tra lại đầu vào (<see cref="NotifyRegressedAsync"/>).
    /// </summary>
    private static async Task NotifyReadinessChangedAsync(INotifier notifier, IEmployeeDirectory dir, ITelegramWakeup telegram, ProjectsDbContext db, Project p, TaskItem t,
        List<ColumnInfo> cols, bool wasReady, bool isReady, ProjectViewer v, CancellationToken ct)
    {
        if (wasReady == isReady) return;
        var column = cols.FirstOrDefault(c => c.Id == t.ColumnId)?.Name ?? "?";
        if (isReady) await NotifyUnblockedAsync(notifier, dir, telegram, db, p, t, t.CompletedAt != null ? "đã xong" : $"đã tới \"{column}\"", v, ct);
        else await NotifyRegressedAsync(notifier, dir, db, p, t, cols, column, v, ct);
    }

    /// <summary>
    /// <paramref name="done"/> vừa "đủ" → các việc đang chờ nó mà nay đã hết chờ: báo người làm (chưa giao → quản lý dự án).
    /// Chuông + webhook → agent được giao tự bắt đầu, không cần ai điều phối.
    /// </summary>
    private static async Task NotifyUnblockedAsync(INotifier notifier, IEmployeeDirectory dir, ITelegramWakeup telegram, ProjectsDbContext db, Project p, TaskItem done,
        string what, ProjectViewer v, CancellationToken ct)
    {
        var ready = await db.UnblockingColumnIdsAsync(ct);
        var dependents = await (from d in db.Dependencies.AsNoTracking() join x in db.Tasks.AsNoTracking() on d.TaskId equals x.Id
                                where d.DependsOnId == done.Id && x.CompletedAt == null select x).ToListAsync(ct);
        foreach (var x in dependents)
        {
            var stillWaiting = await (from d in db.Dependencies.AsNoTracking() join y in db.Tasks.AsNoTracking() on d.DependsOnId equals y.Id
                                      where d.TaskId == x.Id && y.CompletedAt == null && !ready.Contains(y.ColumnId) select d).AnyAsync(ct);
            if (stillWaiting) continue;
            await NotifyReadyAsync(notifier, dir, telegram, p, x, $"{EffortRules.TaskCode(p.Code, done.Number)} \"{done.Title}\" {what}", v, ct);
        }
    }

    /// <summary>
    /// TEST-199: <paramref name="back"/> bị kéo lùi khỏi vùng "đủ" → việc đang chờ nó còn ở cột đầu tự bị chặn lại (<c>waitingOn</c> tăng, không báo); việc đã rời cột đầu
    /// (<see cref="DependencyRules.ShouldWarnRegressed"/>) không dừng, chỉ chuông người làm kiểm tra lại đầu vào. Không Telegram (không đánh thức bot làm lại).
    /// </summary>
    private static async Task NotifyRegressedAsync(INotifier notifier, IEmployeeDirectory dir, ProjectsDbContext db, Project p, TaskItem back, List<ColumnInfo> cols,
        string column, ProjectViewer v, CancellationToken ct)
    {
        var firstColumn = cols.Count > 0 ? cols[0].Id : Guid.Empty;
        var dependents = await (from d in db.Dependencies.AsNoTracking() join x in db.Tasks.AsNoTracking() on d.TaskId equals x.Id
                                where d.DependsOnId == back.Id select x).ToListAsync(ct);
        var backCode = EffortRules.TaskCode(p.Code, back.Number);
        foreach (var x in dependents.Where(x => DependencyRules.ShouldWarnRegressed(x.CompletedAt != null, x.ColumnId == firstColumn)))
        {
            if (x.AssigneeEmployeeId is not { } a || await UserOfAsync(dir, a, ct) is not { } u || u == v.UserId) continue;
            await notifier.NotifyAsync(new NotificationRequest([u], NotificationCategories.ProjectTask,
                $"Việc trước bị kéo lùi: {EffortRules.TaskCode(p.Code, x.Number)} {x.Title}",
                $"{backCode} \"{back.Title}\" bị kéo lùi về \"{column}\" — kiểm tra lại đầu vào của việc này.", NotificationTarget.ProjectTask(p.Id, x.Id), SendEmail: false), ct);
        }
    }

    /// <summary>
    /// Một việc vừa hết phải chờ (<see cref="DependencyRules.BecameReady"/>) — dùng chung cho 3 đường: việc trước xong, sửa danh sách việc phải chờ,
    /// xoá việc đứng trước (TEST-198). Chuông "Sẵn sàng" cho người làm (chưa giao → quản lý dự án) + Telegram <c>ready</c> cho người làm; bỏ người thao tác.
    /// </summary>
    private static async Task NotifyReadyAsync(INotifier notifier, IEmployeeDirectory dir, ITelegramWakeup telegram, Project p, TaskItem x, string reason,
        ProjectViewer v, CancellationToken ct)
    {
        var to = new List<Guid>();
        if (x.AssigneeEmployeeId is { } a)
        {
            if (await dir.GetAsync(a, ct) is { UserId: { } u } emp)
            {
                to.Add(u);
                // TEST-86: đánh thức bot làm việc này qua Telegram (runner chỉ nghe Telegram). Việc chưa giao → không gửi.
                if (u != v.UserId && ClosedProjectRules.WakesBots(p.Status == ProjectStatus.Active)) await telegram.TaskReadyAsync(u, emp.Code, p.Id, x.Id, EffortRules.TaskCode(p.Code, x.Number), ct);
            }
        }
        else
            foreach (var m in p.Members.Where(m => m.Role == ProjectMemberRole.Manager))
                if (await UserOfAsync(dir, m.EmployeeId, ct) is { } u) to.Add(u);
        to.Remove(v.UserId);
        if (to.Count == 0) return;
        await notifier.NotifyAsync(new NotificationRequest(to, NotificationCategories.ProjectTask,
            $"Sẵn sàng: {EffortRules.TaskCode(p.Code, x.Number)} {x.Title}",
            $"{reason} — việc này hết phải chờ, có thể bắt đầu.", NotificationTarget.ProjectTask(p.Id, x.Id), SendEmail: false), ct);
    }

    /// <summary>
    /// TEST-178: việc vừa vào cột "Đánh thức bot theo dõi" (<see cref="FollowerWakeRules.ShouldWake"/>) → mỗi bot đang theo dõi việc (bỏ người thao tác;
    /// cột có chọn bot — TEST-184 — thì chỉ bot được chọn, còn là thành viên dự án)
    /// nhận Telegram <c>column_entered</c> + webhook <see cref="WebhookEvents.TaskColumnEntered"/>; bot tự đọc hướng dẫn chức vụ + workGuide để biết
    /// ở cột này mình có việc không. Người theo dõi là người thật không có chuông riêng (đã có chuông hoạt động chung của thành viên).
    /// </summary>
    private static async Task WakeFollowersAsync(IEmployeeDirectory dir, ITelegramWakeup telegram, IWebhookPublisher webhooks, IAccountService accounts,
        ProjectAccess access, ProjectsDbContext db, Project p, TaskItem t, List<ColumnInfo> cols, ProjectViewer v, ClaimsPrincipal user, CancellationToken ct)
    {
        if (!ClosedProjectRules.WakesBots(p.Status == ProjectStatus.Active)) return; // TEST-213: dự án đã đóng không đánh thức bot
        var ids = await db.Followers.AsNoTracking().Where(f => f.TaskId == t.Id).Select(f => f.EmployeeId).ToListAsync(ct);
        if (ids.Count == 0) return;
        var emps = await access.EmployeesAsync(ct);
        var byUser = ids.Select(i => emps.TryGetValue(i, out var e) ? e : null).OfType<EmployeeRef>().Where(e => e.UserId != null)
            .GroupBy(e => e.UserId!.Value).ToDictionary(g => g.Key, g => g.First());
        if (byUser.Count == 0) return;
        var accs = await accounts.GetManyAsync(byUser.Keys.ToList(), ct);
        // TEST-184: cột có chọn bot → chỉ bot được chọn còn là thành viên dự án (đã rời dự án → không đánh thức, không quay về "tất cả").
        var chosen = cols.FirstOrDefault(c => c.Id == t.ColumnId)?.WakeBotIds ?? [];
        if (chosen.Count > 0)
        {
            var members = await db.Members.AsNoTracking().Where(m => m.ProjectId == p.Id && chosen.Contains(m.EmployeeId)).Select(m => m.EmployeeId).ToListAsync(ct);
            if (members.Count == 0) return;
            chosen = members;
        }
        var targets = FollowerWakeRules.BotTargets(byUser.Select(kv => accs.TryGetValue(kv.Key, out var a)
            ? new FollowerWakeRules.Follower(kv.Key, a.IsBot, a.IsActive, kv.Value.Id) : new FollowerWakeRules.Follower(kv.Key, false, false, kv.Value.Id)), v.UserId, chosen);
        if (targets.Count == 0) return;
        var code = EffortRules.TaskCode(p.Code, t.Number);
        var column = cols.FirstOrDefault(c => c.Id == t.ColumnId)?.Name ?? "?";
        var assignee = t.AssigneeEmployeeId is { } a ? await dir.GetAsync(a, ct) : null;
        foreach (var u in targets)
            await telegram.TaskColumnEnteredAsync(u, byUser[u].Code, p.Id, t.Id, code, t.ColumnId, assignee?.Code, ct);
        await webhooks.PublishAsync(targets, WebhookEvents.TaskColumnEntered, new
        {
            taskId = t.Id, taskCode = code, title = t.Title, projectId = p.Id, projectCode = p.Code, projectName = p.Name, columnId = t.ColumnId, column,
            assigneeEmployeeId = t.AssigneeEmployeeId, assigneeCode = assignee?.Code, assigneeName = assignee?.FullName, movedBy = v.Name, movedByBot = user.IsAccessToken(),
        }, ct);
    }

    /// <summary>
    /// TEST-247: việc vừa sang hoàn thành (<see cref="ClosedTaskWakeRules.ShouldWake"/>) → người làm + người theo dõi là bot nhận Telegram <c>task_closed</c>:
    /// bộ điều phối trên máy agent dọn worktree / transcript của việc ngay. Không chuông, không webhook; gửi cả người vừa chuyển, cả dự án đã đóng.
    /// </summary>
    private static async Task WakeClosedAsync(ITelegramWakeup telegram, IAccountService accounts, ProjectAccess access, ProjectsDbContext db, Project p, TaskItem t,
        CancellationToken ct)
    {
        var ids = await db.Followers.AsNoTracking().Where(f => f.TaskId == t.Id).Select(f => f.EmployeeId).ToListAsync(ct);
        if (t.AssigneeEmployeeId is { } a) ids.Add(a);
        if (ids.Count == 0) return;
        var emps = await access.EmployeesAsync(ct);
        var byUser = ids.Distinct().Select(i => emps.TryGetValue(i, out var e) ? e : null).OfType<EmployeeRef>().Where(e => e.UserId != null)
            .GroupBy(e => e.UserId!.Value).ToDictionary(g => g.Key, g => g.First());
        if (byUser.Count == 0) return;
        var accs = await accounts.GetManyAsync(byUser.Keys.ToList(), ct);
        var targets = ClosedTaskWakeRules.BotTargets(byUser.Select(kv => accs.TryGetValue(kv.Key, out var acc)
            ? new FollowerWakeRules.Follower(kv.Key, acc.IsBot, acc.IsActive, kv.Value.Id) : new FollowerWakeRules.Follower(kv.Key, false, false, kv.Value.Id)));
        var code = EffortRules.TaskCode(p.Code, t.Number);
        foreach (var u in targets) await telegram.TaskClosedAsync(u, byUser[u].Code, p.Id, t.Id, code, ct);
    }

    /// <summary>Đặt danh sách việc phải chờ (thay toàn bộ). Thành viên (dự án đã đóng: quản lý dự án / HR trên web — TEST-213); cùng dự án, không vòng, ≤ 10.</summary>
    private static async Task<Results<NoContent, NotFound, ValidationProblem, ProblemHttpResult>> SetDependenciesAsync(Guid tid, SetDependencies r, ClaimsPrincipal user,
        ProjectsDbContext db, ProjectAccess access, ProjectClock clock, BotStreakGuard streak, IEmployeeDirectory dir, INotifier notifier, ITelegramWakeup telegram,
        CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var (t, p) = await LoadAsync(tid, db, ct);
        if (t is null || p is null || !v.CanSee(p.Id)) return TypedResults.NotFound();
        if (!v.CanWork(p.Id)) return ProjectEndpoints.Forbidden("Chỉ thành viên dự án được sửa việc phải chờ");
        if (v.ClosedError(p.Id, p.Status == ProjectStatus.Active) is { } closed) return Problems.Conflict(closed); // TEST-213: dự án đóng → chỉ quản lý dự án / HR
        if (await streak.ErrorAsync(user.IsAccessToken(), t, p, v, ct) is { } streakErr) return Problems.Conflict(streakErr);
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
        // TEST-198: bỏ hết việc chưa "đủ" (TEST-199) khỏi danh sách → việc hết chờ, báo "Sẵn sàng" như khi việc trước xong
        var all = before.Concat(wanted).ToList();
        var readyCols = await db.UnblockingColumnIdsAsync(ct);
        var unfinished = (await db.Tasks.AsNoTracking().Where(x => all.Contains(x.Id) && x.CompletedAt == null && !readyCols.Contains(x.ColumnId))
            .Select(x => x.Id).ToListAsync(ct)).ToHashSet();
        var ready = DependencyRules.BecameReady(t.CompletedAt != null, before.Count(unfinished.Contains), wanted.Count(unfinished.Contains));
        db.Dependencies.RemoveRange(current.Where(d => !wanted.Contains(d.DependsOnId)));
        var now = clock.Now;
        foreach (var id in wanted.Where(x => !before.Contains(x))) db.Dependencies.Add(new TaskDependency { TaskId = tid, DependsOnId = id, CreatedAt = now });
        string Codes(IEnumerable<Guid> ids) => string.Join(", ", ids.Select(i => EffortRules.TaskCode(p.Code, numbers[i])).Order());
        db.Activities.Add(Activity(t, TaskActivityKind.Depends, v, user, now, before.Count == 0 ? null : Codes(before), wanted.Count == 0 ? null : Codes(wanted)));
        await db.SaveChangesAsync(ct);
        if (ready) await NotifyReadyAsync(notifier, dir, telegram, p, t, "Danh sách việc phải chờ vừa đổi", v, ct);
        return TypedResults.NoContent();
    }

    internal static async Task<Results<NoContent, NotFound, ProblemHttpResult>> DeleteAsync(Guid tid, ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access,
        IFileStorage files, IEmployeeDirectory dir, INotifier notifier, ITelegramWakeup telegram, CancellationToken ct)
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
        if (v.ClosedError(p.Id, p.Status == ProjectStatus.Active) is { } closed) return Problems.Conflict(closed); // TEST-213: dự án đóng → chỉ quản lý dự án / HR
        // TEST-153: bình luận + tệp xoá theo cascade trong DB → xoá file S3 sau khi lưu
        var keys = await (from a in db.CommentAttachments.AsNoTracking() join c in db.Comments.AsNoTracking() on a.CommentId equals c.Id
                          where c.TaskId == t.Id select a.FileKey).ToListAsync(ct);
        // TEST-198: việc đang chờ việc bị xoá (lấy TRƯỚC khi cascade xoá task_dependencies) + số việc chưa xong mỗi việc đang chờ
        var readyCols = await db.UnblockingColumnIdsAsync(ct);
        var open = !DependencyRules.IsReady(t.CompletedAt != null, t.ColumnId, readyCols.ToHashSet()); // việc đã "đủ" thì không ai đang chờ nó (TEST-199)
        var dependents = await (
            from d in db.Dependencies.AsNoTracking() join x in db.Tasks.AsNoTracking() on d.TaskId equals x.Id
            where open && d.DependsOnId == t.Id && x.CompletedAt == null
            select new
            {
                Task = x,
                Unfinished = (from d2 in db.Dependencies join y in db.Tasks on d2.DependsOnId equals y.Id
                              where d2.TaskId == x.Id && y.CompletedAt == null && !readyCols.Contains(y.ColumnId) select d2).Count(),
            }).ToListAsync(ct);
        db.Tasks.Remove(t);
        await db.SaveChangesAsync(ct);
        await CommentFileEndpoints.DeleteFilesAsync(files, keys, ct);
        foreach (var x in dependents.Where(x => DependencyRules.BecameReady(false, x.Unfinished, x.Unfinished - 1)))
            await NotifyReadyAsync(notifier, dir, telegram, p, x.Task, $"{EffortRules.TaskCode(p.Code, t.Number)} \"{t.Title}\" đã bị xoá", v, ct);
        return TypedResults.NoContent();
    }

    private static async Task<Results<Ok<List<CommentDto>>, NotFound>> CommentsAsync(Guid tid, ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access,
        IFileStorage files, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var t = await db.Tasks.AsNoTracking().FirstOrDefaultAsync(x => x.Id == tid, ct);
        if (t is null || !v.CanSee(t.ProjectId)) return TypedResults.NotFound();
        return TypedResults.Ok(await CommentListAsync(db, files, tid, CommentDeleter(v, user), ct));
    }

    /// <summary>Nhân viên được xoá bình luận CỦA CHÍNH MÌNH (null = không xoá được gì): trên web (không qua token AI), kể cả dự án đã đóng (TEST-213).</summary>
    private static Guid? CommentDeleter(ProjectViewer v, ClaimsPrincipal user) => !user.IsAccessToken() ? v.Employee?.Id : null;

    private static async Task<List<CommentDto>> CommentListAsync(ProjectsDbContext db, IFileStorage files, Guid tid, Guid? deleter, CancellationToken ct)
    {
        var rows = await db.Comments.AsNoTracking().Include(c => c.Attachments).Where(c => c.TaskId == tid).OrderBy(c => c.CreatedAt).ToListAsync(ct);
        var list = new List<CommentDto>(rows.Count);
        foreach (var c in rows)
            list.Add(new CommentDto(c.Id, c.Content, c.AuthorName, c.CreatedAt, c.ByBot, deleter != null && c.AuthorEmployeeId == deleter,
                await CommentFileEndpoints.DtosAsync(c.Attachments, files), c.UploadLinkId != null));
        return list;
    }

    /// <summary>
    /// TEST-39: chỉ chính người viết xoá được bình luận (so <c>AuthorEmployeeId</c>) — không ngoại lệ cho quản lý dự án / HR / admin. Bình luận viết qua token AI
    /// của mình thì chủ token xoá được trên web; token AI không gọi được (ngoài allowlist). Xoá cứng + ghi lịch sử CommentDeleted (không chép nội dung).
    /// </summary>
    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> DeleteCommentAsync(Guid cid, ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access,
        ProjectClock clock, IFileStorage files, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var c = await db.Comments.FirstOrDefaultAsync(x => x.Id == cid, ct);
        var t = c is null ? null : await db.Tasks.FirstOrDefaultAsync(x => x.Id == c.TaskId, ct);
        if (c is null || t is null || !v.CanSee(t.ProjectId)) return TypedResults.NotFound();
        if (user.IsAccessToken()) return ProjectEndpoints.Forbidden("Xoá bình luận chỉ làm trên web");
        if (v.Employee?.Id is not { } me || c.AuthorEmployeeId != me) return ProjectEndpoints.Forbidden("Chỉ người viết được xoá bình luận");
        var keys = await db.CommentAttachments.Where(a => a.CommentId == c.Id).Select(a => a.FileKey).ToListAsync(ct);
        db.Comments.Remove(c);
        db.Activities.Add(Activity(t, TaskActivityKind.CommentDeleted, v, user, clock.Now));
        await db.SaveChangesAsync(ct);
        await CommentFileEndpoints.DeleteFilesAsync(files, keys, ct); // TEST-153: xoá bình luận → xoá file S3
        return TypedResults.NoContent();
    }

    private static async Task<Results<Created<Guid>, NotFound, ValidationProblem, ProblemHttpResult>> AddCommentAsync(Guid tid, NewComment r, ClaimsPrincipal user,
        ProjectsDbContext db, ProjectAccess access, IEmployeeDirectory dir, INotifier notifier, ITelegramWakeup telegram, ProjectClock clock, IFileStorage files,
        BotStreakGuard streak, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var (t, p) = await LoadAsync(tid, db, ct);
        if (t is null || p is null || !v.CanSee(p.Id)) return TypedResults.NotFound();
        if (!v.CanComment(p.Id)) return ProjectEndpoints.Forbidden("Chỉ thành viên dự án được bình luận");
        return await PostCommentAsync(t, p, v, user.IsAccessToken(), r, null, db, access, dir, notifier, telegram, clock, files, streak, ct);
    }

    /// <summary>
    /// Đăng bình luận (nội dung + tệp đã PUT) thay mặt <paramref name="v"/> — dùng chung cho web / token AI và link tải lên từ thiết bị khác
    /// (<paramref name="via"/>, TEST-175: vé phải xin qua đúng link đó; bình luận đứng tên người tạo link). Quyền đã kiểm ở nơi gọi.
    /// </summary>
    internal static async Task<Results<Created<Guid>, NotFound, ValidationProblem, ProblemHttpResult>> PostCommentAsync(TaskItem t, Project p, ProjectViewer v, bool byBot,
        NewComment r, CommentVia? via, ProjectsDbContext db, ProjectAccess access, IEmployeeDirectory dir, INotifier notifier, ITelegramWakeup telegram, ProjectClock clock,
        IFileStorage files, BotStreakGuard streak, CancellationToken ct)
    {
        var tid = t.Id;
        var linkId = via?.LinkId;
        var uploadIds = (r.UploadIds ?? []).Where(u => u != Guid.Empty).Distinct().ToList();
        var val = new Validation();
        foreach (var (field, message) in CommentFileRules.ValidateComment(r.Content, uploadIds.Count)) val.Add(field, message);
        if (val.Failed) return val.Problem();
        // TEST-213: dự án đóng vẫn bình luận kèm tệp được, trừ qua link tải lên từ thiết bị khác
        if (uploadIds.Count > 0 && !ClosedProjectRules.CanAttachFiles(p.Status == ProjectStatus.Active, via is not null)) return Problems.Conflict(ClosedProjectRules.Closed);
        if (await streak.ErrorAsync(byBot, t, p, v, ct) is { } streakErr) return Problems.Conflict(streakErr);
        var tickets = uploadIds.Count == 0 ? []
            : await db.CommentUploadTickets.Where(x => uploadIds.Contains(x.Id) && x.UserId == v.UserId && x.TaskId == tid && x.UploadLinkId == linkId).ToListAsync(ct);
        if (tickets.Count != uploadIds.Count)
            return new Validation().Add("uploadIds", "Tệp đính kèm không hợp lệ hoặc đã hết hạn — tải lại tệp").Problem();
        var c = new TaskComment
        {
            TaskId = tid, Content = r.Content?.Trim() ?? "", AuthorEmployeeId = v.Employee?.Id, AuthorName = v.Name, ByBot = byBot, CreatedAt = clock.Now,
            UploadLinkId = linkId, ClientIp = via?.Ip, UserAgent = via?.UserAgent,
        };
        foreach (var x in tickets.OrderBy(x => uploadIds.IndexOf(x.Id)))
        {
            // Chép key tạm → key chính + kiểm chữ ký đầu file trên bản đã chép (TEST-13)
            var check = await files.PromoteUploadAsync(x.FileKey, x.FileName, ct);
            if (check.Error is { } bad) return new Validation().Add("uploadIds", $"Tệp \"{x.FileName}\": {bad}").Problem();
            if (check.Size is not { } size) return Problems.Conflict($"Tệp \"{x.FileName}\" chưa tải lên xong — thử lại");
            if (size <= 0 || size > CommentFileRules.MaxSizeOf(x.ContentType))
            {
                await files.DeleteAsync(x.FileKey, ct);
                return new Validation().Add("uploadIds", $"Tệp \"{x.FileName}\" vượt giới hạn dung lượng").Problem();
            }
            c.Attachments.Add(new CommentAttachment
            {
                CommentId = c.Id, FileKey = x.FileKey, FileName = x.FileName, ContentType = x.ContentType, Size = size, IsImage = CommentFileRules.IsImage(x.ContentType),
            });
        }
        db.Comments.Add(c);
        db.CommentUploadTickets.RemoveRange(tickets);
        if (linkId is { } lid && await db.CommentUploadLinks.FirstOrDefaultAsync(x => x.Id == lid, ct) is { } link) link.FileCount += tickets.Count;
        await db.SaveChangesAsync(ct);
        var code = EffortRules.TaskCode(p.Code, t.Number);
        var preview = CommentFileRules.Preview(c.Content, c.Attachments.Select(a => (a.FileName, a.IsImage)).ToList());
        var notified = new List<Guid>();
        if (t.AssigneeEmployeeId is { } a && a != v.Employee?.Id && (await dir.GetAsync(a, ct))?.UserId is { } uid)
        {
            await notifier.NotifyAsync(new NotificationRequest([uid], NotificationCategories.ProjectTask, $"{v.Name} bình luận việc {code}",
                preview, NotificationTarget.ProjectTask(p.Id, t.Id, c.Id), SendEmail: false), ct);
            notified.Add(uid);
        }
        // @mã-nhân-viên → báo thành viên dự án được nhắc (trừ người viết và người làm việc — đã nhận chuông bình luận ở trên)
        var codes = AgentTeamRules.MentionedCodes(c.Content);
        if (codes.Count > 0)
        {
            var emps = await access.EmployeesAsync(ct);
            var members = p.Members.Select(m => emps.GetValueOrDefault(m.EmployeeId)).OfType<EmployeeRef>().Select(e => (e.Id, e.Code, e.UserId, e.IsActive)).ToList();
            var mentioned = AgentTeamRules.MentionRecipients(members, codes, v.Employee?.Id, t.AssigneeEmployeeId);
            if (mentioned.Count > 0)
                await notifier.NotifyAsync(new NotificationRequest(mentioned, NotificationCategories.ProjectTask, $"{v.Name} nhắc bạn trong việc {code}",
                    preview, NotificationTarget.ProjectTask(p.Id, t.Id, c.Id), SendEmail: false), ct);
            notified.AddRange(mentioned);
            // Telegram đánh thức bot được nhắc (TEST-63) — gồm cả người làm việc là bot; người không phải bot / đã khoá bị bỏ trong ITelegramWakeup
            if (ClosedProjectRules.WakesBots(p.Status == ProjectStatus.Active)) // TEST-213: dự án đã đóng không đánh thức bot
                foreach (var (botUid, botCode) in AgentTeamRules.MentionWakeTargets(members, codes, v.Employee?.Id))
                    await telegram.TaskMentionedAsync(botUid, botCode, p.Id, t.Id, code, c.Id, ct);
        }
        await NotifyMembersAsync(notifier, access, p, v, notified, $"{v.Name} bình luận việc {code}", $"{t.Title}: {preview}", NotificationTarget.ProjectTask(p.Id, t.Id, c.Id), ct);
        return TypedResults.Created($"/api/projects/comments/{c.Id}", c.Id);
    }
}
