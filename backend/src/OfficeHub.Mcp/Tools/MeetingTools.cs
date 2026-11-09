using System.ComponentModel;
using System.Globalization;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using ModelContextProtocol;
using ModelContextProtocol.Server;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.Mcp.Infrastructure;
using static OfficeHub.Mcp.Tools.ToolHelpers;

namespace OfficeHub.Mcp.Tools;

/// <summary>Đặt phòng họp. Người dùng nói giờ Việt Nam → tool đổi sang thời điểm ISO 8601 kèm múi giờ trước khi gọi Api.</summary>
[McpServerToolType]
public sealed class MeetingTools
{
    [McpServerTool(Name = "list_meeting_rooms", Title = "Phòng họp & tình trạng", ReadOnly = true, OpenWorld = false)]
    [Description("Các phòng họp (id, tên, sức chứa) kèm lịch đang diễn ra và lịch kế tiếp trong hôm nay.")]
    public static async Task<string> ListMeetingRooms(OfficeHubApi api, CancellationToken ct) =>
        Out(await api.GetAsync("/api/meetings/bookings/now", ct));

    [McpServerTool(Name = "list_meetings", Title = "Lịch họp", ReadOnly = true, OpenWorld = false)]
    [Description("Lịch đặt phòng họp trong một ngày (mặc định hôm nay). Thời điểm trả về là UTC (…Z) — đổi sang giờ Việt Nam khi trả lời.")]
    public static async Task<string> ListMeetings(OfficeHubApi api, IOptions<OfficeSettings> office, TimeProvider clock,
        [Description("Ngày yyyy-MM-dd (giờ Việt Nam); bỏ trống = hôm nay")] string? date = null,
        [Description("true = chỉ lịch tôi tổ chức hoặc được mời")] bool mine = false,
        CancellationToken ct = default)
    {
        var tz = TimeZoneInfo.FindSystemTimeZoneById(office.Value.TimeZone);
        var day = string.IsNullOrWhiteSpace(date) ? DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), tz).DateTime)
            : DateOnly.ParseExact(Date(date, "Ngày"), "yyyy-MM-dd", CultureInfo.InvariantCulture);
        var from = Instant(day, TimeOnly.MinValue, tz);
        var to = Instant(day.AddDays(1), TimeOnly.MinValue, tz);
        return Out(await api.GetAsync($"/api/meetings/bookings?from={Q(from)}&to={Q(to)}{(mine ? "&mine=true" : "")}", ct));
    }

    [McpServerTool(Name = "book_meeting_room", Title = "Đặt phòng họp", Destructive = false, OpenWorld = false)]
    [Description("Đặt phòng họp và gửi lời mời (chuông + email) cho người tham gia. Hệ thống chặn trùng giờ. " +
                 "Gọi list_meeting_rooms / list_meetings trước để chọn phòng trống, rồi XÁC NHẬN phòng, ngày, giờ, tiêu đề, người mời với người dùng.")]
    public static async Task<string> BookMeetingRoom(OfficeHubApi api, IOptions<OfficeSettings> office,
        [Description("Phòng: id (vd meeting-large) hoặc tên (vd \"Phòng họp nhỏ\")")] string room,
        [Description("Tiêu đề cuộc họp")] string title,
        [Description("Ngày yyyy-MM-dd (giờ Việt Nam)")] string date,
        [Description("Giờ bắt đầu HH:mm (giờ Việt Nam)")] string startTime,
        [Description("Giờ kết thúc HH:mm (giờ Việt Nam)")] string endTime,
        [Description("Người được mời: mã nhân viên, email hoặc họ tên, cách nhau dấu phẩy (tuỳ chọn)")] string? attendees = null,
        [Description("Ghi chú (tuỳ chọn)")] string? note = null,
        CancellationToken ct = default)
    {
        var tz = TimeZoneInfo.FindSystemTimeZoneById(office.Value.TimeZone);
        var day = DateOnly.ParseExact(Date(date, "Ngày"), "yyyy-MM-dd", CultureInfo.InvariantCulture);
        var roomId = await ResolveRoomAsync(api, room, ct);
        var ids = new List<Guid>();
        foreach (var who in (attendees ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            ids.Add(await ResolveEmployeeAsync(api, who, ct));
        return Out(await api.PostAsync("/api/meetings/bookings", new
        {
            roomId,
            title,
            startAt = Instant(day, Time(startTime, "Giờ bắt đầu"), tz),
            endAt = Instant(day, Time(endTime, "Giờ kết thúc"), tz),
            attendeeIds = ids,
            note,
        }, ct));
    }

    [McpServerTool(Name = "cancel_meeting", Title = "Huỷ lịch họp", Destructive = true, Idempotent = true, OpenWorld = false)]
    [Description("Huỷ lịch họp (chỉ người đặt hoặc HR). Người được mời nhận thông báo huỷ. Hỏi người dùng xác nhận trước khi gọi.")]
    public static async Task<string> CancelMeeting(OfficeHubApi api, [Description("Id lịch họp (từ list_meetings)")] Guid bookingId, CancellationToken ct)
    {
        if (bookingId == Guid.Empty) throw new McpException("Thiếu bookingId");
        await api.DeleteAsync($"/api/meetings/bookings/{bookingId}", ct);
        return Out(new { ok = true });
    }

    /// <summary>Ngày + giờ đồng hồ tại văn phòng → thời điểm ISO 8601 kèm múi giờ (vd 2026-11-07T09:00:00+07:00).</summary>
    internal static string Instant(DateOnly day, TimeOnly time, TimeZoneInfo tz)
    {
        var local = day.ToDateTime(time, DateTimeKind.Unspecified);
        return new DateTimeOffset(local, tz.GetUtcOffset(local)).ToString("yyyy-MM-dd'T'HH:mm:sszzz", CultureInfo.InvariantCulture);
    }

    private static TimeOnly Time(string? value, string label) =>
        TimeOnly.TryParseExact(value?.Trim(), "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var t)
            ? t : throw new McpException($"{label} phải có dạng HH:mm (24 giờ, vd 09:30)");

    private static async Task<string> ResolveRoomAsync(OfficeHubApi api, string room, CancellationToken ct)
    {
        var rooms = (await api.GetAsync("/api/meetings/rooms", ct)) as JsonArray ?? [];
        var key = room.Trim();
        var match = rooms.OfType<JsonObject>().FirstOrDefault(r =>
            string.Equals((string?)r["id"], key, StringComparison.OrdinalIgnoreCase) || string.Equals((string?)r["name"], key, StringComparison.OrdinalIgnoreCase));
        return (string?)match?["id"] ?? throw new McpException(
            $"Không có phòng '{key}'. Phòng hiện có: {string.Join(", ", rooms.OfType<JsonObject>().Select(r => $"{r["id"]} ({r["name"]})"))}");
    }

    /// <summary>Mã nhân viên / email / họ tên → Id nhân viên (dùng chung với ProjectTools).</summary>
    internal static async Task<Guid> ResolveEmployeeAsync(OfficeHubApi api, string who, CancellationToken ct)
    {
        var rows = ((await api.GetAsync($"/api/org/employees?search={Q(who)}", ct)) as JsonArray ?? []).OfType<JsonObject>().ToList();
        var exact = rows.Where(r => string.Equals((string?)r["code"], who, StringComparison.OrdinalIgnoreCase)
                                 || string.Equals((string?)r["email"], who, StringComparison.OrdinalIgnoreCase)
                                 || string.Equals((string?)r["fullName"], who, StringComparison.OrdinalIgnoreCase)).ToList();
        var pick = exact.Count == 1 ? exact[0] : rows.Count == 1 ? rows[0] : null;
        if (pick?["id"] is { } id) return id.GetValue<Guid>();
        if (rows.Count == 0) throw new McpException($"Không tìm thấy nhân viên '{who}'");
        throw new McpException($"'{who}' khớp nhiều người: {string.Join(", ", rows.Take(8).Select(r => $"{r["fullName"]} ({r["code"]})"))}. Dùng mã nhân viên.");
    }
}
