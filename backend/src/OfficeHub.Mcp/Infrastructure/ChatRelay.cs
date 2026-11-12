using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Office;

namespace OfficeHub.Mcp.Infrastructure;

/// <summary>
/// Bot gửi tin chat qua Api (không qua hub SignalR) → báo Realtime phát tin tới client chat + HUD 3D (<see cref="ChatRelayRoute"/>).
/// Tin đã lưu ở Api nên lỗi ở đây chỉ ghi log: người nhận vẫn thấy tin khi tải lại / mở lại hội thoại.
/// </summary>
public sealed class ChatRelay(IHttpClientFactory http, IOptions<ChatSettings> chat, ILogger<ChatRelay> log)
{
    /// <returns>true = Realtime đã nhận (tin hiện ngay cho người đang mở chat / trong văn phòng 3D).</returns>
    public async Task<bool> PublishAsync(JsonNode sendResult, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(chat.Value.McpRealtimeKey)) return false;
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, ChatRelayRoute.Path)
            {
                Content = new StringContent(sendResult.ToJsonString(), Encoding.UTF8, new MediaTypeHeaderValue("application/json")),
            };
            req.Headers.Add(BotActivityRoute.KeyHeader, chat.Value.McpRealtimeKey);
            using var res = await http.CreateClient(BotPresenceReporter.RealtimeClientName).SendAsync(req, ct);
            if (res.IsSuccessStatusCode) return true;
            log.LogWarning("Chuyển tin chat của bot sang Realtime: {Status}", (int)res.StatusCode);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            log.LogWarning("Chuyển tin chat của bot sang Realtime thất bại: {Message}", e.Message);
        }
        return false;
    }
}
