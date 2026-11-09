using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using ModelContextProtocol;
using OfficeHub.BuildingBlocks.Auth;

namespace OfficeHub.Mcp.Infrastructure;

public sealed class McpSettings
{
    public const string Section = "Mcp";
    /// <summary>Địa chỉ nội bộ của OfficeHub.Api (dev: http://localhost:5080, Docker: http://api:8080).</summary>
    public string ApiBaseUrl { get; set; } = "http://localhost:5080";
    /// <summary>Kết quả kiểm tra token được nhớ bao lâu (giây) trước khi hỏi lại Api.</summary>
    public int TokenCacheSeconds { get; set; } = 30;
}

/// <summary>
/// Gọi REST /api/* của OfficeHub.Api bằng CHÍNH token của người dùng → mọi kiểm tra quyền, phân cấp quản lý,
/// danh sách route cho phép (AccessTokenAuth.IsAllowed) do Api quyết định. MCP chỉ là lớp chuyển đổi.
/// Lỗi từ Api (ProblemDetails / ValidationProblem) → McpException với thông điệp tiếng Việt để AI đọc lại cho người dùng.
/// </summary>
public sealed class OfficeHubApi(HttpClient http, IHttpContextAccessor ctx)
{
    public const string HttpClientName = "officehub-api";
    /// <summary>Tool MCP đang chạy (đặt bởi call-tool filter trong Program.cs) → header X-Mcp-Tool cho audit log của Api.</summary>
    public static readonly AsyncLocal<string?> CurrentTool = new();
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = false };

    public Task<JsonNode?> GetAsync(string path, CancellationToken ct) => SendAsync(HttpMethod.Get, path, null, ct);

    public Task<JsonNode?> PostAsync(string path, object? body, CancellationToken ct) => SendAsync(HttpMethod.Post, path, body ?? new { }, ct);

    public Task<JsonNode?> PutAsync(string path, object? body, CancellationToken ct) => SendAsync(HttpMethod.Put, path, body ?? new { }, ct);

    public Task<JsonNode?> DeleteAsync(string path, CancellationToken ct) => SendAsync(HttpMethod.Delete, path, null, ct);

    /// <summary>GET nhưng 404 → null (ví dụ admin không có hồ sơ nhân viên).</summary>
    public async Task<JsonNode?> GetOrNullAsync(string path, CancellationToken ct)
    {
        try { return await GetAsync(path, ct); }
        catch (ApiException e) when (e.Status is HttpStatusCode.NotFound) { return null; }
    }

    private async Task<JsonNode?> SendAsync(HttpMethod method, string path, object? body, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(method, path);
        var http0 = ctx.HttpContext ?? throw new McpException("Không xác định được người dùng");
        req.Headers.Authorization = AuthenticationHeaderValue.Parse(http0.Request.Headers.Authorization.ToString());
        // IP của client AI (để Api ghi vào sự kiện chấm công). Chấm công qua MCP luôn tính "từ xa", IP chỉ để tra cứu.
        if (http0.Connection.RemoteIpAddress is { } ip) req.Headers.TryAddWithoutValidation("X-Forwarded-For", ip.ToString());
        if (CurrentTool.Value is { } tool) req.Headers.TryAddWithoutValidation(AccessTokenAuth.ToolHeader, tool);
        req.Headers.TryAddWithoutValidation("User-Agent", $"OfficeHub.Mcp ({Truncate(http0.Request.Headers.UserAgent.ToString(), 200)})");
        if (body is not null) req.Content = JsonContent.Create(body, options: Json);

        HttpResponseMessage res;
        try { res = await http.SendAsync(req, ct); }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            throw new McpException("Máy chủ OfficeHub đang không phản hồi, thử lại sau ít phút.");
        }

        using (res)
        {
            var text = await res.Content.ReadAsStringAsync(ct);
            if (res.IsSuccessStatusCode) return string.IsNullOrWhiteSpace(text) ? null : JsonNode.Parse(text);
            throw new ApiException(res.StatusCode, ProblemMessage(res.StatusCode, text));
        }
    }

    internal static string ProblemMessage(HttpStatusCode status, string body)
    {
        var parts = new List<string>();
        try
        {
            if (JsonNode.Parse(body) is JsonObject o)
            {
                if (o["errors"] is JsonObject errors)
                    foreach (var (field, msgs) in errors)
                        if (msgs is JsonArray arr) parts.AddRange(arr.Select(m => $"{field}: {m}"));
                if (parts.Count == 0 && o["detail"]?.GetValue<string>() is { Length: > 0 } d) parts.Add(d);
                if (parts.Count == 0 && o["title"]?.GetValue<string>() is { Length: > 0 } t) parts.Add(t);
            }
        }
        catch (JsonException) { /* body không phải JSON */ }

        if (parts.Count > 0) return string.Join("; ", parts);
        return status switch
        {
            HttpStatusCode.Unauthorized => "Token không hợp lệ hoặc đã bị thu hồi. Tạo token mới ở trang Kết nối AI.",
            HttpStatusCode.Forbidden => "Bạn không có quyền thực hiện thao tác này.",
            HttpStatusCode.NotFound => "Không tìm thấy dữ liệu.",
            HttpStatusCode.TooManyRequests => "Gọi quá nhiều lần, thử lại sau ít phút.",
            _ => $"OfficeHub trả lỗi {(int)status}.",
        };
    }

    private static string Truncate(string s, int max) => s.Length <= max ? s : s[..max];
}

public sealed class ApiException(HttpStatusCode status, string message) : McpException(message)
{
    public HttpStatusCode Status { get; } = status;
}
