using System.ComponentModel;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using ModelContextProtocol.Server;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.Mcp.Infrastructure;
using static OfficeHub.Mcp.Tools.ToolHelpers;

namespace OfficeHub.Mcp.Tools;

[McpServerToolType]
public sealed class ProfileTools
{
    [McpServerTool(Name = "get_my_profile", Title = "Thông tin của tôi", ReadOnly = true, OpenWorld = false)]
    [Description("Thông tin người đang kết nối: tài khoản, vai trò (employee / manager / hr / admin), hồ sơ nhân viên " +
                 "(mã, phòng ban, chức vụ, quản lý trực tiếp) và ngày giờ hiện tại theo giờ Việt Nam. Gọi đầu tiên khi cần biết " +
                 "'hôm nay' là ngày nào hoặc người dùng có quyền gì.")]
    public static async Task<string> GetMyProfile(OfficeHubApi api, IOptions<OfficeSettings> office, TimeProvider clock, CancellationToken ct)
    {
        var me = await api.GetAsync("/api/auth/me", ct);
        var employee = await api.GetOrNullAsync("/api/org/employees/me", ct);
        var tz = TimeZoneInfo.FindSystemTimeZoneById(office.Value.TimeZone);
        var now = TimeZoneInfo.ConvertTime(clock.GetUtcNow(), tz);
        return Out(new JsonObject
        {
            ["account"] = WithoutAvatar(me),
            ["employee"] = employee?["employee"]?.DeepClone(),
            ["now"] = now.ToString("yyyy-MM-dd'T'HH:mm:sszzz"),
            ["weekday"] = now.ToString("dddd", new System.Globalization.CultureInfo("vi-VN")),
            ["timeZone"] = office.Value.TimeZone,
        });
    }

    [McpServerTool(Name = "list_notifications", Title = "Thông báo của tôi", ReadOnly = true, OpenWorld = false)]
    [Description("Thông báo trong chuông OfficeHub (mới nhất trước) kèm số chưa đọc.")]
    public static async Task<string> ListNotifications(OfficeHubApi api,
        [Description("Số thông báo lấy về (1–100, mặc định 20)")] int take = 20, CancellationToken ct = default) =>
        Out(await api.GetAsync($"/api/notifications?take={Math.Clamp(take, 1, 100)}", ct));

    [McpServerTool(Name = "mark_notifications_read", Title = "Đánh dấu đã đọc", Idempotent = true, Destructive = false, OpenWorld = false)]
    [Description("Đánh dấu một thông báo (truyền notificationId) hoặc TẤT CẢ thông báo (bỏ trống) là đã đọc.")]
    public static async Task<string> MarkNotificationsRead(OfficeHubApi api,
        [Description("Id thông báo; bỏ trống = đánh dấu tất cả")] Guid? notificationId = null, CancellationToken ct = default)
    {
        await api.PostAsync(notificationId is { } id ? $"/api/notifications/{id}/read" : "/api/notifications/read-all", null, ct);
        return Out(new { ok = true });
    }

    /// <summary>Ngoại hình nhân vật 3D (avatar) không có ích cho AI → bỏ khỏi thông tin tài khoản.</summary>
    private static JsonNode? WithoutAvatar(JsonNode? me)
    {
        var copy = me?.DeepClone();
        (copy as JsonObject)?.Remove("avatar");
        return copy;
    }
}
