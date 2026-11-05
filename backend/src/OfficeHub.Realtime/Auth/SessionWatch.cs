using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using OfficeHub.Realtime.Hubs;
using OfficeHub.Realtime.Simulation;

namespace OfficeHub.Realtime.Auth;

/// <summary>Định kỳ kiểm tra lại phiên của mọi người đang online; phiên hết hiệu lực (bị khoá, nghỉ việc…) → đẩy ra.</summary>
public sealed class SessionWatch(Presence presence, SessionValidator validator, IHubContext<OfficeRoomHub, IOfficeClient> hub,
    IOptions<RealtimeSettings> options, ILogger<SessionWatch> log) : BackgroundService
{
    public const string ExpiredReason = "Phiên đăng nhập đã hết hiệu lực. Vui lòng đăng nhập lại.";

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(Math.Max(5, options.Value.SessionCheckSeconds)));
        while (await timer.WaitForNextTickAsync(ct))
        {
            foreach (var p in presence.All.ToList())
            {
                var state = await validator.CheckAsync(p.AuthCookie, ct);
                log.LogDebug("Kiểm tra phiên {User}: {State}", p.Name, state);
                if (state != SessionState.Invalid) continue;
                log.LogInformation("Đẩy {User} khỏi văn phòng: phiên hết hiệu lực", p.Name);
                await hub.Clients.Client(p.ConnectionId).Kicked(ExpiredReason);
                _ = Task.Delay(500, ct).ContinueWith(_ => p.Context.Abort(), TaskScheduler.Default);
            }
        }
    }
}
