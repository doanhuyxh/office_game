using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Ai;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Http;

namespace OfficeHub.Mcp.Infrastructure;

/// <summary>
/// <c>POST /mcp/usage</c> (TEST-134): agent-runner gửi chi phí / token của phiên agent bằng token AI của bot → Mcp xác thực tài khoản bot,
/// chuyển lô sang Api (<see cref="AiUsageRoute.Path"/>, khoá <c>Chat__McpToApiKey</c> / <c>Chat__InternalKey</c>) kèm userId của token.
/// Mcp không lưu gì; Api kiểm tra lại toàn bộ.
/// </summary>
public sealed class AiUsageRelay(IHttpClientFactory http, IOptions<ChatSettings> chat, BotPresenceReporter bots, ILogger<AiUsageRelay> log)
{
    /// <summary>Đọc body: thời điểm bắt buộc kèm múi giờ như Api (thiếu → 400, không đoán theo giờ máy chủ).</summary>
    public static readonly JsonSerializerOptions Json = new(OfficeHubApi.Json) { Converters = { new UtcInstantJsonConverter() } };

    public sealed record Outcome(int Status, AiUsageAccepted? Accepted, string? Error);

    public async Task<Outcome> RelayAsync(string authorization, string? clientIp, IReadOnlyList<AiUsageSession?> sessions, CancellationToken ct)
    {
        var key = chat.Value.McpApiKey;
        if (string.IsNullOrEmpty(key)) return new(StatusCodes.Status503ServiceUnavailable, null, "Máy chủ chưa cấu hình khoá nội bộ");
        if (await bots.BotUserIdAsync(authorization, clientIp) is not { } userId)
            return new(StatusCodes.Status403Forbidden, null, "Chỉ tài khoản bot (HR đánh dấu) mới gửi mức dùng AI");

        using var req = new HttpRequestMessage(HttpMethod.Post, AiUsageRoute.Path)
            { Content = JsonContent.Create(new AiUsageBatch(userId, sessions), options: Json) };
        req.Headers.Add(AiUsageRoute.KeyHeader, key);
        using var res = await http.CreateClient(OfficeHubApi.HttpClientName).SendAsync(req, ct);
        if (res.IsSuccessStatusCode)
            return new(StatusCodes.Status200OK, await res.Content.ReadFromJsonAsync<AiUsageAccepted>(Json, ct), null);
        if (res.StatusCode == System.Net.HttpStatusCode.BadRequest)
            return new(StatusCodes.Status400BadRequest, null, await DetailAsync(res, ct) ?? "Dữ liệu không hợp lệ");
        log.LogWarning("Chuyển {Count} phiên mức dùng AI cho Api: {Status}", sessions.Count, (int)res.StatusCode);
        return new(StatusCodes.Status503ServiceUnavailable, null, "Máy chủ OfficeHub không nhận mức dùng AI lúc này, thử lại sau.");
    }

    private static async Task<string?> DetailAsync(HttpResponseMessage res, CancellationToken ct)
    {
        try
        {
            using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
            return doc.RootElement.TryGetProperty("detail", out var d) && d.ValueKind == JsonValueKind.String ? d.GetString() : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
