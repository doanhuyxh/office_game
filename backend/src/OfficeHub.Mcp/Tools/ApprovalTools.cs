using System.ComponentModel;
using ModelContextProtocol;
using ModelContextProtocol.Server;
using OfficeHub.Mcp.Infrastructure;
using static OfficeHub.Mcp.Tools.ToolHelpers;

namespace OfficeHub.Mcp.Tools;

/// <summary>Luồng duyệt dùng chung (nghỉ phép, giải trình, tăng ca). Ai được duyệt bước nào do Api quyết định.</summary>
[McpServerToolType]
public sealed class ApprovalTools
{
    [McpServerTool(Name = "list_approval_inbox", Title = "Đơn chờ tôi duyệt", ReadOnly = true, OpenWorld = false)]
    [Description("Các đơn đang chờ TÔI duyệt (quản lý: đơn của cấp dưới; HR: bước HR). Mỗi đơn có id, loại, tiêu đề, tóm tắt, người gửi, các bước.")]
    public static async Task<string> ListApprovalInbox(OfficeHubApi api, CancellationToken ct) =>
        Out(await api.GetAsync("/api/approval/inbox", ct));

    [McpServerTool(Name = "list_my_approval_requests", Title = "Đơn tôi đã gửi", ReadOnly = true, OpenWorld = false)]
    [Description("Tất cả đơn tôi đã gửi (nghỉ phép, giải trình, tăng ca) và tiến độ duyệt từng bước.")]
    public static async Task<string> ListMyApprovalRequests(OfficeHubApi api, CancellationToken ct) =>
        Out(await api.GetAsync("/api/approval/mine", ct));

    [McpServerTool(Name = "get_approval_request", Title = "Chi tiết đơn", ReadOnly = true, OpenWorld = false)]
    [Description("Chi tiết một đơn trong luồng duyệt (các bước, người duyệt, ghi chú, tôi có được duyệt / huỷ không).")]
    public static async Task<string> GetApprovalRequest(OfficeHubApi api, [Description("Id đơn duyệt")] Guid requestId, CancellationToken ct) =>
        Out(await api.GetAsync($"/api/approval/{NotEmpty(requestId)}", ct));

    [McpServerTool(Name = "approve_request", Title = "Duyệt đơn", Destructive = true, Idempotent = false, OpenWorld = false)]
    [Description("DUYỆT một đơn đang chờ tôi. Thao tác có hiệu lực ngay và gửi thông báo cho người gửi. " +
                 "Luôn đọc lại tên người gửi, loại đơn, ngày và hỏi người dùng xác nhận rõ ràng trước khi gọi. Không duyệt hàng loạt khi chưa được yêu cầu.")]
    public static async Task<string> ApproveRequest(OfficeHubApi api,
        [Description("Id đơn duyệt")] Guid requestId,
        [Description("Ghi chú (tuỳ chọn)")] string? comment = null,
        CancellationToken ct = default) =>
        Out(await api.PostAsync($"/api/approval/{NotEmpty(requestId)}/approve", new { comment }, ct));

    [McpServerTool(Name = "reject_request", Title = "Từ chối đơn", Destructive = true, Idempotent = false, OpenWorld = false)]
    [Description("TỪ CHỐI một đơn đang chờ tôi (bắt buộc lý do). Có hiệu lực ngay và gửi thông báo cho người gửi. Hỏi người dùng xác nhận trước khi gọi.")]
    public static async Task<string> RejectRequest(OfficeHubApi api,
        [Description("Id đơn duyệt")] Guid requestId,
        [Description("Lý do từ chối (bắt buộc)")] string comment,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(comment)) throw new McpException("Cần lý do từ chối");
        return Out(await api.PostAsync($"/api/approval/{NotEmpty(requestId)}/reject", new { comment }, ct));
    }

    [McpServerTool(Name = "cancel_my_request", Title = "Huỷ đơn của tôi", Destructive = true, Idempotent = true, OpenWorld = false)]
    [Description("Huỷ một đơn TÔI đã gửi khi đơn còn đang chờ duyệt. Hỏi người dùng xác nhận trước khi gọi.")]
    public static async Task<string> CancelMyRequest(OfficeHubApi api, [Description("Id đơn duyệt")] Guid requestId, CancellationToken ct) =>
        Out(await api.PostAsync($"/api/approval/{NotEmpty(requestId)}/cancel", null, ct));

    private static Guid NotEmpty(Guid id) => id == Guid.Empty ? throw new McpException("Thiếu requestId") : id;
}
