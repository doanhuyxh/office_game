using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.Extensions.Options;
using OfficeHub.Modules.Assets.Domain;

namespace OfficeHub.Modules.Assets.Infrastructure;

/// <summary>
/// Cấu hình Graph API (tuỳ chọn, có mặc định — không cần thêm vào .env). <c>Facebook__GraphUrl</c> / <c>Facebook__VideoUrl</c> chỉ đổi khi test
/// (script e2e trỏ sang máy chủ giả).
/// </summary>
public sealed class FacebookSettings
{
    public const string Section = "Facebook";
    public string GraphUrl { get; set; } = "https://graph.facebook.com";
    public string VideoUrl { get; set; } = "https://graph-video.facebook.com";
    public string ApiVersion { get; set; } = "v23.0";
}

internal sealed record GraphError(int? HttpStatus, int? Code, int? Subcode, string Message);

internal sealed class GraphException(GraphError error) : Exception(error.Message)
{
    public GraphError Error { get; } = error;
}

internal sealed record FbMe(string Id, string Name);
internal sealed record FbPage(string Id, string Name, string? Category, string? Link, string? PictureUrl, string? AccessToken);
internal sealed record FbPublished(string Id, string? Permalink);
internal sealed record FbMediaRef(SocialMediaKind Kind, string Url);

/// <summary>Các lời gọi Graph API cần cho đăng bài lên Fanpage.</summary>
internal interface IFacebookGraph
{
    /// <summary>Kiểm tra token (System User): trả id + tên.</summary>
    Task<FbMe> MeAsync(string token, CancellationToken ct);

    /// <summary>Các trang System User được giao trong BM (kèm page token).</summary>
    Task<List<FbPage>> PagesAsync(string token, CancellationToken ct);

    /// <summary>Đăng bài: chỉ chữ / link → /feed; 1 ảnh → /photos; nhiều ảnh → tải ẩn từng ảnh rồi /feed + attached_media; 1 video → /videos.</summary>
    Task<FbPublished> PublishAsync(string pageId, string pageToken, string message, string? link, IReadOnlyList<FbMediaRef> media, CancellationToken ct);
}

/// <summary>Gọi Graph API bằng HttpClient. Token đi qua header Authorization (không nằm trong URL → không lọt vào log HTTP).</summary>
internal sealed class FacebookGraph(IHttpClientFactory factory, IOptions<FacebookSettings> options) : IFacebookGraph
{
    public const string HttpClientName = "facebook-graph";
    private readonly FacebookSettings _s = options.Value;

    private string Url(string path, bool video = false) => $"{(video ? _s.VideoUrl : _s.GraphUrl).TrimEnd('/')}/{_s.ApiVersion}/{path.TrimStart('/')}";

    public async Task<FbMe> MeAsync(string token, CancellationToken ct)
    {
        var doc = await SendAsync(HttpMethod.Get, Url("me?fields=id,name"), token, null, ct);
        return new(Str(doc, "id") ?? "", Str(doc, "name") ?? "");
    }

    public async Task<List<FbPage>> PagesAsync(string token, CancellationToken ct)
    {
        var pages = new List<FbPage>();
        string? after = null;
        for (var i = 0; i < 20; i++) // tối đa 2 000 trang
        {
            var path = "me/accounts?fields=id,name,category,link,picture%7Burl%7D,access_token&limit=100" + (after is null ? "" : $"&after={Uri.EscapeDataString(after)}");
            var doc = await SendAsync(HttpMethod.Get, Url(path), token, null, ct);
            if (doc.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array)
                foreach (var p in data.EnumerateArray())
                {
                    var pic = p.TryGetProperty("picture", out var pc) && pc.TryGetProperty("data", out var pd) ? Str(pd, "url") : null;
                    pages.Add(new(Str(p, "id") ?? "", Str(p, "name") ?? "", Str(p, "category"), Str(p, "link"), pic, Str(p, "access_token")));
                }
            after = doc.TryGetProperty("paging", out var paging) && paging.TryGetProperty("next", out _)
                    && paging.TryGetProperty("cursors", out var cur) ? Str(cur, "after") : null;
            if (after is null) break;
        }
        return [.. pages.Where(p => p.Id.Length > 0)];
    }

    public async Task<FbPublished> PublishAsync(string pageId, string pageToken, string message, string? link, IReadOnlyList<FbMediaRef> media,
        CancellationToken ct)
    {
        string id;
        if (media.Count == 1 && media[0].Kind == SocialMediaKind.Video)
        {
            var doc = await PostAsync(Url($"{pageId}/videos", video: true), pageToken, [new("file_url", media[0].Url), new("description", message)], ct);
            id = Str(doc, "id") ?? throw Unexpected();
        }
        else if (media.Count == 1)
        {
            var doc = await PostAsync(Url($"{pageId}/photos"), pageToken, [new("url", media[0].Url), new("caption", message)], ct);
            id = Str(doc, "post_id") ?? Str(doc, "id") ?? throw Unexpected();
        }
        else if (media.Count > 1)
        {
            var fields = new List<KeyValuePair<string, string>> { new("message", message) };
            for (var i = 0; i < media.Count; i++)
            {
                var photo = await PostAsync(Url($"{pageId}/photos"), pageToken, [new("url", media[i].Url), new("published", "false")], ct);
                fields.Add(new($"attached_media[{i}]", JsonSerializer.Serialize(new { media_fbid = Str(photo, "id") ?? throw Unexpected() })));
            }
            id = Str(await PostAsync(Url($"{pageId}/feed"), pageToken, fields, ct), "id") ?? throw Unexpected();
        }
        else
        {
            var fields = new List<KeyValuePair<string, string>> { new("message", message) };
            if (link is not null) fields.Add(new("link", link));
            id = Str(await PostAsync(Url($"{pageId}/feed"), pageToken, fields, ct), "id") ?? throw Unexpected();
        }

        // Link bài: không lấy được không sao (bài đã đăng)
        string? permalink = null;
        try { permalink = Str(await SendAsync(HttpMethod.Get, Url($"{id}?fields=permalink_url"), pageToken, null, ct), "permalink_url"); }
        catch (GraphException) { }
        return new(id, SocialRules.AbsolutePermalink(permalink));
    }

    private static GraphException Unexpected() => new(new(null, null, null, "Facebook trả về dữ liệu không như mong đợi"));

    private Task<JsonElement> PostAsync(string url, string token, List<KeyValuePair<string, string>> fields, CancellationToken ct) =>
        SendAsync(HttpMethod.Post, url, token, new FormUrlEncodedContent(fields), ct);

    private async Task<JsonElement> SendAsync(HttpMethod method, string url, string token, HttpContent? body, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(method, url) { Content = body };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var res = await factory.CreateClient(HttpClientName).SendAsync(req, ct);
        var text = await res.Content.ReadAsStringAsync(ct);
        JsonElement doc;
        try { doc = JsonDocument.Parse(text.Length == 0 ? "{}" : text).RootElement.Clone(); }
        catch (JsonException) { throw new GraphException(new((int)res.StatusCode, null, null, $"Facebook trả về lỗi HTTP {(int)res.StatusCode}")); }
        if (doc.ValueKind == JsonValueKind.Object && doc.TryGetProperty("error", out var err))
        {
            var msg = Str(err, "error_user_msg") ?? Str(err, "message") ?? $"Lỗi HTTP {(int)res.StatusCode}";
            throw new GraphException(new((int)res.StatusCode, Int(err, "code"), Int(err, "error_subcode"), msg));
        }
        if (!res.IsSuccessStatusCode) throw new GraphException(new((int)res.StatusCode, null, null, $"Facebook trả về lỗi HTTP {(int)res.StatusCode}"));
        return doc;
    }

    private static string? Str(JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v)
            ? v.ValueKind switch { JsonValueKind.String => v.GetString(), JsonValueKind.Number => v.GetRawText(), _ => null }
            : null;

    private static int? Int(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var i) ? i : null;
}
