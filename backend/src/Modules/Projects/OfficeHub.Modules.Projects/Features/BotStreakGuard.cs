using Microsoft.EntityFrameworkCore;
using OfficeHub.Modules.Identity.Contracts;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Projects.Contracts;
using OfficeHub.Modules.Projects.Domain;
using OfficeHub.Modules.Projects.Infrastructure;

namespace OfficeHub.Modules.Projects.Features;

/// <summary>
/// Rào chắn "chuỗi bot ≤ M" (<see cref="AgentTeamRules"/>) dùng chung cho chuyển cột / giao người / bình luận / việc chờ / người theo dõi.
/// Bot bị chặn → chuông in-app cho quản lý dự án (TEST-182), một lần cho mỗi lần chạm trần: ghi lịch sử
/// <see cref="TaskActivityKind.StreakBlocked"/> làm dấu "đã báo", người thật thao tác (chuỗi về 0) thì lần chạm trần sau báo lại.
/// Nơi gọi phải chưa sửa dữ liệu nào trên <see cref="ProjectsDbContext"/> (dấu được lưu ngay, rồi nơi gọi trả 409).
/// </summary>
internal sealed class BotStreakGuard(ProjectsDbContext db, ProjectAccess access, IAccountService accounts, INotifier notifier, ProjectClock clock)
{
    /// <summary>Thông điệp 409 khi bot (token AI) đã chạm trần chuỗi trên việc, null = được làm.</summary>
    public async Task<string?> ErrorAsync(bool byBot, TaskItem t, Project p, ProjectViewer v, CancellationToken ct)
    {
        if (!byBot) return null;
        var acts = await db.Activities.AsNoTracking().Where(a => a.TaskId == t.Id).OrderByDescending(a => a.At).Take(50)
            .Select(a => new { a.At, a.ByBot, a.Kind }).ToListAsync(ct);
        var comments = await db.Comments.AsNoTracking().Where(c => c.TaskId == t.Id).OrderByDescending(c => c.CreatedAt).Take(50)
            .Select(c => new { c.CreatedAt, c.ByBot }).ToListAsync(ct);
        var events = acts.Select(a => new TaskEvent(a.At, a.ByBot, a.Kind is TaskActivityKind.Moved or TaskActivityKind.Assigned,
                a.Kind == TaskActivityKind.StreakBlocked))
            .Concat(comments.Select(c => new TaskEvent(c.CreatedAt, c.ByBot, true))) // bình luận bot cũng tính: chặn hai bot @nhắc nhau qua lại
            .ToList();
        var limit = (await db.AgentLimitsAsync(ct)).Streak;
        if (AgentTeamRules.StreakAllows(AgentTeamRules.BotStreak(events), limit)) return null;
        if (AgentTeamRules.StreakAlertDue(events)) await AlertAsync(t, p, v, limit, ct);
        return AgentTeamRules.StreakMessage(limit);
    }

    private async Task AlertAsync(TaskItem t, Project p, ProjectViewer v, int limit, CancellationToken ct)
    {
        var code = EffortRules.TaskCode(p.Code, t.Number);
        db.Activities.Add(new TaskActivity
        {
            TaskId = t.Id, Kind = TaskActivityKind.StreakBlocked, To = $"{limit} lần", ActorEmployeeId = v.Employee?.Id, ActorName = v.Name, ByBot = true, At = clock.Now,
        });
        await db.SaveChangesAsync(ct);

        var emps = await access.EmployeesAsync(ct);
        var managers = p.Members.Where(m => m.Role == ProjectMemberRole.Manager)
            .Select(m => emps.TryGetValue(m.EmployeeId, out var e) ? (UserId: e.UserId, IsActive: e.IsActive) : (UserId: (Guid?)null, IsActive: false)).ToList();
        var userIds = managers.Where(m => m.UserId is not null).Select(m => m.UserId!.Value).Distinct().ToList();
        if (userIds.Count == 0) return;
        var accs = await accounts.GetManyAsync(userIds, ct);
        var to = AgentTeamRules.StreakAlertRecipients(
            managers.Select(m => (m.UserId, m.IsActive, m.UserId is { } u && accs.TryGetValue(u, out var a) && a.IsBot)), v.UserId);
        if (to.Count == 0) return;
        await notifier.NotifyAsync(new NotificationRequest([.. to], NotificationCategories.ProjectTask, AgentTeamRules.StreakAlertTitle(code, limit),
            TaskNotifyRules.Body($"{v.Name} bị chặn trên việc \"{t.Title}\" (dự án {p.Name}). Bình luận hoặc chuyển trạng thái trên web để bot làm tiếp."),
            TaskNotifyRules.Link(p.Id, t.Id), SendEmail: false), ct);
    }
}
