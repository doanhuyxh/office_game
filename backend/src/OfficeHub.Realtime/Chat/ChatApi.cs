using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.Realtime.Auth;

namespace OfficeHub.Realtime.Chat;

/// <summary>
/// Gọi module Chat của OfficeHub.Api. Gửi / xoá tin dùng COOKIE của chính người dùng (Api kiểm tra quyền); cấp thành viên kênh phòng
/// dùng khoá nội bộ <c>X-Chat-Key</c> (chỉ Realtime biết vị trí thật trong văn phòng 3D). Lỗi → <see cref="HubException"/> tiếng Việt.
/// </summary>
public sealed class ChatApi(IHttpClientFactory http, IOptions<ChatSettings> settings)
{
    public const string OfficeId = "office";
    public const string KeyHeader = "X-Chat-Key";
    public const string Unreachable = "Không kết nối được máy chủ tin nhắn, thử lại sau";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>Id hội thoại của kênh phòng có tường (Api hiểu "room:&lt;id phòng trong bản đồ&gt;").</summary>
    public static string RoomConversation(string mapRoomId) => "room:" + mapRoomId;

    public Task<SendResultDto> SendAsync(string? cookie, string conversationId, string? text, IReadOnlyCollection<Guid>? uploadIds,
        string? clientId, CancellationToken ct)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, $"/api/chat/conversations/{Uri.EscapeDataString(conversationId)}/messages")
        {
            Content = JsonContent.Create(new { text, uploadIds, clientId }, options: Json),
        };
        return CallAsync<SendResultDto>(req, cookie, ct);
    }

    public Task<DeleteResultDto> DeleteAsync(string? cookie, Guid messageId, CancellationToken ct) =>
        CallAsync<DeleteResultDto>(new HttpRequestMessage(HttpMethod.Delete, $"/api/chat/messages/{messageId}"), cookie, ct);

    /// <summary>Báo Api: người dùng đã ở trong phòng này (cấp quyền xem kênh phòng). Idempotent; không gửi cookie.</summary>
    public async Task JoinRoomAsync(string userId, string mapRoomId, CancellationToken ct = default)
    {
        if (!Guid.TryParse(userId, out var id)) throw new HubException("Tài khoản không hợp lệ");
        using var req = new HttpRequestMessage(HttpMethod.Post, $"/api/chat/internal/rooms/{Uri.EscapeDataString(mapRoomId)}/members")
        {
            Content = JsonContent.Create(new { userId = id }, options: Json),
        };
        req.Headers.Add(KeyHeader, settings.Value.InternalKey);
        using var res = await DoAsync(req, ct);
        if (!res.IsSuccessStatusCode) throw await ErrorAsync(res, ct);
    }

    private async Task<T> CallAsync<T>(HttpRequestMessage req, string? cookie, CancellationToken ct)
    {
        using (req)
        {
            if (cookie is null) throw new HubException(SessionWatch.ExpiredReason);
            req.Headers.Add("Cookie", cookie);
            using var res = await DoAsync(req, ct);
            if (!res.IsSuccessStatusCode) throw await ErrorAsync(res, ct);
            try
            {
                return await res.Content.ReadFromJsonAsync<T>(Json, ct) ?? throw new HubException("Máy chủ tin nhắn trả dữ liệu không hợp lệ");
            }
            catch (JsonException)
            {
                throw new HubException("Máy chủ tin nhắn trả dữ liệu không hợp lệ");
            }
        }
    }

    private async Task<HttpResponseMessage> DoAsync(HttpRequestMessage req, CancellationToken ct)
    {
        try
        {
            return await http.CreateClient(SessionValidator.HttpClientName).SendAsync(req, ct);
        }
        catch (Exception ex) when ((ex is HttpRequestException or TaskCanceledException) && !ct.IsCancellationRequested)
        {
            throw new HubException(Unreachable);
        }
    }

    private static async Task<HubException> ErrorAsync(HttpResponseMessage res, CancellationToken ct)
    {
        var detail = DetailOf(await res.Content.ReadAsStringAsync(ct));
        return res.StatusCode switch
        {
            HttpStatusCode.Unauthorized => new HubException(SessionWatch.ExpiredReason),
            HttpStatusCode.Forbidden => new HubException(detail ?? SessionWatch.ExpiredReason),
            HttpStatusCode.TooManyRequests => new HubException(detail ?? "Gửi chậm lại một chút"),
            >= HttpStatusCode.InternalServerError => new HubException(Unreachable),
            _ => new HubException(detail ?? "Không gửi được tin nhắn"),
        };
    }

    /// <summary>Câu tiếng Việt cho người dùng: lỗi field đầu tiên (ValidationProblem) hoặc <c>detail</c> (ProblemDetails).</summary>
    public static string? DetailOf(string body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return null;
            if (root.TryGetProperty("errors", out var errors) && errors.ValueKind == JsonValueKind.Object)
                foreach (var field in errors.EnumerateObject())
                    foreach (var msg in field.Value.EnumerateArray())
                        if (msg.ValueKind == JsonValueKind.String && msg.GetString() is { Length: > 0 } m) return m;
            if (root.TryGetProperty("detail", out var d) && d.ValueKind == JsonValueKind.String && d.GetString() is { Length: > 0 } s) return s;
            return null;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
