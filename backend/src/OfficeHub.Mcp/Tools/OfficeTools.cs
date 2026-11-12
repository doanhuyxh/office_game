using System.ComponentModel;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using ModelContextProtocol;
using ModelContextProtocol.Server;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Office;
using OfficeHub.Mcp.Infrastructure;
using static OfficeHub.Mcp.Tools.ToolHelpers;

namespace OfficeHub.Mcp.Tools;

/// <summary>
/// Đi lại trong văn phòng 3D (2026-11-11) — CHỈ tài khoản bot. Bot đi bộ (tìm đường như người) tới phòng / khu phòng ban / bàn của mình /
/// cạnh một người đang online, rồi ở lại đó cho tới lần go_to kế. Vào phòng có tường → thành thành viên kênh chat phòng (theo tài khoản).
/// Realtime giữ bản đồ + vị trí; Mcp chỉ chuyển yêu cầu (khoá nội bộ Chat__InternalKey).
/// </summary>
[McpServerToolType]
public static class OfficeTools
{
    [McpServerTool(Name = "list_office_places", Title = "Các chỗ trong văn phòng 3D", ReadOnly = true, OpenWorld = false)]
    [Description("(Chỉ tài khoản bot) Các chỗ đi tới được bằng go_to: bàn của tôi (desk), phòng (phòng họp, phòng gọi, pantry…), khu phòng ban, " +
                 "người đang có mặt trong văn phòng 3D (kind = person).")]
    public static async Task<string> ListOfficePlaces(BotPresenceReporter reporter, IHttpContextAccessor ctx, IHttpClientFactory http,
        IOptions<ChatSettings> chat, CancellationToken ct)
    {
        var bot = await RequireBotAsync(reporter, ctx, "Xem các chỗ trong văn phòng");
        using var req = new HttpRequestMessage(HttpMethod.Get, $"{BotMoveRoute.PlacesPath}?userId={bot.UserId}");
        req.Headers.Add(BotActivityRoute.KeyHeader, RequireKey(chat));
        using var res = await http.CreateClient(BotPresenceReporter.RealtimeClientName).SendAsync(req, ct);
        if (!res.IsSuccessStatusCode) throw new McpException($"Văn phòng 3D chưa sẵn sàng (Realtime trả {(int)res.StatusCode})");
        return await res.Content.ReadAsStringAsync(ct);
    }

    [McpServerTool(Name = "go_to", Title = "Đi tới chỗ trong văn phòng 3D", Destructive = false, Idempotent = true, OpenWorld = false)]
    [Description("(Chỉ tài khoản bot) Đi bộ trong văn phòng 3D tới một chỗ rồi ở lại đó cho tới lần go_to kế: tên / id phòng (vd \"Phòng họp nhỏ\"), " +
                 "khu phòng ban (vd \"Kỹ thuật\"), \"bàn của tôi\", hoặc tên một người đang trong văn phòng (đứng cạnh họ). Không chắc tên → list_office_places. " +
                 "Vào phòng có tường → đọc / nhắn được kênh chat của phòng đó (list_chats). Người thật của tài khoản đang trong văn phòng → không đi được.")]
    public static async Task<string> GoTo(BotPresenceReporter reporter, IHttpContextAccessor ctx, IHttpClientFactory http, IOptions<ChatSettings> chat,
        [Description("Chỗ cần tới: tên / id phòng, khu phòng ban, \"bàn của tôi\", hoặc tên người")] string place,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(place)) throw new McpException("Thiếu chỗ cần tới (place)");
        var bot = await RequireBotAsync(reporter, ctx, $"Đi tới {place.Trim()}");
        using var req = new HttpRequestMessage(HttpMethod.Post, BotMoveRoute.Path)
        {
            Content = JsonContent.Create(new BotMove(bot, place.Trim()), options: OfficeHubApi.Json),
        };
        req.Headers.Add(BotActivityRoute.KeyHeader, RequireKey(chat));
        using var res = await http.CreateClient(BotPresenceReporter.RealtimeClientName).SendAsync(req, ct);
        var text = await res.Content.ReadAsStringAsync(ct);
        if (res.IsSuccessStatusCode) return text;
        var node = JsonNode.Parse(text.Length > 0 ? text : "{}");
        var msg = (string?)node?["detail"] ?? (string?)node?["title"] ?? $"Realtime trả {(int)res.StatusCode}"; // ProblemDetails: lý do ở detail
        if (res.StatusCode == HttpStatusCode.NotFound && node?["places"] is JsonArray list)
            msg += ". Các chỗ: " + string.Join(", ", list.OfType<JsonObject>().Select(p => $"{p["name"]} ({p["kind"]})"));
        throw new McpException(msg);
    }

    [McpServerTool(Name = "present_screen", Title = "Chiếu màn hình đang làm việc", Destructive = false, Idempotent = false, OpenWorld = false)]
    [Description("(Chỉ tài khoản bot, đang ngồi / đứng trong một phòng có tường — go_to phòng họp trước) Chiếu ảnh chụp màn hình nơi bạn đang làm việc " +
                 "(trình duyệt, editor, máy ảo…) lên TV của phòng: chỉ người đang ở trong phòng thấy. Gọi lại với ảnh mới để cập nhật (≥ 3 giây / ảnh) — " +
                 "người xem thấy như chia sẻ màn hình gần trực tiếp. Ảnh PNG / JPEG / WebP ≤ 2 MB, base64 (có thể kèm tiền tố data:image/…;base64,). " +
                 "CHỈ chiếu khi được nhờ hoặc đang trình bày trong cuộc họp; che / không chiếu mật khẩu, token, dữ liệu cá nhân. Xong → stop_presenting.")]
    public static async Task<string> PresentScreen(BotPresenceReporter reporter, IHttpContextAccessor ctx, IHttpClientFactory http, IOptions<ChatSettings> chat,
        [Description("Ảnh chụp màn hình (base64 PNG / JPEG / WebP, ≤ 2 MB)")] string image,
        [Description("Chú thích ngắn hiện trên khung (vd \"Đang sửa lỗi đăng nhập — WEB-12\")")] string? caption = null,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(image)) throw new McpException("Thiếu ảnh màn hình (image)");
        var bot = await RequireBotAsync(reporter, ctx, "🖥 Đang chiếu màn hình");
        return await SendScreenAsync(http, chat, new BotScreenRequest(bot, "frame", image, caption), ct);
    }

    [McpServerTool(Name = "present_markdown", Title = "Trình bày nội dung (Markdown) lên TV phòng họp", Destructive = false, Idempotent = false, OpenWorld = false)]
    [Description("(Chỉ tài khoản bot, đang ở trong một phòng có tường — go_to phòng họp trước) Hiện một trang Markdown (GFM: tiêu đề, danh sách, checklist, " +
                 "bảng, khối code) lên TV của phòng: chỉ người đang ở trong phòng thấy, nhãn \"● Trực tiếp\". Cách trình bày CHÍNH khi họp / báo cáo tiến độ: " +
                 "rẻ hơn ảnh rất nhiều. Gọi lại với nội dung mới (≥ 1 giây / lần) để cập nhật — vd tick checklist khi xong từng bước, thêm dòng log, đổi đoạn code. " +
                 "Mỗi lần gửi TOÀN BỘ trang (thay trang cũ), ≤ 20.000 ký tự; không hiện ảnh nhúng. Không đưa mật khẩu, token, dữ liệu cá nhân. Xong → stop_presenting.")]
    public static async Task<string> PresentMarkdown(BotPresenceReporter reporter, IHttpContextAccessor ctx, IHttpClientFactory http, IOptions<ChatSettings> chat,
        [Description("Nội dung Markdown cả trang (≤ 20.000 ký tự)")] string content,
        [Description("Tiêu đề ngắn trên khung (vd \"Tiến độ WEB-12\"); bỏ trống = \"<tên bot> đang trình bày\"")] string? title = null,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(content)) throw new McpException("Thiếu nội dung trình bày (content)");
        var bot = await RequireBotAsync(reporter, ctx, "📝 Đang trình bày");
        return await SendScreenAsync(http, chat, new BotScreenRequest(bot, "markdown", Caption: title, Markdown: content), ct);
    }

    [McpServerTool(Name = "present_document", Title = "Chiếu tài liệu lên TV phòng họp", Destructive = false, Idempotent = true, OpenWorld = false)]
    [Description("(Chỉ tài khoản bot, đang ở trong một phòng có tường) Chiếu một tài liệu trong kho (ảnh, PDF, video…) lên TV của phòng — như người bấm \"Chiếu\". " +
                 "Bot phải có quyền xem tài liệu; mỗi lần chiếu được ghi vào nhật ký xem của tài liệu.")]
    public static async Task<string> PresentDocument(OfficeHubApi api, BotPresenceReporter reporter, IHttpContextAccessor ctx, IHttpClientFactory http,
        IOptions<ChatSettings> chat,
        [Description("Tài liệu: id, mã (TL-…) hoặc số hiệu ban hành")] string document,
        CancellationToken ct = default)
    {
        var bot = await RequireBotAsync(reporter, ctx, "📺 Chiếu tài liệu");
        var id = await DocumentTools.ResolveDocumentAsync(api, document, ct);
        var detail = await api.GetAsync($"/api/documents/assets/{id}", ct);
        var file = await api.GetAsync($"/api/documents/assets/{id}/file?present=true", ct);
        return await SendScreenAsync(http, chat, new BotScreenRequest(bot, "document", DetailJson: detail?.ToJsonString(), FileJson: file?.ToJsonString()), ct);
    }

    [McpServerTool(Name = "stop_presenting", Title = "Tắt chiếu", Destructive = false, Idempotent = true, OpenWorld = false)]
    [Description("(Chỉ tài khoản bot) Tắt màn hình / tài liệu bot đang chiếu ở phòng mình đang ở. Rời phòng (go_to chỗ khác) cũng tự tắt.")]
    public static async Task<string> StopPresenting(BotPresenceReporter reporter, IHttpContextAccessor ctx, IHttpClientFactory http, IOptions<ChatSettings> chat,
        CancellationToken ct = default)
    {
        var bot = await RequireBotAsync(reporter, ctx, "Tắt chiếu");
        return await SendScreenAsync(http, chat, new BotScreenRequest(bot, "stop"), ct);
    }

    private static async Task<string> SendScreenAsync(IHttpClientFactory http, IOptions<ChatSettings> chat, BotScreenRequest body, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, BotScreenRoute.Path) { Content = JsonContent.Create(body, options: OfficeHubApi.Json) };
        req.Headers.Add(BotActivityRoute.KeyHeader, RequireKey(chat));
        using var res = await http.CreateClient(BotPresenceReporter.RealtimeClientName).SendAsync(req, ct);
        var text = await res.Content.ReadAsStringAsync(ct);
        if (res.IsSuccessStatusCode) return text;
        var node = JsonNode.Parse(text.Length > 0 ? text : "{}");
        throw new McpException((string?)node?["detail"] ?? (string?)node?["title"] ?? $"Realtime trả {(int)res.StatusCode}");
    }

    private static async Task<BotActivity> RequireBotAsync(BotPresenceReporter reporter, IHttpContextAccessor ctx, string activity)
    {
        var http = ctx.HttpContext ?? throw new McpException("Thiếu ngữ cảnh yêu cầu");
        return await reporter.BotActivityAsync(http.Request.Headers.Authorization.ToString(), http.Connection.RemoteIpAddress?.ToString(), activity)
               ?? throw new McpException("Chỉ tài khoản bot (HR đánh dấu) đi lại được trong văn phòng 3D");
    }

    private static string RequireKey(IOptions<ChatSettings> chat) =>
        string.IsNullOrEmpty(chat.Value.McpRealtimeKey) ? throw new McpException("Văn phòng 3D chưa bật cho bot (thiếu Chat__InternalKey / Chat__McpToRealtimeKey)") : chat.Value.McpRealtimeKey;
}
