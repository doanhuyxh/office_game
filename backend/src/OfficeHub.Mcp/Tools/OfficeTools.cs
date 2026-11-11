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

    private static async Task<BotActivity> RequireBotAsync(BotPresenceReporter reporter, IHttpContextAccessor ctx, string activity)
    {
        var http = ctx.HttpContext ?? throw new McpException("Thiếu ngữ cảnh yêu cầu");
        return await reporter.BotActivityAsync(http.Request.Headers.Authorization.ToString(), http.Connection.RemoteIpAddress?.ToString(), activity)
               ?? throw new McpException("Chỉ tài khoản bot (HR đánh dấu) đi lại được trong văn phòng 3D");
    }

    private static string RequireKey(IOptions<ChatSettings> chat) =>
        string.IsNullOrEmpty(chat.Value.InternalKey) ? throw new McpException("Văn phòng 3D chưa bật cho bot (thiếu Chat__InternalKey)") : chat.Value.InternalKey;
}
