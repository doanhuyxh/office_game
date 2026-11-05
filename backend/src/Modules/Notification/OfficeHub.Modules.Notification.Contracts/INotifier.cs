namespace OfficeHub.Modules.Notification.Contracts;

/// <summary>
/// Phần công khai của module Notification: module khác gửi thông báo cho tài khoản (in-app + email).
/// Lưu thông báo ngay; email gửi nền (hàng đợi trong DB, thử lại khi SMTP lỗi) nên không làm chậm / hỏng request gọi.
/// </summary>
public interface INotifier
{
    Task NotifyAsync(NotificationRequest request, CancellationToken ct = default);
}

/// <param name="RecipientUserIds">Id tài khoản nhận (trùng lặp tự bỏ).</param>
/// <param name="Category">Nhóm để FE chọn icon: xem <see cref="NotificationCategories"/>.</param>
/// <param name="Link">Đường dẫn trong app (vd "/approvals"); email dùng App__BaseUrl + Link.</param>
/// <param name="SendEmail">false = chỉ hiện trong app (thông báo phụ, tránh spam email).</param>
public sealed record NotificationRequest(
    IReadOnlyCollection<Guid> RecipientUserIds,
    string Category,
    string Title,
    string Body,
    string? Link = null,
    bool SendEmail = true);

public static class NotificationCategories
{
    /// <summary>Có đơn chờ người nhận duyệt.</summary>
    public const string ApprovalRequested = "approval_requested";
    /// <summary>Đơn của người nhận được duyệt (bước trung gian hoặc cuối).</summary>
    public const string ApprovalApproved = "approval_approved";
    public const string ApprovalRejected = "approval_rejected";
    /// <summary>Đơn người nhận đang phải duyệt đã bị người gửi huỷ.</summary>
    public const string ApprovalCancelled = "approval_cancelled";
    /// <summary>Hợp đồng lao động sắp hết hạn (30 / 7 ngày) — gửi HR và quản lý trực tiếp.</summary>
    public const string ContractExpiring = "contract_expiring";
}
