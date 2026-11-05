using Microsoft.AspNetCore.SignalR;
using OfficeHub.Realtime.Hubs;

namespace OfficeHub.Realtime.Simulation;

/// <summary>Vòng lặp 10 Hz: gom vị trí đã thay đổi và phát cho cả phòng trong một gói.</summary>
public sealed class OfficeLoop(Presence presence, IHubContext<OfficeRoomHub, IOfficeClient> hub, ILogger<OfficeLoop> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(100));
        while (await timer.WaitForNextTickAsync(ct))
        {
            try
            {
                var changed = new List<PositionDto>();
                foreach (var p in presence.All)
                {
                    lock (p)
                    {
                        if (!p.Dirty) continue;
                        p.Dirty = false;
                        changed.Add(new PositionDto(p.UserId, p.X, p.Z, p.R, p.Anim));
                    }
                }
                if (changed.Count > 0)
                    await hub.Clients.Group("office").Positions([.. changed]);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "Lỗi vòng lặp văn phòng");
            }
        }
    }
}
