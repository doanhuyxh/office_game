using System.ComponentModel;
using System.Text.Json.Nodes;
using ModelContextProtocol;
using ModelContextProtocol.Server;
using OfficeHub.Mcp.Infrastructure;
using static OfficeHub.Mcp.Tools.ToolHelpers;

namespace OfficeHub.Mcp.Tools;

[McpServerToolType]
public sealed class LeaveTools
{
    [McpServerTool(Name = "list_leave_types", Title = "Loại nghỉ phép", ReadOnly = true, OpenWorld = false)]
    [Description("Các loại nghỉ (mã, tên, có lương không, có trừ quỹ phép năm không). Dùng mã hoặc tên khi gửi đơn.")]
    public static async Task<string> ListLeaveTypes(OfficeHubApi api, CancellationToken ct) =>
        Out(await api.GetAsync("/api/leave/types", ct));

    [McpServerTool(Name = "get_leave_balance", Title = "Quỹ phép của tôi", ReadOnly = true, OpenWorld = false)]
    [Description("Quỹ phép năm của tôi: được hưởng năm nay, đã tích luỹ, chuyển từ năm trước, đã dùng, đang chờ duyệt, còn lại (available).")]
    public static async Task<string> GetLeaveBalance(OfficeHubApi api, CancellationToken ct) =>
        Out(await api.GetAsync("/api/leave/balance", ct));

    [McpServerTool(Name = "list_my_leave_requests", Title = "Đơn nghỉ của tôi", ReadOnly = true, OpenWorld = false)]
    [Description("Các đơn nghỉ phép của tôi trong một năm và trạng thái duyệt.")]
    public static async Task<string> ListMyLeaveRequests(OfficeHubApi api,
        [Description("Năm; bỏ trống = năm hiện tại")] int? year = null, CancellationToken ct = default) =>
        Out(await api.GetAsync("/api/leave/requests/my" + (year is { } y ? $"?year={y}" : ""), ct));

    [McpServerTool(Name = "preview_leave", Title = "Xem trước số ngày nghỉ", ReadOnly = true, OpenWorld = false)]
    [Description("Tính số ngày công sẽ bị trừ cho khoảng nghỉ (bỏ cuối tuần, ngày lễ theo lịch làm việc của tôi).")]
    public static async Task<string> PreviewLeave(OfficeHubApi api,
        [Description("Ngày bắt đầu yyyy-MM-dd")] string startDate,
        [Description("Ngày kết thúc yyyy-MM-dd")] string endDate,
        [Description("\"FullDay\" (mặc định), \"Morning\" hoặc \"Afternoon\" — nửa ngày chỉ khi bắt đầu = kết thúc")] string? period = null,
        CancellationToken ct = default) =>
        Out(await api.GetAsync($"/api/leave/preview?startDate={Date(startDate, "Ngày bắt đầu")}&endDate={Date(endDate, "Ngày kết thúc")}" +
                               (string.IsNullOrWhiteSpace(period) ? "" : $"&period={Q(period)}"), ct));

    [McpServerTool(Name = "submit_leave_request", Title = "Gửi đơn nghỉ phép", Destructive = false, OpenWorld = false)]
    [Description("Gửi đơn nghỉ phép (đi qua luồng duyệt quản lý → HR). Nên gọi preview_leave và get_leave_balance trước, " +
                 "rồi XÁC NHẬN loại nghỉ, ngày, buổi và lý do với người dùng trước khi gửi.")]
    public static async Task<string> SubmitLeaveRequest(OfficeHubApi api,
        [Description("Loại nghỉ: mã (ví dụ ANNUAL), tên hoặc id lấy từ list_leave_types")] string leaveType,
        [Description("Ngày bắt đầu yyyy-MM-dd")] string startDate,
        [Description("Ngày kết thúc yyyy-MM-dd")] string endDate,
        [Description("\"FullDay\" (mặc định), \"Morning\" hoặc \"Afternoon\" — nửa ngày chỉ khi bắt đầu = kết thúc")] string? period = null,
        [Description("Lý do")] string? reason = null,
        CancellationToken ct = default)
    {
        var typeId = await ResolveTypeAsync(api, leaveType, ct);
        return Out(await api.PostAsync("/api/leave/requests", new
        {
            leaveTypeId = typeId,
            startDate = Date(startDate, "Ngày bắt đầu"),
            endDate = Date(endDate, "Ngày kết thúc"),
            period = string.IsNullOrWhiteSpace(period) ? "FullDay" : period,
            reason,
        }, ct));
    }

    [McpServerTool(Name = "list_team_leave", Title = "Lịch nghỉ của nhóm", ReadOnly = true, OpenWorld = false)]
    [Description("(Quản lý / HR) Các đơn nghỉ giao với khoảng ngày, của những người tôi được xem (quản lý: bản thân + cấp dưới; HR: tất cả).")]
    public static async Task<string> ListTeamLeave(OfficeHubApi api,
        [Description("Từ ngày yyyy-MM-dd")] string from,
        [Description("Đến ngày yyyy-MM-dd")] string to,
        CancellationToken ct = default) =>
        Out(await api.GetAsync($"/api/leave/requests?from={Date(from, "Từ ngày")}&to={Date(to, "Đến ngày")}", ct));

    private static async Task<Guid> ResolveTypeAsync(OfficeHubApi api, string leaveType, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(leaveType)) throw new McpException("Thiếu loại nghỉ (leaveType)");
        var key = leaveType.Trim();
        if (Guid.TryParse(key, out var id)) return id;
        var types = (await api.GetAsync("/api/leave/types", ct)) as JsonArray ?? [];
        var match = types.OfType<JsonObject>().FirstOrDefault(t =>
            string.Equals((string?)t["code"], key, StringComparison.OrdinalIgnoreCase) ||
            string.Equals((string?)t["name"], key, StringComparison.OrdinalIgnoreCase));
        if (match?["id"] is { } found) return found.GetValue<Guid>();
        var names = string.Join(", ", types.OfType<JsonObject>().Select(t => $"{t["code"]} ({t["name"]})"));
        throw new McpException($"Không có loại nghỉ '{key}'. Các loại hiện có: {names}");
    }
}
