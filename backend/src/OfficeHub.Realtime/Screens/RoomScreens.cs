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
/// <param name="Markdown">Kind = "Markdown" (bot present_markdown): nội dung hiển thị luôn trong DTO, không có Url.</param>
public sealed record ScreenDto(string RoomId, string RoomName, string AssetId, string Title, string FileName, string ContentType, string Kind,
    string Url, bool Inline, string ByName, string At, bool Live = false, string? Markdown = null);

/// <summary>
/// Màn hình các phòng (RAM, như Presence). Realtime không đọc DB tài liệu (ranh giới module) → hỏi Api bằng cookie của người chiếu:
/// <c>GET /api/documents/assets/{id}</c> (tiêu đề) + <c>GET /api/documents/assets/{id}/file?present=true</c> (link 30 phút, Api ghi nhật ký xem).
/// TEST-30: tài liệu người chiếu KHÔNG phát thẳng link S3 cho cả phòng — <c>Url</c> = <c>/rt/screens/doc/{phòng}/{mã}</c>: chỉ người đăng nhập đang
/// đứng trong phòng mở được (<see cref="Hubs.BotScreenEndpoints"/>), chuyển hướng tới link S3 hiện hành; gần hết hạn thì xin link mới bằng phiên
/// người chiếu → họp dài không mất hình, link S3 lộ ra chỉ sống ≤ 30 phút. Màn hình tự trống sau <see cref="Lifetime"/>.
/// </summary>
public sealed class RoomScreens(IHttpClientFactory http, TimeProvider clock, ILogger<RoomScreens> log)
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(170);
    public const string DocPathPrefix = "/rt/screens/doc";
    /// <summary>Link S3 chế độ chiếu sống 30 phút (Api) — xin link mới khi còn dưới ngưỡng này.</summary>
    private static readonly TimeSpan PresignedLife = TimeSpan.FromMinutes(30), RefreshBefore = TimeSpan.FromMinutes(8);
    private readonly ConcurrentDictionary<string, (ScreenDto Screen, DateTimeOffset Expires)> _screens = new();

    /// <summary>Tài liệu người chiếu đang phát qua link Realtime: mã trong URL, phiên người chiếu (để xin link mới), link S3 hiện hành.</summary>
    private sealed class DocShow
    {
        public required string Token { get; init; }
        public required string Cookie { get; init; }
        public required Guid AssetId { get; init; }
        public required string FileUrl { get; set; }
        public required DateTimeOffset FileUrlExpires { get; set; }
        public readonly SemaphoreSlim Gate = new(1, 1);
    }
    private readonly ConcurrentDictionary<string, DocShow> _docs = new();

    public ScreenDto? Get(string roomId)
    {
        if (!_screens.TryGetValue(roomId, out var s)) return null;
        if (s.Expires > clock.GetUtcNow()) return s.Screen;
        _screens.TryRemove(roomId, out _);
        return null;
    }

    public void Set(ScreenDto screen)
    {
        _screens[screen.RoomId] = (screen, clock.GetUtcNow() + Lifetime);
        // Màn hình mới không phải tài liệu đang phát qua link Realtime → bỏ (link cũ hết hiệu lực)
        if (_docs.TryGetValue(screen.RoomId, out var d) && screen.Url != DocUrl(screen.RoomId, d.Token)) _docs.TryRemove(screen.RoomId, out _);
    }

    public bool Clear(string roomId)
    {
        _docs.TryRemove(roomId, out _);
        return _screens.TryRemove(roomId, out _);
    }

    public static string DocUrl(string roomId, string token) => $"{DocPathPrefix}/{roomId}/{token}";

    /// <summary>
    /// Link S3 hiện hành cho người xem (đã kiểm đăng nhập + đang ở trong phòng ở endpoint). Mã sai / đã tắt → null.
    /// Gần hết hạn → xin link mới bằng phiên người chiếu; người chiếu hết phiên / mất quyền → tắt màn hình, null.
    /// </summary>
    public async Task<string?> ResolveDocAsync(string roomId, string token, CancellationToken ct)
    {
        if (Get(roomId) is null || !_docs.TryGetValue(roomId, out var d)
            || !System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(System.Text.Encoding.ASCII.GetBytes(d.Token), System.Text.Encoding.ASCII.GetBytes(token ?? "")))
            return null;
        if (d.FileUrlExpires - clock.GetUtcNow() > RefreshBefore) return d.FileUrl;
        await d.Gate.WaitAsync(ct);
        try
        {
            if (d.FileUrlExpires - clock.GetUtcNow() > RefreshBefore) return d.FileUrl; // người khác vừa làm mới
            var (status, file) = await GetAsync(http.CreateClient(SessionValidator.HttpClientName), $"/api/documents/assets/{d.AssetId}/file?present=true", d.Cookie, ct);
            var url = status == HttpStatusCode.OK ? FileUrlOf(file) : null;
            if (url is null)
            {
                log.LogInformation("Màn hình phòng {Room}: không làm mới được link tài liệu ({Status}) → tắt", roomId, status);
                Clear(roomId);
                return null;
            }
            (d.FileUrl, d.FileUrlExpires) = (url, clock.GetUtcNow() + PresignedLife);
            return url;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            log.LogWarning("Màn hình phòng {Room}: Api không phản hồi khi làm mới link ({Message})", roomId, ex.Message);
            return d.FileUrlExpires > clock.GetUtcNow() ? d.FileUrl : null;
        }
        finally { d.Gate.Release(); }
    }

    private static string? FileUrlOf(string fileJson)
    {
        try
        {
            using var f = JsonDocument.Parse(fileJson);
            var url = f.RootElement.GetProperty("url").GetString();
            return url is not null && Uri.TryCreate(url, UriKind.Absolute, out var u) && (u.Scheme == "https" || u.Scheme == "http") ? url : null;
        }
        catch (Exception ex) when (ex is JsonException or KeyNotFoundException or InvalidOperationException) { return null; }
    }

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
            if (screen is null) return (null, "Không đọc được tài liệu");
            // Phát link Realtime (kiểm người xem) thay cho link S3 (TEST-30)
            var doc = new DocShow
            {
                Token = Convert.ToHexStringLower(System.Security.Cryptography.RandomNumberGenerator.GetBytes(16)), Cookie = authCookie, AssetId = assetId,
                FileUrl = screen.Url, FileUrlExpires = clock.GetUtcNow() + PresignedLife,
            };
            _docs[room.Id] = doc;
            return (screen with { Url = DocUrl(room.Id, doc.Token) }, null);
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
