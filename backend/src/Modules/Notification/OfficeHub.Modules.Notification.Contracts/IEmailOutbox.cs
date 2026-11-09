namespace OfficeHub.Modules.Notification.Contracts;

/// <summary>Một email gửi lỗi gần đây (trang Hệ thống → Vận hành). Không có nội dung thư.</summary>
public sealed record EmailFailureDto(Guid Id, string? To, string Title, string Category, int Attempts, string? Error, DateTimeOffset CreatedAt,
    bool GaveUp);

/// <summary>Tình trạng hàng đợi email thông báo.</summary>
/// <param name="Pending">Đang chờ gửi / chờ thử lại.</param>
/// <param name="OldestPendingAt">Thời điểm tạo của thư chờ lâu nhất (null = không có).</param>
/// <param name="Retrying">Trong số đang chờ: đã thử ít nhất một lần mà lỗi.</param>
/// <param name="Failed">Hết lượt thử (bỏ cuộc), trong 30 ngày.</param>
public sealed record EmailQueueStats(int Pending, DateTimeOffset? OldestPendingAt, int Retrying, int Sent24h, int Failed, int Skipped30d,
    DateTimeOffset? LastSentAt, IReadOnlyList<EmailFailureDto> RecentFailures);

/// <summary>Đọc / thao tác hàng đợi email (outbox) của module Notification — chỉ dành cho trang quản trị hệ thống.</summary>
public interface IEmailOutbox
{
    Task<EmailQueueStats> StatsAsync(CancellationToken ct = default);

    /// <summary>Đưa các thư đã bỏ cuộc trong 30 ngày quay lại hàng đợi (đếm lại từ đầu). Trả số thư.</summary>
    Task<int> RetryFailedAsync(CancellationToken ct = default);
}
