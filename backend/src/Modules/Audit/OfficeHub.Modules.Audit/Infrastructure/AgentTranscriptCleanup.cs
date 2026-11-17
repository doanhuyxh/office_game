using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using OfficeHub.BuildingBlocks.Ai;
using OfficeHub.BuildingBlocks.Hosting;

namespace OfficeHub.Modules.Audit.Infrastructure;

/// <summary>
/// Mỗi 6 giờ xoá transcript phiên agent hết hạn (<see cref="AgentTranscriptRoute.RetentionDays"/> ngày từ lần gửi cuối): file S3 rồi dòng DB,
/// tối đa 500 bản / lượt (TEST-144). Hiện ở Hệ thống → Vận hành (job nền).
/// </summary>
internal sealed class AgentTranscriptCleanup(IServiceScopeFactory scopes, ILogger<AgentTranscriptCleanup> log, JobMonitor monitor) : BackgroundService
{
    internal static readonly TimeSpan Interval = TimeSpan.FromHours(6);

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        var job = monitor.Register("audit.agent-transcripts", $"Xoá transcript phiên agent quá {AgentTranscriptRoute.RetentionDays} ngày", Interval);
        await Task.Delay(TimeSpan.FromSeconds(70), stop); // đợi migration xong
        using var timer = new PeriodicTimer(Interval);
        do
        {
            try
            {
                await job.RunAsync(async () =>
                {
                    using var scope = scopes.CreateScope();
                    var n = await scope.ServiceProvider.GetRequiredService<AgentTranscriptStore>().DeleteExpiredAsync(stop);
                    if (n > 0) log.LogInformation("Đã xoá {Count} transcript phiên agent hết hạn", n);
                });
            }
            catch (Exception ex) when (!stop.IsCancellationRequested) { log.LogError(ex, "Lỗi khi xoá transcript phiên agent hết hạn"); }
        } while (await timer.WaitForNextTickAsync(stop));
    }
}
