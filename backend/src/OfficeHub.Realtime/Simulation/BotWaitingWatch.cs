using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Office;
using OfficeHub.Realtime.Hubs;

namespace OfficeHub.Realtime.Simulation;

/// <summary>
/// Bot cần chú ý — việc chờ người (TEST-120, mẫu <see cref="AgentMeetingWatch"/>): mỗi <see cref="BotWaitingRoute.PollSeconds"/> giây, có bot
/// đang online → POST Api <see cref="BotWaitingRoute.Path"/> (khoá chiều Realtime → Api, header <see cref="AgentMeetingLiveRoute.KeyHeader"/>)
/// với userId các bot (≤ <see cref="BotWaitingRoute.MaxUsers"/>) → <see cref="BotPresence.SyncWaiting"/> → phát <c>BotStatus</c> + <c>BotAlert</c>
/// cho bot đổi. Api lỗi → giữ nguyên trạng thái cũ, chỉ ghi log lần đầu, thử lại lần sau.
/// </summary>
public sealed class BotWaitingWatch(IHttpClientFactory http, IOptions<ChatSettings> settings, BotPresence bots,
    IHubContext<OfficeRoomHub, IOfficeClient> hub, ILogger<BotWaitingWatch> log) : BackgroundService
{
    public const string HttpClientName = "bot-waiting";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private bool _failing;

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(BotWaitingRoute.PollSeconds));
        while (await timer.WaitForNextTickAsync(ct))
        {
            try
            {
                var ids = bots.All.Select(b => Guid.TryParse(b.UserId, out var g) ? g : Guid.Empty).Where(g => g != Guid.Empty)
                    .Distinct().Take(BotWaitingRoute.MaxUsers).ToList();
                if (ids.Count == 0) continue;
                var waiting = await FetchAsync(ids, ct);
                if (waiting is null) continue;
                var changed = bots.SyncWaiting(waiting, ids.Select(g => g.ToString()).ToHashSet());
                var group = hub.Clients.Group(OfficeRoomHub.OfficeGroup);
                foreach (var b in changed)
                {
                    await group.BotStatus(b.UserId, b.Activity);
                    await group.BotAlert(b.UserId, OfficeRoomHub.AlertOf(b));
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "Lỗi đồng bộ việc bot chờ người");
            }
        }
    }

    private async Task<List<BotWaiting>?> FetchAsync(List<Guid> ids, CancellationToken ct)
    {
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, BotWaitingRoute.Path) { Content = JsonContent.Create(new BotWaitingQuery(ids), options: Json) };
            req.Headers.Add(AgentMeetingLiveRoute.KeyHeader, settings.Value.RealtimeApiKey);
            using var res = await http.CreateClient(HttpClientName).SendAsync(req, ct);
            if (!res.IsSuccessStatusCode) return Fail($"HTTP {(int)res.StatusCode}");
            var waiting = await res.Content.ReadFromJsonAsync<List<BotWaiting>>(Json, ct);
            if (_failing) log.LogInformation("Đã hỏi lại được việc bot chờ người từ Api");
            _failing = false;
            return waiting ?? [];
        }
        catch (Exception ex) when ((ex is HttpRequestException or TaskCanceledException or JsonException) && !ct.IsCancellationRequested)
        {
            return Fail(ex.Message);
        }
    }

    /// <summary>Chỉ ghi log lần đầu lỗi (tránh tràn log khi Api tắt).</summary>
    private List<BotWaiting>? Fail(string reason)
    {
        if (!_failing) log.LogWarning("Không hỏi được việc bot chờ người từ Api: {Reason}", reason);
        _failing = true;
        return null;
    }
}
