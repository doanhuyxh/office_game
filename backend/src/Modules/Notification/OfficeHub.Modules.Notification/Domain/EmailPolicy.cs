namespace OfficeHub.Modules.Notification.Domain;

/// <summary>Quy tắc gửi email thông báo — hàm thuần (test: tests/OfficeHub.Modules.Notification.Tests).</summary>
public static class EmailPolicy
{
    public const int MaxAttempts = 5;

    /// <summary>Chờ trước lần thử thứ n+1 (n = số lần đã thử): 1, 5, 15, 60 phút.</summary>
    private static readonly TimeSpan[] Backoff = [TimeSpan.FromMinutes(1), TimeSpan.FromMinutes(5), TimeSpan.FromMinutes(15), TimeSpan.FromMinutes(60)];

    /// <summary>Tên miền dành riêng (RFC 2606 / 6761): không có hộp thư thật → gửi chỉ tạo thư dội lại.</summary>
    private static readonly string[] ReservedTlds = [".test", ".example", ".invalid", ".localhost", ".local"];
    private static readonly string[] ReservedDomains = ["example.com", "example.net", "example.org"];

    /// <summary>Có nên gửi tới địa chỉ này không (tài khoản thử nghiệm @officehub.test, admin@example.com → không).</summary>
    public static bool IsDeliverable(string? email)
    {
        if (string.IsNullOrWhiteSpace(email)) return false;
        var at = email.LastIndexOf('@');
        if (at <= 0 || at == email.Length - 1) return false;
        var domain = email[(at + 1)..].Trim().TrimEnd('.').ToLowerInvariant();
        if (ReservedDomains.Any(d => domain == d || domain.EndsWith("." + d))) return false;
        return !ReservedTlds.Any(t => domain.EndsWith(t)) && domain.Contains('.');
    }

    /// <summary>Sau lần thử thất bại thứ <paramref name="attempts"/>: thời điểm thử lại, hoặc null nếu hết lượt.</summary>
    public static DateTimeOffset? NextAttempt(int attempts, DateTimeOffset now) =>
        attempts >= MaxAttempts ? null : now + Backoff[Math.Min(attempts - 1, Backoff.Length - 1)];
}
