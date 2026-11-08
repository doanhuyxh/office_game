namespace OfficeHub.Modules.Notification.Contracts;

/// <summary>
/// Đẩy thông báo qua Firebase Cloud Messaging tới thiết bị đã đăng ký của tài khoản.
/// Best-effort: không ghi bảng <c>notifications</c> (không phải bell/email), không bao giờ ném lỗi,
/// và không làm gì nếu chưa cấu hình <c>Firebase__CredentialsPath</c> hoặc tài khoản chưa đăng ký thiết bị nào.
/// </summary>
public interface IPushSender
{
    Task PushAsync(IEnumerable<Guid> recipientUserIds, string title, string body, string? link, CancellationToken ct = default);
}
