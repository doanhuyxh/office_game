using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using OfficeHub.BuildingBlocks.Hosting;
using OfficeHub.Modules.Meetings.Domain;

namespace OfficeHub.Modules.Meetings.Infrastructure;

/// <summary>
/// Mỗi phút: kết thúc phiên họp agent đã quá trần (lý do <see cref="AgentMeetingEndReason.TimeLimit"/>) + tin hệ thống trong kênh phòng;
/// bot giữ lượt quá <see cref="AgentMeetingTurnRules.TurnTimeout"/> chưa nói → coi như bỏ lượt (TEST-75). Chỉ chạy trong host Api.
/// </summary>
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
        var turns = scope.ServiceProvider.GetRequiredService<AgentMeetingTurnService>();
        var now = clock.GetUtcNow();
        var active = await db.AgentMeetings.AsNoTracking().Where(m => m.Status == AgentMeetingStatus.Active).ToListAsync(ct);
        var ended = 0;
        foreach (var m in active.Where(m => AgentMeetingRules.LimitReached(m, now) is not null || AgentMeetingTurnRules.TimedOut(m, now)))
            if ((await turns.SweepAsync(m.Id, ct)).Change.Ended is not null) ended++;
        return ended;
    }
}
