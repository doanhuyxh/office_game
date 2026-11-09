using Microsoft.EntityFrameworkCore;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Notification.Domain;

namespace OfficeHub.Modules.Notification.Infrastructure;

/// <summary>Thống kê + gửi lại hàng đợi email (cột Email* của bảng notifications).</summary>
internal sealed class EmailOutbox(NotificationDbContext db, TimeProvider clock) : IEmailOutbox
{
    public async Task<EmailQueueStats> StatsAsync(CancellationToken ct = default)
    {
        var now = clock.GetUtcNow();
        var d1 = now.AddDays(-1);
        var d30 = now.AddDays(-30);
        var q = db.Notifications.AsNoTracking();
        var pending = await q.Where(n => n.EmailStatus == EmailStatus.Pending)
            .GroupBy(_ => 1).Select(g => new { N = g.Count(), Oldest = g.Min(n => (DateTimeOffset?)n.CreatedAt), Retrying = g.Count(n => n.EmailAttempts > 0) })
            .FirstOrDefaultAsync(ct);
        var sent24 = await q.CountAsync(n => n.EmailStatus == EmailStatus.Sent && n.EmailSentAt >= d1, ct);
        var lastSent = await q.Where(n => n.EmailStatus == EmailStatus.Sent).MaxAsync(n => n.EmailSentAt, ct);
        var failed = await q.CountAsync(n => n.EmailStatus == EmailStatus.Failed && n.CreatedAt >= d30, ct);
        var skipped = await q.CountAsync(n => n.EmailStatus == EmailStatus.Skipped && n.CreatedAt >= d30, ct);
        var recent = await q.Where(n => n.EmailError != null && n.CreatedAt >= d30
                                        && (n.EmailStatus == EmailStatus.Failed || (n.EmailStatus == EmailStatus.Pending && n.EmailAttempts > 0)))
            .OrderByDescending(n => n.CreatedAt).Take(15)
            .Select(n => new EmailFailureDto(n.Id, n.EmailTo, n.Title, n.Category, n.EmailAttempts, n.EmailError, n.CreatedAt, n.EmailStatus == EmailStatus.Failed))
            .ToListAsync(ct);
        return new(pending?.N ?? 0, pending?.Oldest, pending?.Retrying ?? 0, sent24, failed, skipped, lastSent, recent);
    }

    public Task<int> RetryFailedAsync(CancellationToken ct = default)
    {
        var now = clock.GetUtcNow();
        var d30 = now.AddDays(-30);
        return db.Notifications.Where(n => n.EmailStatus == EmailStatus.Failed && n.CreatedAt >= d30 && n.EmailTo != null)
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.EmailStatus, EmailStatus.Pending).SetProperty(n => n.EmailAttempts, 0)
                .SetProperty(n => n.EmailNextAttemptAt, now), ct);
    }
}
