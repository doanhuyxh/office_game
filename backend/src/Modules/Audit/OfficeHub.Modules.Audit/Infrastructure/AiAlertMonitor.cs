using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Hosting;
using OfficeHub.Modules.Audit.Domain;
using OfficeHub.Modules.Identity.Contracts;
using OfficeHub.Modules.Notification.Contracts;

namespace OfficeHub.Modules.Audit.Infrastructure;

/// <summary>
/// Mỗi 5 phút quét <c>audit.ai_requests</c> 15 phút gần nhất theo từng người, áp <see cref="AiAlertRules"/> →
/// lưu <c>audit.ai_alerts</c> + báo mọi admin đang hoạt động (chuông + push; email chỉ khi bot duyệt đơn).
/// Không tự thu hồi token — chỉ báo, người quyết. Chỉ chạy trong host Api, giả định một instance.
/// </summary>
internal sealed class AiAlertMonitor(IServiceScopeFactory scopes, TimeProvider clock, ILogger<AiAlertMonitor> log, JobMonitor monitor) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        var job = monitor.Register("audit.ai-alerts", "Cảnh báo trợ lý AI bất thường", AiAlertRules.Interval);
        await Task.Delay(TimeSpan.FromSeconds(50), stop); // đợi migration / seed xong
        using var timer = new PeriodicTimer(AiAlertRules.Interval);
        do
        {
            try { await job.RunAsync(() => RunOnceAsync(stop)); }
            catch (Exception ex) when (!stop.IsCancellationRequested) { log.LogError(ex, "Lỗi khi quét cảnh báo AI"); }
        } while (await timer.WaitForNextTickAsync(stop));
    }

    /// <summary>Trả số cảnh báo đã tạo.</summary>
    internal async Task<int> RunOnceAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var sp = scope.ServiceProvider;
        var db = sp.GetRequiredService<AuditDbContext>();
        var now = clock.GetUtcNow();
        var from = now - AiAlertRules.Window;
        var expired = now.AddDays(-AuditRules.AiRetentionDays);
        await db.AiAlerts.Where(a => a.CreatedAt < expired).ExecuteDeleteAsync(ct); // cùng hạn lưu với nhật ký AI

        var stats = await WindowStatsAsync(db, from, now, ct);
        if (stats.Count == 0) return 0;

        var accounts = sp.GetRequiredService<IAccountService>();
        var people = await accounts.GetManyAsync(stats.Select(s => s.UserId).ToList(), ct);
        var since = now - AiAlertRules.Cooldown;
        var recent = (await db.AiAlerts.AsNoTracking().Where(a => a.CreatedAt > since)
            .Select(a => new { a.UserId, a.Rule, a.CreatedAt }).ToListAsync(ct))
            .GroupBy(a => (a.UserId, a.Rule)).ToDictionary(g => g.Key, g => g.Max(a => a.CreatedAt));

        var created = new List<AiAlert>();
        foreach (var s in stats)
        {
            people.TryGetValue(s.UserId, out var acc);
            foreach (var hit in AiAlertRules.Evaluate(s, acc?.IsBot == true))
            {
                if (AiAlertRules.InCooldown(recent.GetValueOrDefault((s.UserId, hit.Rule)), now)) continue;
                created.Add(new AiAlert { CreatedAt = now, UserId = s.UserId, Rule = hit.Rule, WindowStart = from, WindowEnd = now, Count = hit.Count, Total = s.Total });
            }
        }
        if (created.Count == 0) return 0;
        db.AiAlerts.AddRange(created);
        await db.SaveChangesAsync(ct); // lưu trước khi gửi: gửi lỗi cũng không báo lặp

        var admins = (await accounts.ListByRoleAsync(Roles.Admin, ct)).Where(a => a.IsActive).Select(a => a.Id).ToList();
        if (admins.Count == 0)
        {
            log.LogWarning("Có {Count} cảnh báo AI nhưng không có admin nào để báo", created.Count);
            return created.Count;
        }
        var notifier = sp.GetRequiredService<INotifier>();
        foreach (var a in created)
        {
            people.TryGetValue(a.UserId, out var acc);
            var name = acc is null ? "(tài khoản đã xoá)" : string.IsNullOrWhiteSpace(acc.FullName) ? acc.UserName : acc.FullName;
            try
            {
                await notifier.NotifyAsync(new NotificationRequest(admins, NotificationCategories.AiAlert,
                    AiAlertRules.Title(a.Rule, name), AiAlertRules.Body(a.Rule, a.Count, a.Total), "/reports?tab=ai",
                    SendEmail: AiAlertRules.SendsEmail(a.Rule)), ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "Không gửi được cảnh báo AI {Rule} của {UserId}", a.Rule, a.UserId);
            }
        }
        log.LogInformation("Đã gửi {Count} cảnh báo AI cho {Admins} admin", created.Count, admins.Count);
        return created.Count;
    }

    /// <summary>GROUP BY theo người trong [from, to). Phân loại giống báo cáo sử dụng (AiUsageQueries).</summary>
    internal static Task<List<AiWindowStats>> WindowStatsAsync(AuditDbContext db, DateTimeOffset from, DateTimeOffset to, CancellationToken ct) =>
        WindowStats(db.AiRequests.AsNoTracking(), from, to).ToListAsync(ct);

    internal static IQueryable<AiWindowStats> WindowStats(IQueryable<AiRequestLog> q, DateTimeOffset from, DateTimeOffset to) =>
        q.Where(x => x.OccurredAt >= from && x.OccurredAt < to)
            .GroupBy(x => x.UserId)
            .Select(g => new AiWindowStats(
                g.Key,
                g.Count(),
                g.Count(x => x.Status == 403 || x.Status == 429),
                g.Count(x => x.Status >= 400 && x.Status != 403 && x.Status != 429),
                g.Count(x => x.Method != "GET" && x.Method != "HEAD" && x.Method != "OPTIONS"),
                g.Count(x => x.Method == "POST" && x.Path.StartsWith("/api/approval/")
                    && (x.Path.EndsWith("/approve") || x.Path.EndsWith("/reject")))));
}
