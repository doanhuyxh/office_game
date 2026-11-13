using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using OfficeHub.Realtime.Hubs;
using OfficeHub.Realtime.Simulation;

namespace OfficeHub.Realtime.Auth;

/// <summary>Định kỳ kiểm tra lại phiên của mọi người đang online; phiên hết hiệu lực (bị khoá, nghỉ việc…) → đẩy ra; họ tên đổi → NameChanged.</summary>
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
                var (state, _, name) = await validator.CheckWithProfileAsync(p.AuthCookie, ct);
                log.LogDebug("Kiểm tra phiên {User}: {State}", p.Name, state);
                if (state == SessionState.Valid && name is not null && name != p.Name)
                {
                    // HR đổi họ tên (TEST-69) → cập nhật nhãn cho mọi người đang online, không cần vào lại văn phòng
                    log.LogInformation("Đổi tên trong văn phòng: {Old} → {New}", p.Name, name);
                    p.Name = name;
                    await hub.Clients.Group(OfficeRoomHub.OfficeGroup).NameChanged(p.UserId, name);
                }
                if (state != SessionState.Invalid) continue;
                log.LogInformation("Đẩy {User} khỏi văn phòng: phiên hết hiệu lực", p.Name);
                await hub.Clients.Client(p.ConnectionId).Kicked(ExpiredReason);
                _ = Task.Delay(500, ct).ContinueWith(_ => p.Context.Abort(), TaskScheduler.Default);
            }
        }
    }
}
