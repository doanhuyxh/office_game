namespace OfficeHub.Modules.Notification.Contracts;

/// <summary>
/// Đẩy thông báo qua Firebase Cloud Messaging tới thiết bị đã đăng ký của tài khoản.
/// Best-effort: không ghi bảng <c>notifications</c> (không phải bell/email), không bao giờ ném lỗi,
/// và không làm gì nếu chưa cấu hình FCM (trang Hệ thống → Cấu hình → Thông báo đẩy (FCM), hoặc <c>Firebase__CredentialsPath</c>) hoặc tài khoản chưa đăng ký thiết bị nào.
/// </summary>
public interface IPushSender
{
    /// <param name="target">Đối tượng mở khi bấm (TEST-237): gửi trong <c>data</c> là targetType / targetId / targetParams (JSON) + link (sinh từ target).</param>
    Task PushAsync(IEnumerable<Guid> recipientUserIds, string title, string body, NotificationTarget? target, CancellationToken ct = default);

    /// <summary>Gửi thử dry run (FCM chỉ kiểm tra, không tới thiết bị nào) — nút "Kiểm tra" của nhóm FCM. Trả (thành công, thông điệp).</summary>
    Task<(bool Ok, string Message)> DryRunAsync(CancellationToken ct = default);
}
