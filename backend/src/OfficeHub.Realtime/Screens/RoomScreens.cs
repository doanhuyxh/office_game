using System.Collections.Concurrent;
using System.Net;
using System.Text.Json;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Realtime.Auth;

namespace OfficeHub.Realtime.Screens;

/// <summary>
/// Tài liệu đang chiếu trên màn hình một phòng có tường. Url = presigned GET do Api cấp cho NGƯỜI CHIẾU (Api kiểm tra quyền của họ);
/// người trong phòng xem bằng link đó — chiếu = chia sẻ tạm cho người đang ở trong phòng. Kind = AssetKind của Api ("Image", "Video"…).
/// </summary>
/// <param name="Live">Màn hình bot đang làm việc (ảnh chụp cập nhật liên tục — present_screen); FE hiện "trực tiếp · cập nhật lúc …".</param>
public sealed record ScreenDto(string RoomId, string RoomName, string AssetId, string Title, string FileName, string ContentType, string Kind,
    string Url, bool Inline, string ByName, string At, bool Live = false);

/// <summary>
/// Màn hình các phòng (RAM, như Presence). Realtime không đọc DB tài liệu (ranh giới module) → hỏi Api bằng cookie của người chiếu:
/// <c>GET /api/documents/assets/{id}</c> (tiêu đề) + <c>GET /api/documents/assets/{id}/file?present=true</c> (link 3 giờ, Api ghi nhật ký xem).
/// Link hết hạn sau 3 giờ → màn hình tự trống sau <see cref="Lifetime"/>.
/// </summary>
public sealed class RoomScreens(IHttpClientFactory http, TimeProvider clock, ILogger<RoomScreens> log)
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(170);
    private readonly ConcurrentDictionary<string, (ScreenDto Screen, DateTimeOffset Expires)> _screens = new();

    public ScreenDto? Get(string roomId)
    {
        if (!_screens.TryGetValue(roomId, out var s)) return null;
        if (s.Expires > clock.GetUtcNow()) return s.Screen;
        _screens.TryRemove(roomId, out _);
        return null;
    }

    public void Set(ScreenDto screen) => _screens[screen.RoomId] = (screen, clock.GetUtcNow() + Lifetime);
    public bool Clear(string roomId) => _screens.TryRemove(roomId, out _);

    /// <summary>Lấy tài liệu để chiếu bằng quyền của người chiếu. Lỗi → thông báo tiếng Việt cho người chiếu.</summary>
    public async Task<(ScreenDto? Screen, string? Error)> FetchAsync(string? authCookie, Guid assetId, Simulation.Room room, string byName, CancellationToken ct)
    {
        if (authCookie is null) return (null, "Phiên đăng nhập đã hết hiệu lực");
        try
        {
            var client = http.CreateClient(SessionValidator.HttpClientName);
            var (s1, detail) = await GetAsync(client, $"/api/documents/assets/{assetId}", authCookie, ct);
            if (s1 != HttpStatusCode.OK) return (null, ErrorFor(s1));
            var (s2, file) = await GetAsync(client, $"/api/documents/assets/{assetId}/file?present=true", authCookie, ct);
            if (s2 != HttpStatusCode.OK) return (null, ErrorFor(s2));
            var screen = Parse(detail, file, room.Id, room.Name, assetId, byName, Instants.Format(clock.GetUtcNow()));
            return screen is null ? (null, "Không đọc được tài liệu") : (screen, null);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            log.LogWarning("Chiếu tài liệu: không gọi được Api ({Message})", ex.Message);
            return (null, "Máy chủ tài liệu chưa sẵn sàng, thử lại sau");
        }
    }

    private static async Task<(HttpStatusCode, string)> GetAsync(HttpClient client, string path, string cookie, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, path);
        req.Headers.Add("Cookie", cookie);
        using var res = await client.SendAsync(req, ct);
        return (res.StatusCode, await res.Content.ReadAsStringAsync(ct));
    }

    public static string ErrorFor(HttpStatusCode s) => s switch
    {
        HttpStatusCode.NotFound or HttpStatusCode.Forbidden => "Không tìm thấy tài liệu hoặc bạn không có quyền xem",
        HttpStatusCode.Gone => "File đã bị huỷ theo hạn lưu trữ",
        HttpStatusCode.Unauthorized => "Phiên đăng nhập đã hết hiệu lực",
        _ => "Chưa lấy được tài liệu, thử lại sau",
    };

    /// <summary>Ghép body <c>AssetDetailDto</c> + <c>FileUrlDto</c> của Api thành màn hình; thiếu trường / url không phải https|http → null.</summary>
    public static ScreenDto? Parse(string detailJson, string fileJson, string roomId, string roomName, Guid assetId, string byName, string at)
    {
        try
        {
            using var d = JsonDocument.Parse(detailJson);
            using var f = JsonDocument.Parse(fileJson);
            var title = d.RootElement.GetProperty("asset").GetProperty("title").GetString();
            var fr = f.RootElement;
            var url = fr.GetProperty("url").GetString();
            if (title is null || url is null || !Uri.TryCreate(url, UriKind.Absolute, out var u) || (u.Scheme != "https" && u.Scheme != "http")) return null;
            return new ScreenDto(roomId, roomName, assetId.ToString(), title, fr.GetProperty("fileName").GetString() ?? "",
                fr.GetProperty("contentType").GetString() ?? "", fr.GetProperty("kind").GetString() ?? "Other", url,
                fr.GetProperty("inline").GetBoolean(), byName, at);
        }
        catch (Exception ex) when (ex is JsonException or KeyNotFoundException or InvalidOperationException)
        {
            return null;
        }
    }
}
