namespace OfficeHub.Modules.Notification.Domain;

public enum EmailStatus
{
    /// <summary>Không gửi email (chỉ in-app, hoặc tài khoản không có email).</summary>
    None = 0,
    /// <summary>Đang chờ worker gửi (hoặc chờ thử lại).</summary>
    Pending = 1,
    Sent = 2,
    /// <summary>Hết lượt thử lại (<see cref="EmailPolicy.MaxAttempts"/>).</summary>
    Failed = 3,
    /// <summary>Địa chỉ thuộc tên miền dành riêng (.test, example.com…) — không bao giờ nhận được thư.</summary>
    Skipped = 4,
}

/// <summary>Một thông báo cho một tài khoản. In-app đọc từ bảng này; cột Email* là hàng đợi gửi email (outbox).</summary>
public sealed class Notification
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid UserId { get; set; }
    public required string Category { get; set; }
    public required string Title { get; set; }
    public required string Body { get; set; }
    public string? Link { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? ReadAt { get; set; }

    public string? EmailTo { get; set; }
    public string? EmailToName { get; set; }
    public EmailStatus EmailStatus { get; set; }
    public int EmailAttempts { get; set; }
    public DateTimeOffset? EmailNextAttemptAt { get; set; }
    public DateTimeOffset? EmailSentAt { get; set; }
    public string? EmailError { get; set; }
}

/// <summary>Token thiết bị (trình duyệt) đăng ký nhận push FCM của một tài khoản. Một tài khoản có thể có nhiều thiết bị.</summary>
public sealed class PushToken
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid UserId { get; set; }
    public required string Token { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset LastSeenAt { get; set; }
}
