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
using OfficeHub.Modules.Projects.Domain;
using OfficeHub.Modules.Projects.Infrastructure;

namespace OfficeHub.Modules.Projects.Features;

/// <param name="Action">Một trong <see cref="BulkTaskActions"/>.</param>
/// <param name="ColumnId">move: cột đích.</param><param name="Note">move: lý do khi lùi (dùng chung cả loạt).</param>
/// <param name="AssigneeEmployeeId">assign: người làm mới (null = bỏ giao).</param>
/// <param name="DueMode">due: set / clear / shift.</param><param name="DueOn">due set.</param><param name="ShiftDays">due shift: số ngày dời (âm = lùi lại).</param>
/// <param name="FollowerEmployeeId">follow / unfollow.</param>
/// <param name="Confirm">delete: phải là chữ "delete".</param>
public sealed record BulkTasksRequest(List<Guid> TaskIds, string Action, Guid? ColumnId = null, string? Note = null, Guid? AssigneeEmployeeId = null,
    string? DueMode = null, DateOnly? DueOn = null, int ShiftDays = 0, Guid? FollowerEmployeeId = null, string? Confirm = null);
public sealed record BulkTaskSkip(Guid TaskId, string Code, string Reason);
/// <summary>Thành công từng phần: <c>Applied</c> đã làm xong, <c>Skipped</c> bị bỏ qua kèm lý do (việc đó không đổi gì).</summary>
public sealed record BulkTasksResult(List<Guid> Applied, List<BulkTaskSkip> Skipped);

/// <summary>
/// Thao tác hàng loạt trên việc (web): <c>POST /api/projects/{id}/tasks/bulk</c>. Từng việc gọi đúng handler đơn lẻ (<see cref="TaskEndpoints"/> /
/// <see cref="TaskFollowerEndpoints"/>) nên quyền, quy trình, lịch sử, thông báo + đánh thức bot y như thao tác tay từng việc; việc nào lỗi thì bỏ qua, các việc khác vẫn làm.
/// Token AI không gọi được (ngoài allowlist + chặn thẳng).
/// </summary>
internal static class BulkTaskEndpoints
{
    public static void Map(RouteGroupBuilder g) => g.MapPost("/{id:guid}/tasks/bulk", BulkAsync);

    private static async Task<Results<Ok<BulkTasksResult>, NotFound, ValidationProblem, ProblemHttpResult>> BulkAsync(Guid id, BulkTasksRequest r, ClaimsPrincipal user,
        ProjectsDbContext db, ProjectAccess access, IEmployeeDirectory dir, INotifier notifier, ITelegramWakeup telegram, IWebhookPublisher webhooks, IAccountService accounts,
        ProjectClock clock, BotStreakGuard streak, IFileStorage files, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        if (!v.CanSee(id)) return TypedResults.NotFound();
        if (user.IsAccessToken()) return ProjectEndpoints.Forbidden("Thao tác hàng loạt chỉ dùng trên web");
        var ids = r.TaskIds?.Distinct().ToList() ?? [];
        if (BulkTaskRules.RequestError(r.Action, ids.Count, r.ColumnId is not null, r.FollowerEmployeeId is not null, r.DueMode, r.ShiftDays, r.DueOn is not null, r.Confirm) is { } bad)
            return new Validation().Add("action", bad).Problem();
        if (r.Note is { Length: > TaskWorkflow.MaxNote }) return new Validation().Add("note", $"Lý do dài quá {TaskWorkflow.MaxNote} ký tự").Problem();

        var project = await db.Projects.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (project is null) return TypedResults.NotFound();
        var rows = await db.Tasks.AsNoTracking().Where(x => x.ProjectId == id && ids.Contains(x.Id)).ToDictionaryAsync(x => x.Id, ct);
        var applied = new List<Guid>();
        var skipped = new List<BulkTaskSkip>();
        foreach (var tid in ids)
        {
            if (!rows.TryGetValue(tid, out var t)) { skipped.Add(new(tid, "?", "Việc không thuộc dự án này")); continue; }
            var code = EffortRules.TaskCode(project.Code, t.Number);
            try
            {
                var error = await ApplyOneAsync(r, t, user, db, access, dir, notifier, telegram, webhooks, accounts, clock, streak, files, ct);
                if (error is null) applied.Add(tid); else skipped.Add(new(tid, code, error));
            }
            catch (DbUpdateException) { skipped.Add(new(tid, code, "Việc vừa bị người khác đổi — thử lại")); }
            finally { db.ChangeTracker.Clear(); } // mỗi việc một lượt sạch: lỗi giữa chừng không để lại thay đổi chờ lưu cho việc sau
        }
        return TypedResults.Ok(new BulkTasksResult(applied, skipped));
    }

    /// <summary>Lỗi (lý do bỏ qua) hoặc null nếu đã áp dụng.</summary>
    private static async Task<string?> ApplyOneAsync(BulkTasksRequest r, TaskItem t, ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access, IEmployeeDirectory dir,
        INotifier notifier, ITelegramWakeup telegram, IWebhookPublisher webhooks, IAccountService accounts, ProjectClock clock, BotStreakGuard streak, IFileStorage files, CancellationToken ct)
    {
        IResult res;
        switch (r.Action)
        {
            case BulkTaskActions.Move:
                res = (await TaskEndpoints.MoveAsync(t.Id, new MoveTask(r.ColumnId!.Value, null, r.Note), user, db, access, dir, notifier, telegram, webhooks, accounts, clock, streak, ct)).Result;
                break;
            case BulkTaskActions.Assign:
                res = (await TaskEndpoints.UpdateAsync(t.Id, Same(t) with { AssigneeEmployeeId = r.AssigneeEmployeeId }, user, db, access, dir, notifier, telegram, webhooks, accounts, clock, streak, ct)).Result;
                break;
            case BulkTaskActions.Due:
                DateOnly? due;
                if (r.DueMode == BulkDueModes.Set) due = r.DueOn;
                else if (r.DueMode == BulkDueModes.Clear) due = null;
                else if (BulkTaskRules.ShiftDue(t.DueOn, r.ShiftDays) is { } shifted) due = shifted;
                else return "Việc chưa có hạn để dời";
                if (due == t.DueOn) return null; // không đổi gì — coi như đã đúng
                res = (await TaskEndpoints.UpdateAsync(t.Id, Same(t) with { DueOn = due }, user, db, access, dir, notifier, telegram, webhooks, accounts, clock, streak, ct)).Result;
                break;
            case BulkTaskActions.Follow:
                res = (await TaskFollowerEndpoints.AddAsync(t.Id, r.FollowerEmployeeId!.Value, user, db, access, clock, streak, ct)).Result;
                break;
            case BulkTaskActions.Unfollow:
                res = (await TaskFollowerEndpoints.RemoveAsync(t.Id, r.FollowerEmployeeId!.Value, user, db, access, clock, streak, ct)).Result;
                break;
            default:
                res = (await TaskEndpoints.DeleteAsync(t.Id, user, db, access, files, dir, notifier, telegram, ct)).Result;
                break;
        }
        return ErrorOf(res);
    }

    /// <summary>Bản <see cref="UpsertTask"/> giữ nguyên mọi trường của việc (MediaLinks null = giữ, ColumnId null = giữ cột).</summary>
    private static UpsertTask Same(TaskItem t) => new(t.Title, t.Description, null, t.AssigneeEmployeeId, t.MilestoneId, t.DueOn, t.EstimateDays, null, null);

    private static string? ErrorOf(IResult res) => res switch
    {
        NoContent => null,
        NotFound => "Không tìm thấy việc",
        ProblemHttpResult p => p.ProblemDetails.Detail ?? p.ProblemDetails.Title ?? "Không thực hiện được",
        ValidationProblem vp => vp.ProblemDetails.Errors.Values.SelectMany(e => e).FirstOrDefault() ?? "Dữ liệu không hợp lệ",
        _ => "Không thực hiện được",
    };
}
