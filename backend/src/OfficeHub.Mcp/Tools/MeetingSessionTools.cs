using System.ComponentModel;
using System.Text.Json.Nodes;
using ModelContextProtocol;
using ModelContextProtocol.Server;
using OfficeHub.Mcp.Infrastructure;
using static OfficeHub.Mcp.Tools.ToolHelpers;

namespace OfficeHub.Mcp.Tools;

/// <summary>
/// Cuộc họp agent (TEST-82, sau TEST-74 phiên họp + TEST-75 lượt nói) — CHỈ tài khoản bot đang dự phiên; người thật gọi → Api trả 403.
/// Không có tool mở / dừng họp (chỉ người thật trên web). Phát biểu = tin trong kênh phòng họp (POST chat như send_chat_message, Api chặn khi
/// không giữ lượt); bỏ lượt / chỉ định lượt gọi /api/meetings/sessions/{id}/pass|assign. Mọi kiểm tra lượt do Api quyết định.
/// </summary>
[McpServerToolType]
public static class MeetingSessionTools
{
    [McpServerTool(Name = "get_my_meeting", Title = "Cuộc họp agent của tôi", ReadOnly = true, OpenWorld = false)]
    [Description("(Chỉ tài khoản bot) Cuộc họp agent đang diễn ra mà tôi dự: chủ đề, phòng, kênh chat của phòng (conversation — dùng cho read_chat), " +
                 "tôi có phải chủ trì, ai đang giữ lượt, có phải lượt tôi (isMyTurn), hạn nói của lượt (quá hạn = coi như bỏ lượt), lượt đã dùng / trần, " +
                 "phút còn lại, danh sách bot dự (mã, tên, phòng ban, chức vụ, thứ tự chờ). Nhận meeting_turn → gọi tool này trước. inMeeting = false → không họp.")]
    public static async Task<string> GetMyMeeting(OfficeHubApi api, TimeProvider clock, CancellationToken ct)
    {
        var mine = await api.GetAsync("/api/meetings/sessions/mine", ct);
        if (mine?["session"] is not JsonObject s) return Out(new JsonObject { ["inMeeting"] = false });
        var attendees = (mine["attendees"] as JsonArray ?? []).OfType<JsonObject>().ToList();
        var speaker = attendees.FirstOrDefault(a => a["isSpeaking"]?.GetValue<bool>() == true);
        var expiresAt = s["expiresAt"]?.GetValue<DateTimeOffset>();
        return Out(new JsonObject
        {
            ["inMeeting"] = true,
            ["sessionId"] = s["id"]?.DeepClone(),
            ["topic"] = s["topic"]?.DeepClone(),
            ["roomId"] = s["roomId"]?.DeepClone(),
            ["roomName"] = s["roomName"]?.DeepClone(),
            ["conversation"] = mine["conversationId"]?.DeepClone(),
            ["isChair"] = mine["isChair"]?.DeepClone(),
            ["isMyTurn"] = s["isMyTurn"]?.DeepClone(),
            ["currentSpeaker"] = speaker is null ? null : new JsonObject { ["code"] = speaker["code"]?.DeepClone(), ["name"] = speaker["name"]?.DeepClone() },
            ["turnDeadline"] = s["turnDeadline"]?.DeepClone(),
            ["turnsUsed"] = s["turnsUsed"]?.DeepClone(),
            ["maxTurns"] = s["maxTurns"]?.DeepClone(),
            ["minutesLeft"] = expiresAt is { } e ? Math.Max(0, (int)Math.Ceiling((e - clock.GetUtcNow()).TotalMinutes)) : null,
            ["expiresAt"] = s["expiresAt"]?.DeepClone(),
            ["openedBy"] = s["openedByName"]?.DeepClone(),
            ["bots"] = new JsonArray(attendees.Select(a => (JsonNode?)new JsonObject
            {
                ["code"] = a["code"]?.DeepClone(),
                ["name"] = a["name"]?.DeepClone(),
                ["department"] = a["departmentName"]?.DeepClone(),
                ["position"] = a["positionName"]?.DeepClone(),
                ["isChair"] = a["isChair"]?.DeepClone(),
                ["isSpeaking"] = a["isSpeaking"]?.DeepClone(),
                ["queuePosition"] = a["queuePosition"]?.DeepClone(),
            }).ToArray()),
        });
    }

    [McpServerTool(Name = "speak_in_meeting", Title = "Phát biểu trong cuộc họp", Destructive = false, Idempotent = false, OpenWorld = false)]
    [Description("(Chỉ tài khoản bot) Phát biểu MỘT tin (≤ 1000 ký tự) vào kênh phòng họp khi đang giữ lượt — mỗi lượt một tin, tính 1 lượt. " +
                 "next = mã bot dự họp được mời nói kế (tự chèn @mã); không có next → lượt sang bot đang chờ, hết hàng chờ → về chủ trì. " +
                 "Không giữ lượt → lỗi nêu ai đang giữ. Tin hiện nhãn BOT trong chat + bong bóng trên đầu bot ở văn phòng 3D.")]
    public static async Task<string> SpeakInMeeting(OfficeHubApi api, ChatRelay relay,
        [Description("Nội dung phát biểu (≤ 1000 ký tự), ngắn gọn, có số liệu từ tool của mình")] string text,
        [Description("Mã bot dự họp được mời nói kế (vd NV021), tuỳ chọn")] string? next = null,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(text)) throw new McpException("Thiếu nội dung phát biểu");
        var (session, conversation, attendees) = await CurrentAsync(api, ct);
        RequireTurn(session, attendees);
        var body = text.Trim();
        if (!string.IsNullOrWhiteSpace(next))
        {
            var code = (string?)Attendee(attendees, next)["code"];
            if (!body.Contains("@" + code, StringComparison.OrdinalIgnoreCase)) body = $"{body} @{code}";
        }
        var result = await api.PostAsync($"/api/chat/conversations/{conversation}/messages", new JsonObject
        {
            ["text"] = body,
            ["clientId"] = "mcp-" + Guid.NewGuid().ToString("N"),
        }, ct) ?? throw new McpException("Api không trả kết quả");
        var live = await relay.PublishAsync(result, ct);
        var m = result["message"];
        return Out(new JsonObject
        {
            ["sent"] = true,
            ["messageId"] = m?["id"]?.DeepClone(),
            ["seq"] = m?["seq"]?.DeepClone(),
            ["createdAt"] = m?["createdAt"]?.DeepClone(),
            ["deliveredLive"] = live,
        });
    }

    [McpServerTool(Name = "pass_turn", Title = "Bỏ lượt trong cuộc họp", Destructive = false, Idempotent = false, OpenWorld = false)]
    [Description("(Chỉ tài khoản bot) Bỏ lượt khi đang giữ lượt mà không có gì để nói — tính 1 lượt, lượt sang bot đang chờ / chủ trì. " +
                 "Chủ trì bỏ lượt khi không ai chờ → cuộc họp kết thúc (không còn ai phát biểu).")]
    public static async Task<string> PassTurn(OfficeHubApi api, CancellationToken ct)
    {
        var (session, _, attendees) = await CurrentAsync(api, ct);
        RequireTurn(session, attendees);
        return Out(TurnResult(await api.PostAsync($"/api/meetings/sessions/{session["id"]}/pass", null, ct)));
    }

    [McpServerTool(Name = "assign_turn", Title = "Chỉ định lượt nói (chủ trì)", Destructive = false, Idempotent = false, OpenWorld = false)]
    [Description("(Chỉ bot chủ trì, đang giữ lượt) Chỉ định bot dự họp khác nói kế mà không cần phát biểu — tính 1 lượt. " +
                 "Muốn vừa nói vừa mời người kế → dùng speak_in_meeting với next.")]
    public static async Task<string> AssignTurn(OfficeHubApi api,
        [Description("Bot dự họp nói kế: mã (vd NV021) hoặc họ tên")] string to,
        CancellationToken ct = default)
    {
        var (session, _, attendees) = await CurrentAsync(api, ct);
        var target = Attendee(attendees, to);
        return Out(TurnResult(await api.PostAsync($"/api/meetings/sessions/{session["id"]}/assign",
            new JsonObject { ["employeeId"] = target["employeeId"]?.DeepClone() }, ct)));
    }

    /// <summary>Phiên đang họp của bot gọi (Api /sessions/mine); không dự phiên nào / phòng chưa có kênh → lỗi rõ ràng.</summary>
    private static async Task<(JsonObject Session, string Conversation, List<JsonObject> Attendees)> CurrentAsync(OfficeHubApi api, CancellationToken ct)
    {
        var mine = await api.GetAsync("/api/meetings/sessions/mine", ct);
        if (mine?["session"] is not JsonObject s) throw new McpException("Bạn không dự cuộc họp agent nào đang diễn ra");
        var conv = (string?)mine["conversationId"] ?? throw new McpException("Phòng họp chưa có kênh chat — báo người mở họp");
        return (s, conv, (mine["attendees"] as JsonArray ?? []).OfType<JsonObject>().ToList());
    }

    /// <summary>Chưa tới lượt → lỗi nêu ai đang giữ (Api vẫn chặn lần cuối — 409).</summary>
    internal static void RequireTurn(JsonObject session, IReadOnlyList<JsonObject> attendees)
    {
        if (session["isMyTurn"]?.GetValue<bool>() == true) return;
        var holder = attendees.FirstOrDefault(a => a["isSpeaking"]?.GetValue<bool>() == true);
        throw new McpException(holder is null
            ? "Chưa tới lượt của bạn — chưa ai giữ lượt, chờ chủ trì chỉ định"
            : $"Chưa tới lượt của bạn — đang là lượt của {holder["name"]} ({holder["code"]}). Chờ meeting_turn rồi gọi get_my_meeting");
    }

    /// <summary>Bot dự họp theo mã (không phân biệt hoa thường, bỏ @) hoặc họ tên; không khớp → lỗi liệt kê bot dự.</summary>
    internal static JsonObject Attendee(IReadOnlyList<JsonObject> attendees, string who)
    {
        var key = who.Trim().TrimStart('@');
        return attendees.FirstOrDefault(a => string.Equals((string?)a["code"], key, StringComparison.OrdinalIgnoreCase))
            ?? attendees.FirstOrDefault(a => string.Equals((string?)a["name"], key, StringComparison.OrdinalIgnoreCase))
            ?? throw new McpException($"'{key}' không dự cuộc họp này. Bot dự họp: {string.Join(", ", attendees.Select(a => $"{a["name"]} ({a["code"]})"))}");
    }

    private static JsonObject TurnResult(JsonNode? s) => new()
    {
        ["ok"] = true,
        ["status"] = s?["status"]?.DeepClone(),
        ["endReason"] = s?["endReason"]?.DeepClone(),
        ["turnsUsed"] = s?["turnsUsed"]?.DeepClone(),
        ["maxTurns"] = s?["maxTurns"]?.DeepClone(),
        ["currentSpeaker"] = (s?["bots"] as JsonArray ?? []).OfType<JsonObject>().FirstOrDefault(b => b["isSpeaking"]?.GetValue<bool>() == true)?["name"]?.DeepClone(),
    };
}
