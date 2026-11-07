using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using OfficeHub.Realtime.Auth;
using OfficeHub.Realtime.Hubs;

namespace OfficeHub.Realtime.Chat;

/// <summary>Định kỳ kiểm tra lại cookie của các kết nối chat; phiên hết hiệu lực (khoá, nghỉ việc…) → đẩy ra. Api không trả lời → cho qua.</summary>
public sealed class ChatSessionWatch(ChatConnections connections, SessionValidator validator, IHubContext<ChatHub, IChatClient> hub,
    IOptions<RealtimeSettings> options, ILogger<ChatSessionWatch> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(Math.Max(5, options.Value.SessionCheckSeconds)));
        while (await timer.WaitForNextTickAsync(ct))
        {
            var checkedCookies = new Dictionary<string, SessionState>(StringComparer.Ordinal); // cùng cookie chỉ hỏi Api một lần mỗi vòng
            foreach (var (id, c) in connections.All.ToList())
            {
                if (!checkedCookies.TryGetValue(c.AuthCookie ?? "", out var state))
                    checkedCookies[c.AuthCookie ?? ""] = state = await validator.CheckAsync(c.AuthCookie, ct);
                if (state != SessionState.Invalid) continue;
                log.LogInformation("Đẩy kết nối chat của {User}: phiên hết hiệu lực", c.UserId);
                await hub.Clients.Client(id).Kicked(SessionWatch.ExpiredReason);
                _ = Task.Delay(500, ct).ContinueWith(_ => c.Context.Abort(), TaskScheduler.Default);
            }
        }
    }
}
