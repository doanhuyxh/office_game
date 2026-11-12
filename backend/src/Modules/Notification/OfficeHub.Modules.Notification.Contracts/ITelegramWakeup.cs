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

    /// <summary>Nút "Gửi thử": gửi ngay (không qua hàng đợi) một tin thử vào nhóm. Trả (thành công, thông điệp).</summary>
    Task<(bool Ok, string Message)> SendTestAsync(CancellationToken ct = default);
}

/// <summary>Quy tắc chung của kênh Telegram (Notification dựng tin, Settings kiểm tra cấu hình) — hàm thuần, có test.</summary>
public static partial class TelegramRules
{
    /// <summary>
    /// Tin đánh thức: một dòng JSON đúng 4 trường. Agent đọc nhóm và tự nhận việc theo <c>employee_code</c> (TEST-48: không nhắc bot riêng).
    /// KHÔNG có tên / mô tả việc (agent tự đọc qua MCP).
    /// </summary>
    public static string WakeMessage(string employeeCode, Guid projectId, Guid taskId, string taskCode) =>
        JsonSerializer.Serialize(new Dictionary<string, string>
        {
            ["employee_code"] = employeeCode, ["project_id"] = projectId.ToString(), ["task_id"] = taskId.ToString(), ["task_code"] = taskCode,
        });

    /// <summary>Chat id: số (nhóm / siêu nhóm "-100…", người dùng) hoặc "@tenkenh".</summary>
    [GeneratedRegex("^(-?[0-9]{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$")]
    public static partial Regex ChatId();

    /// <summary>Bot token dạng "123456789:AA…" (id bot + khoá).</summary>
    [GeneratedRegex("^[0-9]{5,15}:[A-Za-z0-9_-]{30,64}$")]
    public static partial Regex BotToken();
}
