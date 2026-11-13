using System.Collections.Frozen;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using ModelContextProtocol.Server;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Office;

namespace OfficeHub.Mcp.Infrastructure;

/// <summary>
/// Sau mỗi lệnh gọi tool: nếu người gọi là tài khoản bot (<c>/api/auth/me → isBot</c>, HR đánh dấu) thì báo Realtime để hiện bot
/// trong văn phòng 3D (ngồi ở khu phòng ban + dòng "đang làm gì"). Chạy nền, lỗi chỉ ghi log — không bao giờ làm hỏng tool.
/// Thông tin người gọi (bot?, tên, nhân vật, khu) nhớ <see cref="IdentityCacheMinutes"/> phút theo token.
/// </summary>
public sealed class BotPresenceReporter(IHttpClientFactory http, IMemoryCache cache, IOptions<ChatSettings> chat, ILogger<BotPresenceReporter> log)
{
    public const string RealtimeClientName = "officehub-realtime";
    private const int IdentityCacheMinutes = 5;
    /// <summary>
    /// Tool thao tác trên MỘT việc (tham số <c>task</c>) → bot đang làm việc đó, việc ở cột nào cũng vậy (chủ dự án chốt 2026-11-13).
    /// Không đụng việc nào trong <see cref="BotWork.TaskWindowMinutes"/> phút → rảnh.
    /// </summary>
    private static readonly HashSet<string> TaskTools = ["get_task", "update_task_status", "update_task", "comment_task", "list_task_comments"];
    /// <summary>Tên tham số chỉ đối tượng đang thao tác (việc, dự án, tài liệu…) — hiện sau tiêu đề tool.</summary>
    private static readonly string[] TargetArgs = ["task", "project", "document", "request", "meeting", "department", "position", "employee", "place"];

    /// <summary>Tên tool → tiêu đề tiếng Việt (thuộc tính Title của [McpServerTool]).</summary>
    private static readonly FrozenDictionary<string, string> Titles = typeof(BotPresenceReporter).Assembly.GetTypes()
        .SelectMany(t => t.GetMethods(BindingFlags.Public | BindingFlags.Static))
        .Select(m => m.GetCustomAttribute<McpServerToolAttribute>())
        .Where(a => a?.Name is not null)
        .ToFrozenDictionary(a => a!.Name!, a => a!.Title ?? a.Name!);

    private sealed record Caller(Guid UserId, string Name, string? Look, string? Zone);

    /// <summary>Gọi từ call-tool filter; trả ngay (không chờ). Header Authorization phải đọc trước khi request kết thúc.</summary>
    public void Report(string? authorization, string? clientIp, string? tool, IDictionary<string, JsonElement>? args)
    {
        if (string.IsNullOrEmpty(authorization) || string.IsNullOrEmpty(tool) || string.IsNullOrEmpty(chat.Value.McpRealtimeKey)) return;
        var activity = Describe(tool, args);
        _ = Task.Run(async () =>
        {
            try
            {
                if (await GetCallerAsync(authorization, clientIp) is not { } caller) return;
                var (busy, task) = await WorkAsync(authorization, clientIp, tool, args);
                await SendAsync(new BotActivity(caller.UserId, caller.Name, caller.Look, caller.Zone, activity, busy, task));
            }
            catch (Exception e)
            {
                log.LogWarning("Báo bot online cho Realtime thất bại: {Message}", e.Message);
            }
        });
    }

    /// <summary>
    /// agent-runner báo trạng thái (<see cref="BotWork.PresencePath"/>): null = không phải tài khoản bot; false = Realtime không nhận.
    /// </summary>
    public async Task<bool?> ReportPresenceAsync(string authorization, string? clientIp, BotPresenceReport body)
    {
        if (string.IsNullOrEmpty(chat.Value.McpRealtimeKey)) return false;
        if (await GetCallerAsync(authorization, clientIp) is not { } caller) return null;
        var busy = body.State == BotWork.Working;
        var task = busy ? Clip(body.Task, BotWork.MaxTask) : null;
        var activity = busy ? Clip(body.Activity, BotWork.MaxActivity) ?? task ?? "Đang làm việc" : BotWork.IdleBubble;
        return await SendAsync(new BotActivity(caller.UserId, caller.Name, caller.Look, caller.Zone, activity, busy, task, FromRunner: true));
    }

    private static string? Clip(string? s, int max) =>
        string.IsNullOrWhiteSpace(s) ? null : (s = string.Join(' ', s.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries))).Length > max ? s[..max] + "…" : s;

    private async Task<bool> SendAsync(BotActivity activity)
    {
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, BotActivityRoute.Path) { Content = JsonContent.Create(activity, options: OfficeHubApi.Json) };
            req.Headers.Add(BotActivityRoute.KeyHeader, chat.Value.McpRealtimeKey);
            using var res = await http.CreateClient(RealtimeClientName).SendAsync(req);
            if (res.IsSuccessStatusCode) return true;
            log.LogWarning("Báo bot online cho Realtime: {Status}", (int)res.StatusCode);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            log.LogWarning("Báo bot online cho Realtime thất bại: {Message}", e.Message);
        }
        return false;
    }

    /// <summary>
    /// Bot đang làm việc gì: vừa gọi tool trên một việc → nhớ "MÃ · tên" <see cref="BotWork.TaskWindowMinutes"/> phút (mỗi lần đụng việc thì tính lại) → đang làm;
    /// hết hạn → rảnh. Theo token (một tài khoản bot = một agent).
    /// </summary>
    private async Task<(bool? Busy, string? Task)> WorkAsync(string authorization, string? clientIp, string tool, IDictionary<string, JsonElement>? args)
    {
        var key = "work:" + Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(authorization)));
        if (TaskTools.Contains(tool) && args is not null && args.TryGetValue("task", out var v) && v.ValueKind == JsonValueKind.String
            && v.GetString()?.Trim() is { Length: > 0 } task)
        {
            var label = cache.TryGetValue(key, out string? prev) && prev is not null && SameTask(prev, task) ? prev : await TaskLabelAsync(authorization, clientIp, task);
            cache.Set(key, label, TimeSpan.FromMinutes(BotWork.TaskWindowMinutes));
            return (true, label);
        }
        return cache.TryGetValue(key, out string? current) ? (true, current) : (false, null);
    }

    private static bool SameTask(string label, string task) =>
        label.StartsWith(task, StringComparison.OrdinalIgnoreCase);

    /// <summary>"WEB-12 · Tên việc" — id → hỏi Api chi tiết việc; mã → tìm tên trong việc của tôi (không thấy thì chỉ mã). Api lỗi → mã / "Việc".</summary>
    private async Task<string> TaskLabelAsync(string authorization, string? clientIp, string task)
    {
        var api = http.CreateClient(OfficeHubApi.HttpClientName);
        try
        {
            if (Guid.TryParse(task, out var id))
                return LabelOf((await GetJsonAsync(api, $"/api/projects/tasks/{id}", authorization, clientIp))?["task"] as JsonObject) ?? "Việc";
            var code = task.ToUpperInvariant();
            var mine = await GetJsonAsync(api, "/api/projects/tasks/mine", authorization, clientIp) as JsonArray;
            return LabelOf(mine?.OfType<JsonObject>().FirstOrDefault(t => string.Equals(t["code"]?.GetValue<string>(), code, StringComparison.OrdinalIgnoreCase))) ?? code;
        }
        catch (HttpRequestException)
        {
            return Guid.TryParse(task, out _) ? "Việc" : task.ToUpperInvariant();
        }
    }

    internal static string? LabelOf(JsonObject? t)
    {
        if (t?["code"]?.GetValue<string>() is not { Length: > 0 } code) return null;
        var title = t["title"]?.GetValue<string>();
        return Clip(string.IsNullOrWhiteSpace(title) ? code : $"{code} · {title}", BotWork.MaxTask);
    }

    /// <summary>"Chuyển trạng thái việc · WEB-12" — tiêu đề tool + đối tượng (bỏ qua id dạng Guid, cắt 40 ký tự).</summary>
    internal static string Describe(string tool, IDictionary<string, JsonElement>? args)
    {
        var title = Titles.GetValueOrDefault(tool, tool);
        if (args is null) return title;
        // Gửi tin chat / phát biểu trong cuộc họp agent → bong bóng trên đầu bot là chính nội dung tin (như người thật nói trong văn phòng).
        if (tool is "send_chat_message" or "speak_in_meeting" && args.TryGetValue("text", out var t) && t.ValueKind == JsonValueKind.String
            && t.GetString()?.Trim() is { Length: > 0 } said)
            return "💬 " + (said.Length > 80 ? said[..80] + "…" : said);
        if (tool == "present_screen") return "🖥 Đang chiếu màn hình";
        if (tool == "present_markdown") return "📝 Đang trình bày"; // không lặp nội dung trang lên bong bóng
        // Đi lại → "🚶 Phòng họp nhỏ" (ngắn, hiện trên đầu bot khi đang đi)
        if (tool == "go_to" && args.TryGetValue("place", out var pl) && pl.ValueKind == JsonValueKind.String && pl.GetString()?.Trim() is { Length: > 0 } where)
            return "🚶 " + (where.Length > 40 ? where[..40] + "…" : where);
        foreach (var key in TargetArgs)
        {
            if (!args.TryGetValue(key, out var v) || v.ValueKind != JsonValueKind.String) continue;
            var s = v.GetString()?.Trim();
            if (string.IsNullOrEmpty(s) || Guid.TryParse(s, out _)) continue;
            return $"{title} · {(s.Length > 40 ? s[..40] + "…" : s)}";
        }
        return title;
    }

    /// <summary>Hoạt động của người gọi nếu là tài khoản bot (null = không phải bot) — tool go_to dùng để Realtime cho bot online trước khi đi.</summary>
    public async Task<BotActivity?> BotActivityAsync(string authorization, string? clientIp, string activity) =>
        await GetCallerAsync(authorization, clientIp) is { } c ? new BotActivity(c.UserId, c.Name, c.Look, c.Zone, activity) : null;

    /// <summary>null = không phải bot / không xác định được (nhớ cả kết quả "không phải bot" để không hỏi Api mỗi lệnh gọi).</summary>
    private async Task<Caller?> GetCallerAsync(string authorization, string? clientIp)
    {
        var key = "bot:" + Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(authorization)));
        if (cache.TryGetValue(key, out Caller? cached)) return cached;

        var api = http.CreateClient(OfficeHubApi.HttpClientName);
        var me = await GetJsonAsync(api, "/api/auth/me", authorization, clientIp);
        if (me is null) return null; // Api lỗi → không nhớ, lần sau hỏi lại
        Caller? caller = null;
        if (me["isBot"]?.GetValue<bool>() == true && Guid.TryParse(me["id"]?.GetValue<string>(), out var userId))
        {
            var look = me["avatar"] is { } a ? a.ToJsonString() : null;
            caller = new Caller(userId, me["fullName"]?.GetValue<string>() ?? "Bot", look, await ZoneAsync(api, authorization, clientIp));
        }
        cache.Set(key, caller, TimeSpan.FromMinutes(IdentityCacheMinutes));
        return caller;
    }

    /// <summary>Khu bản đồ của phòng ban người gọi; phòng con chưa đặt khu → lấy theo phòng ban cha gần nhất.</summary>
    private static async Task<string?> ZoneAsync(HttpClient api, string authorization, string? clientIp)
    {
        var emp = await GetJsonAsync(api, "/api/org/employees/me", authorization, clientIp);
        if (!Guid.TryParse(emp?["employee"]?["departmentId"]?.GetValue<string>(), out var deptId)) return null;
        if (await GetJsonAsync(api, "/api/org/departments", authorization, clientIp) is not JsonArray depts) return null;
        var byId = depts.OfType<JsonObject>()
            .Where(d => Guid.TryParse(d["id"]?.GetValue<string>(), out _))
            .ToDictionary(d => Guid.Parse(d["id"]!.GetValue<string>()));
        for (var i = 0; i < 20 && byId.TryGetValue(deptId, out var d); i++)
        {
            if (d["mapZone"]?.GetValue<string>() is { Length: > 0 } zone) return zone;
            if (!Guid.TryParse(d["parentId"]?.GetValue<string>(), out deptId)) break;
        }
        return null;
    }

    private static async Task<JsonNode?> GetJsonAsync(HttpClient api, string path, string authorization, string? clientIp)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, path);
        req.Headers.TryAddWithoutValidation("Authorization", authorization);
        if (clientIp is not null) req.Headers.TryAddWithoutValidation("X-Forwarded-For", clientIp);
        req.Headers.TryAddWithoutValidation("User-Agent", "OfficeHub.Mcp (bot presence)");
        using var res = await api.SendAsync(req);
        return res.IsSuccessStatusCode ? JsonNode.Parse(await res.Content.ReadAsStringAsync()) : null;
    }
}
