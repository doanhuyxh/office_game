using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Office;
using OfficeHub.Modules.Organization.Contracts;
using OfficeHub.Modules.Projects.Domain;
using OfficeHub.Modules.Projects.Infrastructure;

namespace OfficeHub.Modules.Projects.Features;

/// <summary>
/// Đường nội bộ Realtime → Api (TEST-119): việc đang chờ người (duyệt / trả lời) của các bot đang online để văn phòng 3D hiện "bot cần chú ý".
/// Không cookie — khoá <c>Chat__RealtimeToApiKey</c> (trống = <c>Chat__InternalKey</c>) qua header <see cref="AgentMeetingLiveRoute.KeyHeader"/>.
/// Chỉ gọi trong mạng Docker — nginx chặn <c>/api/projects/internal/</c> từ ngoài. Luật nhận biết: <see cref="BotWaitRules"/>.
/// </summary>
internal static class BotWaitingEndpoints
{
    public static void Map(RouteGroupBuilder g) => g.MapPost("/bot-waiting", WaitingAsync);

    private static async Task<Results<Ok<List<BotWaiting>>, ProblemHttpResult>> WaitingAsync(BotWaitingQuery q, HttpRequest http,
        IOptions<ChatSettings> settings, ProjectsDbContext db, IEmployeeDirectory dir, CancellationToken ct)
    {
        if (!BotActivityRoute.KeyMatches(http.Headers[AgentMeetingLiveRoute.KeyHeader].ToString(), settings.Value.RealtimeApiKey))
            return TypedResults.Problem("Khoá nội bộ không đúng", statusCode: StatusCodes.Status401Unauthorized);
        var userIds = (q.UserIds ?? []).ToHashSet();
        if (userIds.Count > BotWaitingRoute.MaxUsers)
            return TypedResults.Problem($"Tối đa {BotWaitingRoute.MaxUsers} tài khoản mỗi lần hỏi", statusCode: StatusCodes.Status400BadRequest);
        if (userIds.Count == 0) return TypedResults.Ok(new List<BotWaiting>());

        // userId → nhân viên còn làm việc
        var userOf = (await dir.ListActiveAsync(ct)).Where(e => e.UserId is { } u && userIds.Contains(u))
            .ToDictionary(e => e.Id, e => e.UserId!.Value);
        if (userOf.Count == 0) return TypedResults.Ok(new List<BotWaiting>());
        var empIds = userOf.Keys.ToList();

        // Việc mở của các bot, dự án đang chạy, không còn việc phụ thuộc chưa "đủ" (TEST-199: đã xong hoặc ở cột "Việc sau được bắt đầu từ cột này")
        var ready = await db.UnblockingColumnIdsAsync(ct);
        var tasks = await (from t in db.Tasks.AsNoTracking()
                           join p in db.Projects.AsNoTracking() on t.ProjectId equals p.Id
                           where t.AssigneeEmployeeId != null && empIds.Contains(t.AssigneeEmployeeId.Value)
                                 && t.CompletedAt == null && p.Status == ProjectStatus.Active
                                 && !db.Dependencies.Any(d => d.TaskId == t.Id && db.Tasks.Any(o => o.Id == d.DependsOnId && o.CompletedAt == null && !ready.Contains(o.ColumnId)))
                           select new { t.Id, t.ProjectId, t.Number, t.Title, t.ColumnId, Assignee = t.AssigneeEmployeeId!.Value, ProjectCode = p.Code })
            .ToListAsync(ct);
        if (tasks.Count == 0) return TypedResults.Ok(new List<BotWaiting>());
        var taskIds = tasks.Select(t => t.Id).ToList();
        var projectIds = tasks.Select(t => t.ProjectId).Distinct().ToList();

        var events = await db.WaitEventsAsync(taskIds, ct);
        var columns = await db.Columns.AsNoTracking().Where(c => projectIds.Contains(c.ProjectId)).ToListAsync(ct);
        var columnsOf = columns.ToLookup(c => c.ProjectId);
        var columnName = columns.ToDictionary(c => c.Id, c => c.Name);

        var waiting = new List<BotWaiting>();
        foreach (var g in tasks.GroupBy(t => t.Assignee))
        {
            var list = new List<BotWaitingTask>();
            foreach (var t in g)
            {
                if (BotWaitRules.WaitingSince(events[t.Id], t.Assignee) is not { } since) continue;
                var kind = BotWaitRules.AwaitingApproval(columnsOf[t.ProjectId], t.ColumnId) ? BotWaitingRoute.Approval : BotWaitingRoute.Reply;
                list.Add(new BotWaitingTask(t.Id, t.ProjectId, EffortRules.TaskCode(t.ProjectCode, t.Number), t.Title,
                    columnName.GetValueOrDefault(t.ColumnId, ""), kind, since));
            }
            if (list.Count > 0)
                waiting.Add(new BotWaiting(userOf[g.Key], list.OrderByDescending(x => x.Since).Take(BotWaitingRoute.MaxTasks).ToList()));
        }
        return TypedResults.Ok(waiting);
    }
}
