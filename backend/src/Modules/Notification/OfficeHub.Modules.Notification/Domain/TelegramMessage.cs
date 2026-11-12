namespace OfficeHub.Modules.Notification.Domain;

public enum TelegramStatus { Pending, Sent, Failed }

/// <summary>
/// Hàng đợi tin Telegram (TEST-42) — gửi nền bởi <see cref="Infrastructure.TelegramDispatcher"/>, thử lại có giới hạn.
/// Text không chứa nội dung việc (chỉ tên bot + JSON mã); token bot KHÔNG lưu ở đây (đọc cấu hình lúc gửi).
/// </summary>
public sealed class TelegramMessage
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    /// <summary>task_assigned / task_returned / task_mentioned.</summary>
    public string Kind { get; set; } = "";
    public string ChatId { get; set; } = "";
    public string Text { get; set; } = "";
    /// <summary>Tài khoản bot được đánh thức / việc liên quan (tra cứu, không FK).</summary>
    public Guid? UserId { get; set; }
    public Guid? TaskId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public TelegramStatus Status { get; set; } = TelegramStatus.Pending;
    public int Attempts { get; set; }
    public DateTimeOffset? NextAttemptAt { get; set; }
    public DateTimeOffset? SentAt { get; set; }
    public int? ResponseStatus { get; set; }
    public string? Error { get; set; }
}

/// <summary>Hàm thuần cho hàng đợi Telegram — test ở OfficeHub.Modules.Notification.Tests.</summary>
public static class TelegramQueueRules
{
    public const int MaxAttempts = 5;
    public static readonly TimeSpan KeepMessages = TimeSpan.FromDays(30);
    public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);

    /// <summary>Thử lại khi lỗi mạng (null), 429, 5xx. Lỗi 4xx khác (token sai 401, chat không tồn tại 400, bot bị đuổi 403) → bỏ luôn.</summary>
    public static bool Retryable(int? status) => status is null or 429 or >= 500;

    /// <summary>Lần thử kế: 429 dùng retry_after Telegram trả về (tối thiểu 1 giây); còn lại 30 giây → 2 → 10 → 30 phút. Hết lượt → null.</summary>
    public static DateTimeOffset? NextAttempt(int attempts, DateTimeOffset now, int? retryAfterSeconds = null)
    {
        if (attempts >= MaxAttempts) return null;
        if (retryAfterSeconds is { } s) return now.AddSeconds(Math.Clamp(s, 1, 3600));
        return now + (attempts switch { 1 => TimeSpan.FromSeconds(30), 2 => TimeSpan.FromMinutes(2), 3 => TimeSpan.FromMinutes(10), _ => TimeSpan.FromMinutes(30) });
    }
}
