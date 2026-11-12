using System.Text.Json;
using System.Text.RegularExpressions;

namespace OfficeHub.Modules.Notification.Contracts;

/// <summary>
/// Kênh Telegram đánh thức agent (TEST-42): khi một việc được giao cho tài khoản bot có username bot Telegram, OfficeHub đưa ĐÚNG MỘT tin vào
/// hàng đợi gửi nhóm Telegram đã cấu hình (trang Hệ thống → Cấu hình). Không làm gì khi kênh tắt / chưa cấu hình / người nhận không phải bot
/// hoặc chưa có username. Không bao giờ ném lỗi (gửi nền, lỗi chỉ ghi log + hàng đợi) — luồng giao việc không bị chặn.
/// </summary>
public interface ITelegramWakeup
{
    Task TaskAssignedAsync(Guid assigneeUserId, string employeeCode, Guid projectId, Guid taskId, string taskCode, CancellationToken ct = default);

    /// <summary>Nút "Gửi thử": gửi ngay (không qua hàng đợi) một tin thử vào nhóm. Trả (thành công, thông điệp).</summary>
    Task<(bool Ok, string Message)> SendTestAsync(CancellationToken ct = default);
}

/// <summary>Quy tắc chung của kênh Telegram (Org kiểm tra username, Notification dựng tin) — hàm thuần, có test.</summary>
public static partial class TelegramRules
{
    /// <summary>Username bot Telegram: 5–32 ký tự chữ / số / _, bắt đầu bằng chữ, kết thúc bằng "bot" (quy định của Telegram).</summary>
    [GeneratedRegex("^@?([A-Za-z][A-Za-z0-9_]{1,28}[Bb][Oo][Tt])$")]
    private static partial Regex BotUsername();

    public const string UsernameError = "Username bot Telegram không hợp lệ (5–32 ký tự chữ / số / _, kết thúc bằng \"bot\", vd @agent_dev01_bot)";

    /// <summary>Chuẩn hoá về "@…bot" chữ thường; trống → null (xoá); sai → <paramref name="error"/>.</summary>
    public static string? NormalizeBotUsername(string? input, out string? error)
    {
        error = null;
        var v = input?.Trim();
        if (string.IsNullOrEmpty(v)) return null;
        var m = BotUsername().Match(v);
        if (!m.Success) { error = UsernameError; return null; }
        return "@" + m.Groups[1].Value.ToLowerInvariant();
    }

    /// <summary>
    /// Tin đánh thức: dòng 1 nhắc tên bot của agent, dòng 2 JSON đúng 4 trường. KHÔNG có tên / mô tả việc (agent tự đọc qua MCP).
    /// </summary>
    public static string WakeMessage(string botUsername, string employeeCode, Guid projectId, Guid taskId, string taskCode) =>
        botUsername + "\n" + JsonSerializer.Serialize(new Dictionary<string, string>
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
