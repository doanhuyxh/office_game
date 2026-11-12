using System.Text.Json;
using System.Text.RegularExpressions;

namespace OfficeHub.Modules.Notification.Contracts;

/// <summary>
/// Kênh Telegram đánh thức agent (TEST-42): khi một việc được giao cho tài khoản bot, OfficeHub đưa ĐÚNG MỘT tin vào
/// hàng đợi gửi nhóm Telegram đã cấu hình (trang Hệ thống → Cấu hình). Không làm gì khi kênh tắt / chưa cấu hình / người nhận không phải bot. Không bao giờ ném lỗi (gửi nền, lỗi chỉ ghi log + hàng đợi) — luồng giao việc không bị chặn.
/// </summary>
public interface ITelegramWakeup
{
    Task TaskAssignedAsync(Guid assigneeUserId, string employeeCode, Guid projectId, Guid taskId, string taskCode, CancellationToken ct = default);

    /// <summary>Việc bị trả lại (lùi kèm lý do) cho người làm là bot → cùng tin JSON như giao việc; agent kiểm tra lại việc qua MCP rồi làm lại.</summary>
    Task TaskReturnedAsync(Guid assigneeUserId, string employeeCode, Guid projectId, Guid taskId, string taskCode, CancellationToken ct = default);

    /// <summary>Bot được @mã-nhân-viên trong bình luận việc (TEST-63) → tin <c>event: mentioned</c> + <c>comment_id</c>; agent đọc bình luận và chỉ trả lời bằng bình luận.
    /// Người gọi bỏ tác giả bình luận; người nhận không phải bot / đã khoá → bỏ qua.</summary>
    Task TaskMentionedAsync(Guid userId, string employeeCode, Guid projectId, Guid taskId, string taskCode, Guid commentId, CancellationToken ct = default);

    /// <summary>Nút "Gửi thử": gửi ngay (không qua hàng đợi) một tin thử vào nhóm. Trả (thành công, thông điệp).</summary>
    Task<(bool Ok, string Message)> SendTestAsync(CancellationToken ct = default);
}

/// <summary>Quy tắc chung của kênh Telegram (Notification dựng tin, Settings kiểm tra cấu hình) — hàm thuần, có test.</summary>
public static partial class TelegramRules
{
    /// <summary>Giá trị trường <c>event</c> của tin đánh thức (TEST-63). Tin cũ không có <c>event</c> = <see cref="Assigned"/>.</summary>
    public const string Assigned = "assigned", Returned = "returned", Mentioned = "mentioned";

    /// <summary>
    /// Tin đánh thức: một dòng JSON. Agent đọc nhóm và tự nhận việc theo <c>employee_code</c> (TEST-48: không nhắc bot riêng).
    /// Trường: employee_code, project_id, task_id, task_code, event (<see cref="Assigned"/> / <see cref="Returned"/> / <see cref="Mentioned"/>),
    /// + comment_id khi có bình luận (tin nhắc). KHÔNG có tên / mô tả việc / nội dung bình luận (agent tự đọc qua MCP).
    /// </summary>
    public static string WakeMessage(string employeeCode, Guid projectId, Guid taskId, string taskCode, string @event, Guid? commentId = null)
    {
        var d = new Dictionary<string, string>
        {
            ["employee_code"] = employeeCode, ["project_id"] = projectId.ToString(), ["task_id"] = taskId.ToString(), ["task_code"] = taskCode, ["event"] = @event,
        };
        if (commentId is { } c) d["comment_id"] = c.ToString();
        return JsonSerializer.Serialize(d);
    }

    /// <summary>Chat id: số (nhóm / siêu nhóm "-100…", người dùng) hoặc "@tenkenh".</summary>
    [GeneratedRegex("^(-?[0-9]{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$")]
    public static partial Regex ChatId();

    /// <summary>Bot token dạng "123456789:AA…" (id bot + khoá).</summary>
    [GeneratedRegex("^[0-9]{5,15}:[A-Za-z0-9_-]{30,64}$")]
    public static partial Regex BotToken();
}
