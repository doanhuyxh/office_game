using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Office;
using OfficeHub.Realtime.Hubs;

namespace OfficeHub.Realtime.Simulation;

/// <summary>
/// Họp agent trong văn phòng 3D (TEST-76): mỗi <see cref="AgentMeetingLiveRoute.PollSeconds"/> giây hỏi Api các phiên đang họp
/// (<see cref="AgentMeetingLiveRoute.Path"/>, khoá chiều Realtime → Api) rồi <see cref="BotPresence.SyncMeetings"/> — bot đi vào / rời phòng họp,
/// bong bóng lượt nói. Api lỗi → giữ nguyên trạng thái cũ (không kéo bot ra khỏi phòng), thử lại lần sau.
/// </summary>
public sealed class AgentMeetingWatch(IHttpClientFactory http, IOptions<ChatSettings> settings, BotPresence bots, Presence presence, OfficeMap map,
    IHubContext<OfficeRoomHub, IOfficeClient> hub, TimeProvider clock, ILogger<AgentMeetingWatch> log) : BackgroundService
{
    public const string HttpClientName = "agent-meetings";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private bool _failing;

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(AgentMeetingLiveRoute.PollSeconds));
        while (await timer.WaitForNextTickAsync(ct))
        {
            try
            {
                var live = await FetchAsync(ct);
                if (live is null) continue;
                var (placed, status) = bots.SyncMeetings(live, clock.GetUtcNow());
                var group = hub.Clients.Group(OfficeRoomHub.OfficeGroup);
                foreach (var b in placed)
                    if (!presence.TryGet(b.UserId, out _)) { await group.PlayerLeft(b.UserId); await group.PlayerJoined(OfficeRoomHub.ToDto(b, map)); }
                foreach (var b in status) await group.BotStatus(b.UserId, b.Activity);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "Lỗi đồng bộ bot họp agent");
            }
        }
    }

    private async Task<List<AgentMeetingLive>?> FetchAsync(CancellationToken ct)
    {
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, AgentMeetingLiveRoute.Path);
            req.Headers.Add(AgentMeetingLiveRoute.KeyHeader, settings.Value.RealtimeApiKey);
            using var res = await http.CreateClient(HttpClientName).SendAsync(req, ct);
            if (!res.IsSuccessStatusCode) return Fail($"HTTP {(int)res.StatusCode}");
            var live = await res.Content.ReadFromJsonAsync<List<AgentMeetingLive>>(Json, ct);
            if (_failing) log.LogInformation("Đã hỏi lại được phiên họp agent từ Api");
            _failing = false;
            return live ?? [];
        }
        catch (Exception ex) when ((ex is HttpRequestException or TaskCanceledException or JsonException) && !ct.IsCancellationRequested)
        {
            return Fail(ex.Message);
        }
    }

    /// <summary>Chỉ ghi log lần đầu lỗi (hỏi mỗi 3 giây — tránh tràn log khi Api tắt).</summary>
    private List<AgentMeetingLive>? Fail(string reason)
    {
        if (!_failing) log.LogWarning("Không hỏi được phiên họp agent từ Api: {Reason}", reason);
        _failing = true;
        return null;
    }
}
