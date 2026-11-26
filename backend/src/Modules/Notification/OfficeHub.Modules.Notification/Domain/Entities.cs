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
    /// <summary>Loại đối tượng (<see cref="Contracts.NotificationTargetTypes"/>) — nguồn duy nhất để client định tuyến (TEST-238 bỏ cột Link);
    /// URL web chỉ dựng lúc gửi email bằng <see cref="Contracts.NotificationLinkBuilder"/>.</summary>
    public required string TargetType { get; set; }
    public Guid? TargetId { get; set; }
    /// <summary>Tham số phụ của target — JSON object chuỗi → chuỗi (jsonb).</summary>
    public string? TargetParams { get; set; }
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

/// <summary>Tuỳ chọn nhận thông báo của một tài khoản (khoá = UserId). Không có dòng = mặc định (nhận email).</summary>
public sealed class NotificationPreference
{
    public Guid UserId { get; set; }
    /// <summary>false = không gửi email thông báo (trừ nhóm bắt buộc — <see cref="EmailPolicy.IsMandatory"/>); chuông + push vẫn nhận.</summary>
    public bool EmailEnabled { get; set; } = true;
    public DateTimeOffset UpdatedAt { get; set; }
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
