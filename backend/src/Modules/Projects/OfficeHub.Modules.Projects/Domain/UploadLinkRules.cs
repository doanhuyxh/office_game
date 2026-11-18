using System.Security.Cryptography;
using System.Text;

namespace OfficeHub.Modules.Projects.Domain;

/// <summary>Trạng thái link tải lên khi mở trang công khai.</summary>
public enum UploadLinkState
{
    Active,
    /// <summary>Hết hạn / thu hồi / dự án đóng / người tạo không còn là thành viên → 410, trang báo "Link đã hết hạn hoặc bị thu hồi".</summary>
    Gone,
}

/// <summary>
/// Link tải tệp từ thiết bị khác cho bình luận việc (TEST-175) — quy tắc thuần, test ở OfficeHub.Modules.Projects.Tests.
/// Token ngẫu nhiên 32 byte (base64url, 43 ký tự), DB chỉ giữ SHA-256 (hex) — như token AI: lộ DB không dùng lại được link.
/// Tệp vẫn theo <see cref="CommentFileRules"/> (cỡ, đuôi chặn, ≤ 5 tệp / bình luận); thêm trần số tệp / link.
/// </summary>
public static class UploadLinkRules
{
    /// <summary>Hạn chọn được khi tạo (phút): 15 phút / 1 giờ / 24 giờ.</summary>
    public static readonly IReadOnlyList<int> AllowedMinutes = [15, 60, 1440];
    public const int DefaultMinutes = 60;
    public const int MaxFilesPerLink = 50;
    /// <summary>Số link còn hiệu lực tối đa của một người trên một việc.</summary>
    public const int MaxActivePerTask = 10;
    public const int TokenBytes = 32;
    /// <summary>Endpoint công khai: số request / phút / IP (mỗi đường dẫn).</summary>
    public const int PublicRequestsPerMinute = 60;
    public const int MaxUserAgent = 300;

    /// <summary>Hạn hợp lệ (null = mặc định 1 giờ); khác danh sách → null (400).</summary>
    public static TimeSpan? Lifetime(int? minutes) =>
        minutes is null ? TimeSpan.FromMinutes(DefaultMinutes)
        : AllowedMinutes.Contains(minutes.Value) ? TimeSpan.FromMinutes(minutes.Value) : null;

    public static string NewToken() => Base64Url(RandomNumberGenerator.GetBytes(TokenBytes));

    /// <summary>SHA-256 hex chữ thường của token — cột <c>TokenHash</c>.</summary>
    public static string Hash(string token) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    /// <summary>Đúng dạng token (43 ký tự base64url) — sai dạng thì 404 ngay, không truy vấn DB.</summary>
    public static bool LooksLikeToken(string? token) =>
        token is { Length: 43 } && token.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_');

    public static UploadLinkState State(DateTimeOffset expiresAt, DateTimeOffset? revokedAt, DateTimeOffset now, bool projectActive, bool creatorIsMember) =>
        revokedAt is null && expiresAt > now && projectActive && creatorIsMember ? UploadLinkState.Active : UploadLinkState.Gone;

    /// <summary>Còn xin thêm được tệp: đã gửi + vé đang treo của link &lt; trần.</summary>
    public static bool FilesLeft(int sent, int pending) => sent + pending < MaxFilesPerLink;

    /// <summary>User-Agent lưu tra soát: bỏ ký tự điều khiển, cắt ≤ <see cref="MaxUserAgent"/>.</summary>
    public static string? CleanUserAgent(string? ua)
    {
        if (string.IsNullOrWhiteSpace(ua)) return null;
        var s = new string(ua.Where(c => !char.IsControl(c)).ToArray()).Trim();
        return s.Length > MaxUserAgent ? s[..MaxUserAgent] : s;
    }

    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
