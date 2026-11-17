using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Ai;
using OfficeHub.BuildingBlocks.Configuration;

namespace OfficeHub.Mcp.Infrastructure;

/// <summary>
/// <c>/mcp/transcripts</c> (TEST-144): agent-runner ghi / đọc lại transcript phiên agent bằng token AI của bot → Mcp xác thực tài khoản bot,
/// chuyển sang Api (<see cref="AgentTranscriptRoute.Path"/>, khoá <c>Chat__McpToApiKey</c> / <c>Chat__InternalKey</c>) kèm userId của token —
/// bot chỉ đọc / ghi bản của chính mình. Mcp không lưu gì; Api kiểm tra lại toàn bộ.
/// </summary>
public sealed class AgentTranscriptRelay(IHttpClientFactory http, IOptions<ChatSettings> chat, BotPresenceReporter bots, ILogger<AgentTranscriptRelay> log)
{
    public sealed record Outcome(int Status, AgentTranscriptDto? Body, string? Error);

    private async Task<(Guid? UserId, Outcome? Fail)> BotAsync(string authorization, string? clientIp)
    {
        if (string.IsNullOrEmpty(chat.Value.McpApiKey)) return (null, new(StatusCodes.Status503ServiceUnavailable, null, "Máy chủ chưa cấu hình khoá nội bộ"));
        return await bots.BotUserIdAsync(authorization, clientIp) is { } id
            ? (id, null)
            : (null, new(StatusCodes.Status403Forbidden, null, "Chỉ tài khoản bot (HR đánh dấu) mới lưu transcript phiên agent"));
    }

    public async Task<Outcome> SaveAsync(string authorization, string? clientIp, AgentTranscriptUpload upload, CancellationToken ct)
    {
        var (userId, fail) = await BotAsync(authorization, clientIp);
        if (fail is not null) return fail;
        using var req = new HttpRequestMessage(HttpMethod.Post, AgentTranscriptRoute.Path)
            { Content = JsonContent.Create(new AgentTranscriptBatch(userId!.Value, upload), options: OfficeHubApi.Json) };
        return await SendAsync(req, ct);
    }

    public async Task<Outcome> ReadAsync(string authorization, string? clientIp, string key, CancellationToken ct)
    {
        var (userId, fail) = await BotAsync(authorization, clientIp);
        if (fail is not null) return fail;
        using var req = new HttpRequestMessage(HttpMethod.Get, $"{AgentTranscriptRoute.Path}?userId={userId}&key={Uri.EscapeDataString(key)}");
        return await SendAsync(req, ct);
    }

    private async Task<Outcome> SendAsync(HttpRequestMessage req, CancellationToken ct)
    {
        req.Headers.Add(AiUsageRoute.KeyHeader, chat.Value.McpApiKey);
        using var res = await http.CreateClient(OfficeHubApi.HttpClientName).SendAsync(req, ct);
        if (res.IsSuccessStatusCode) return new(StatusCodes.Status200OK, await res.Content.ReadFromJsonAsync<AgentTranscriptDto>(OfficeHubApi.Json, ct), null);
        if (res.StatusCode == HttpStatusCode.NotFound) return new(StatusCodes.Status404NotFound, null, "Chưa có transcript cho phiên này");
        if (res.StatusCode == HttpStatusCode.BadRequest) return new(StatusCodes.Status400BadRequest, null, "Dữ liệu transcript không hợp lệ");
        log.LogWarning("Chuyển transcript phiên agent cho Api: {Status}", (int)res.StatusCode);
        return new(StatusCodes.Status503ServiceUnavailable, null, "Máy chủ OfficeHub không nhận transcript lúc này, thử lại sau.");
    }
}
