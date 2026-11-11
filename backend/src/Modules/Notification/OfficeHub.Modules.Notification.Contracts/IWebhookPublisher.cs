namespace OfficeHub.Modules.Notification.Contracts;

/// <summary>
/// Gửi sự kiện tới webhook cá nhân của các tài khoản (người không đặt webhook → bỏ qua). Ghi vào hàng đợi DB, gửi nền, không bao giờ ném lỗi.
/// Thông báo qua <see cref="INotifier"/> tự có webhook — chỉ gọi trực tiếp cho sự kiện không tạo chuông (vd tin nhắn 1-1).
/// </summary>
public interface IWebhookPublisher
{
    /// <param name="eventType">vd "chat.message".</param>
    /// <param name="data">Đối tượng tuần tự hoá thành phần <c>data</c> (JSON camelCase).</param>
    Task PublishAsync(IReadOnlyCollection<Guid> userIds, string eventType, object data, CancellationToken ct = default);
}

public static class WebhookEvents
{
    public const string Notification = "notification";
    public const string ChatMessage = "chat.message";
    public const string Ping = "ping";
}
