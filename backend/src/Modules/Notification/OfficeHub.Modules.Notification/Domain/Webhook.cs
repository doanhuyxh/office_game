using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;

namespace OfficeHub.Modules.Notification.Domain;

/// <summary>
/// Webhook cá nhân (2026-11-11 — "đánh thức agent"): mỗi tài khoản tối đa một URL. Có thông báo mới (chuông) hoặc tin nhắn 1-1 tới tài khoản →
/// OfficeHub POST JSON tới URL đó (ký HMAC-SHA256 bằng <see cref="SecretEncrypted"/>) để agent bên ngoài khỏi phải hỏi định kỳ.
/// </summary>
public sealed class Webhook
{
    public Guid UserId { get; set; }
    public string Url { get; set; } = "";
    /// <summary>Khoá ký (mã hoá bằng IFieldEncryptor) — chỉ hiện cho chủ tài khoản một lần lúc tạo / đổi khoá.</summary>
    public string SecretEncrypted { get; set; } = "";
    public bool Enabled { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public DateTimeOffset? LastSuccessAt { get; set; }
    public DateTimeOffset? LastFailureAt { get; set; }
    public string? LastError { get; set; }
    /// <summary>Số lần gửi thất bại liên tiếp (lần gửi cuối cùng của mỗi sự kiện); đạt <see cref="WebhookRules.DisableAfterFailures"/> → tự tắt.</summary>
    public int ConsecutiveFailures { get; set; }
}

[System.Text.Json.Serialization.JsonConverter(typeof(System.Text.Json.Serialization.JsonStringEnumConverter<WebhookStatus>))]
public enum WebhookStatus { Pending, Sent, Failed }

/// <summary>Một sự kiện chờ gửi / đã gửi tới webhook (hàng đợi trong DB như email — khởi động lại không mất).</summary>
public sealed class WebhookDelivery
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid UserId { get; set; }
    /// <summary>notification | chat.message | ping.</summary>
    public string Event { get; set; } = "";
    /// <summary>JSON phần <c>data</c> của body.</summary>
    public string DataJson { get; set; } = "{}";
    public DateTimeOffset CreatedAt { get; set; }
    public WebhookStatus Status { get; set; } = WebhookStatus.Pending;
    public int Attempts { get; set; }
    public DateTimeOffset? NextAttemptAt { get; set; }
    public DateTimeOffset? SentAt { get; set; }
    public int? ResponseStatus { get; set; }
    public string? Error { get; set; }
}

/// <summary>Hàm thuần cho webhook — test: tests/OfficeHub.Modules.Notification.Tests/WebhookRulesTests.cs.</summary>
public static class WebhookRules
{
    public const int MaxUrlLength = 500;
    public const int MaxAttempts = 5;
    public const int DisableAfterFailures = 20;
    public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);
    public static readonly TimeSpan KeepDeliveries = TimeSpan.FromDays(7);
    public const string SignatureHeader = "X-OfficeHub-Signature";
    public const string TimestampHeader = "X-OfficeHub-Timestamp";
    public const string EventHeader = "X-OfficeHub-Event";
    public const string DeliveryHeader = "X-OfficeHub-Delivery";

    /// <summary>
    /// Lỗi URL (null = hợp lệ): https bắt buộc (http chỉ khi <paramref name="allowPrivate"/> — máy dev), không userinfo, không fragment,
    /// host là IP nội bộ → từ chối (chống SSRF; tên miền trỏ vào IP nội bộ bị chặn lúc kết nối — <see cref="IsPublic"/>).
    /// </summary>
    public static string? UrlError(string? url, bool allowPrivate)
    {
        if (string.IsNullOrWhiteSpace(url)) return "Nhập URL webhook";
        url = url.Trim();
        if (url.Length > MaxUrlLength) return $"URL dài quá {MaxUrlLength} ký tự";
        if (!Uri.TryCreate(url, UriKind.Absolute, out var u)) return "URL không hợp lệ";
        if (u.Scheme != Uri.UriSchemeHttps && !(allowPrivate && u.Scheme == Uri.UriSchemeHttp)) return "URL webhook phải bắt đầu bằng https://";
        if (!string.IsNullOrEmpty(u.UserInfo)) return "URL không được chứa tên đăng nhập / mật khẩu";
        if (!string.IsNullOrEmpty(u.Fragment)) return "URL không được có phần #";
        if (!allowPrivate && (u.IsLoopback || (IPAddress.TryParse(u.Host.Trim('[', ']'), out var ip) && !IsPublic(ip)) || u.Host.EndsWith(".local", StringComparison.OrdinalIgnoreCase)
                              || u.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase)))
            return "Không gửi webhook tới địa chỉ nội bộ";
        return null;
    }

    /// <summary>IP công cộng (không loopback, private, link-local, CGNAT, multicast, unspecified, ULA IPv6, IPv4-mapped của địa chỉ nội bộ).</summary>
    public static bool IsPublic(IPAddress ip)
    {
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        if (IPAddress.IsLoopback(ip) || ip.Equals(IPAddress.Any) || ip.Equals(IPAddress.IPv6Any) || ip.Equals(IPAddress.Broadcast)) return false;
        if (ip.AddressFamily == AddressFamily.InterNetwork)
        {
            var b = ip.GetAddressBytes();
            return !(b[0] == 10 || b[0] == 0 || b[0] == 127
                     || (b[0] == 172 && b[1] >= 16 && b[1] <= 31)
                     || (b[0] == 192 && b[1] == 168)
                     || (b[0] == 169 && b[1] == 254)
                     || (b[0] == 100 && b[1] >= 64 && b[1] <= 127)
                     || b[0] >= 224);
        }
        if (ip.AddressFamily == AddressFamily.InterNetworkV6)
            return !(ip.IsIPv6LinkLocal || ip.IsIPv6SiteLocal || ip.IsIPv6Multicast || ip.IsIPv6UniqueLocal);
        return false;
    }

    /// <summary>Khoá ký mới: "whsec_" + 32 byte ngẫu nhiên base64url.</summary>
    public static string NewSecret() => "whsec_" + Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    /// <summary>Chữ ký gửi kèm: <c>sha256=</c> + hex(HMAC-SHA256(secret, "{timestamp}.{body}")). Phía nhận tính lại và so sánh.</summary>
    public static string Sign(string secret, long timestamp, string body) =>
        "sha256=" + Convert.ToHexStringLower(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes($"{timestamp}.{body}")));

    /// <summary>Lần thử kế (sau lần thứ <paramref name="attempts"/> thất bại): 1 / 5 / 15 / 60 phút; hết lượt → null.</summary>
    public static DateTimeOffset? NextAttempt(int attempts, DateTimeOffset now) => attempts switch
    {
        1 => now.AddMinutes(1),
        2 => now.AddMinutes(5),
        3 => now.AddMinutes(15),
        4 => now.AddMinutes(60),
        _ => null,
    };

    /// <summary>Phản hồi 2xx = thành công; 4xx (trừ 408 / 429) = lỗi phía nhận, không thử lại.</summary>
    public static bool Retryable(int? status) => status is null or 408 or 429 or >= 500;
}
