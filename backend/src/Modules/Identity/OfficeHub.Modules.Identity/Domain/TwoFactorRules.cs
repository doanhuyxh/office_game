using System.Text;

namespace OfficeHub.Modules.Identity.Domain;

/// <summary>
/// Quy tắc thuần cho xác thực 2 lớp (TOTP, RFC 6238 qua AuthenticatorTokenProvider của ASP.NET Identity):
/// định dạng khoá, URI <c>otpauth://</c> cho mã QR, chuẩn hoá mã người dùng nhập.
/// </summary>
public static class TwoFactorRules
{
    /// <summary>Số mã dự phòng (dùng một lần) tạo khi bật / tạo lại.</summary>
    public const int RecoveryCodeCount = 10;

    // Tên token trong identity.user_tokens do UserStore của Identity dùng (LoginProvider = "[AspNetUserStore]").
    public const string StoreProvider = "[AspNetUserStore]";
    public const string AuthenticatorKeyName = "AuthenticatorKey";
    public const string RecoveryCodesName = "RecoveryCodes";

    /// <summary>Khoá base32 dạng nhóm 4 ký tự thường để gõ tay: "abcd efgh …".</summary>
    public static string FormatKey(string key)
    {
        var sb = new StringBuilder();
        for (var i = 0; i < key.Length; i += 4)
        {
            if (i > 0) sb.Append(' ');
            sb.Append(key.AsSpan(i, Math.Min(4, key.Length - i)));
        }
        return sb.ToString().ToLowerInvariant();
    }

    /// <summary>
    /// URI theo định dạng Key Uri của Google Authenticator (đọc được bởi mọi ứng dụng TOTP):
    /// <c>otpauth://totp/{issuer}:{account}?secret=…&amp;issuer=…&amp;digits=6</c>.
    /// </summary>
    public static string AuthenticatorUri(string issuer, string account, string key) =>
        $"otpauth://totp/{Uri.EscapeDataString(issuer)}:{Uri.EscapeDataString(account)}" +
        $"?secret={key.Replace(" ", "").ToUpperInvariant()}&issuer={Uri.EscapeDataString(issuer)}&digits=6";

    /// <summary>Bỏ khoảng trắng / gạch nối người dùng gõ kèm ("123 456", "abcde-12345").</summary>
    public static string NormalizeCode(string? code) =>
        new((code ?? "").Where(c => !char.IsWhiteSpace(c) && c != '-').ToArray());

    /// <summary>
    /// Mã dự phòng do Identity sinh có dạng "XXXXX-XXXXX" (chữ HOA) và so khớp chính xác →
    /// chấp nhận người dùng gõ thường / thiếu gạch / có khoảng trắng.
    /// </summary>
    public static string NormalizeRecoveryCode(string? code)
    {
        var s = new string((code ?? "").Where(c => !char.IsWhiteSpace(c) && c != '-').ToArray()).ToUpperInvariant();
        return s.Length == 10 ? $"{s[..5]}-{s[5..]}" : s;
    }

    /// <summary>Mã TOTP hợp lệ về hình thức: đúng 6 chữ số.</summary>
    public static bool IsTotpFormat(string code) => code.Length == 6 && code.All(char.IsAsciiDigit);
}

/// <summary>Xác nhận lại danh tính trước thao tác nhạy cảm (tạo token AI).</summary>
public static class ReauthRules
{
    /// <summary>Vừa đăng nhập trong khoảng này thì không hỏi lại (mỗi lúc 1 thiết bị → phiên hiện tại chính là lần đăng nhập đó).</summary>
    public static readonly TimeSpan RecentLoginWindow = TimeSpan.FromMinutes(10);

    public static bool IsRecentLogin(DateTimeOffset? lastLoginAt, DateTimeOffset now) =>
        lastLoginAt is { } t && t <= now && now - t <= RecentLoginWindow;
}
