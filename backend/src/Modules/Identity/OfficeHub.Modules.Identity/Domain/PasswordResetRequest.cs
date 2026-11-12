namespace OfficeHub.Modules.Identity.Domain;

/// <summary>
/// Yêu cầu gửi email quên mật khẩu chờ gửi (TEST-28) — hàng đợi trong DB, không mất khi khởi động lại. CHỈ lưu ai / lúc nào:
/// token đặt lại (bí mật, sống 1 giờ) được tạo lúc gửi, KHÔNG lưu DB / không hiện ở chuông thông báo.
/// </summary>
public sealed class PasswordResetRequest
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid UserId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public int Attempts { get; set; }
    /// <summary>Lần thử kế (cũng là "khoá" khi đang gửi — đẩy lên trước để instance khác không lấy trùng). null = xong / bỏ.</summary>
    public DateTimeOffset? NextAttemptAt { get; set; }
    public DateTimeOffset? SentAt { get; set; }
    /// <summary>Lỗi SMTP lần cuối (≤ 500 ký tự).</summary>
    public string? Error { get; set; }
}
