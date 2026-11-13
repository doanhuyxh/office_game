using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using OfficeHub.BuildingBlocks.Hosting;
using OfficeHub.Modules.Meetings.Domain;

namespace OfficeHub.Modules.Meetings.Infrastructure;

/// <summary>Mỗi phút kết thúc phiên họp agent đã quá trần phút (lý do <see cref="AgentMeetingEndReason.TimeLimit"/>). Chỉ chạy trong host Api.</summary>
internal sealed class AgentMeetingExpiryJob(IServiceScopeFactory scopes, TimeProvider clock, ILogger<AgentMeetingExpiryJob> log, JobMonitor monitor)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        var job = monitor.Register("meetings.agent-expiry", "Kết thúc cuộc họp agent quá giờ", AgentMeetingRules.ExpiryInterval);
        await Task.Delay(TimeSpan.FromSeconds(40), stop); // đợi migration xong
        using var timer = new PeriodicTimer(AgentMeetingRules.ExpiryInterval);
        do
        {
            try { await job.RunAsync(() => RunOnceAsync(stop)); }
            catch (Exception ex) when (!stop.IsCancellationRequested) { log.LogError(ex, "Lỗi khi kết thúc cuộc họp agent quá giờ"); }
        } while (await timer.WaitForNextTickAsync(stop));
    }

    /// <summary>Trả số phiên đã kết thúc.</summary>
    internal async Task<int> RunOnceAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MeetingsDbContext>();
        var now = clock.GetUtcNow();
        var active = await db.AgentMeetings.Where(m => m.Status == AgentMeetingStatus.Active).ToListAsync(ct);
        var ended = 0;
        foreach (var m in active)
            if (AgentMeetingRules.LimitReached(m, now) is { } reason) { m.End(reason, now); ended++; }
        if (ended > 0) await db.SaveChangesAsync(ct);
        return ended;
    }
}
