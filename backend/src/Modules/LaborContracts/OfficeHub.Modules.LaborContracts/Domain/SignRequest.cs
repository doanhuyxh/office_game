using System.Security.Cryptography;
using System.Text;
using OfficeHub.BuildingBlocks.Auditing;

namespace OfficeHub.Modules.LaborContracts.Domain;

public enum SignStatus { Pending = 0, Signed = 1, Cancelled = 2, Expired = 3 }

/// <summary>
/// Yêu cầu nhân viên ký điện tử file PDF của hợp đồng (chủ dự án chốt 2026-11-06: ký nội bộ + OTP email, không chữ ký số CA).
/// Giữ khoá file gốc + SHA-256 lúc gửi → lúc ký so lại (file bị thay giữa chừng → từ chối). OTP chỉ lưu hash.
/// </summary>
[Audited]
public sealed class SignRequest
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid ContractId { get; set; }
    public Guid EmployeeId { get; set; }
    public Guid SignerUserId { get; set; }
    public string OriginalFileKey { get; set; } = "";
    public string OriginalSha256 { get; set; } = "";
    public SignStatus Status { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public string? CreatedByName { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }

    public string? OtpHash { get; set; }
    public DateTimeOffset? OtpSentAt { get; set; }
    public DateTimeOffset? OtpExpiresAt { get; set; }
    public int OtpAttempts { get; set; }
    public int OtpSends { get; set; }

    public DateTimeOffset? SignedAt { get; set; }
    public string? SignerIp { get; set; }
    public string? SignerUserAgent { get; set; }
    public string? SignedFileKey { get; set; }
    public string? SignedSha256 { get; set; }
    public string? SignatureImageKey { get; set; }
}

/// <summary>Quy tắc ký — hàm thuần, test ở tests/OfficeHub.Modules.LaborContracts.Tests/SignRulesTests.cs.</summary>
public static class SignRules
{
    public static readonly TimeSpan RequestLifetime = TimeSpan.FromDays(7);
    public static readonly TimeSpan OtpLifetime = TimeSpan.FromMinutes(10);
    public static readonly TimeSpan OtpResendGap = TimeSpan.FromSeconds(60);
    public const int MaxOtpSends = 5;
    public const int MaxOtpAttempts = 5;
    public const int MaxSignatureBytes = 300 * 1024;

    public static string NewOtp() => RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");

    /// <summary>Hash gắn với mã yêu cầu (cùng OTP ở yêu cầu khác cho hash khác).</summary>
    public static string HashOtp(Guid requestId, string otp) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes($"{requestId:N}:{otp.Trim()}")));

    public static string Sha256(byte[] data) => Convert.ToHexStringLower(SHA256.HashData(data));

    public static bool OtpMatches(SignRequest r, string? otp, DateTimeOffset now) =>
        r.OtpHash is not null && r.OtpExpiresAt > now && otp is { Length: 6 } && otp.All(char.IsAsciiDigit)
        && CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(r.OtpHash), Encoding.ASCII.GetBytes(HashOtp(r.Id, otp)));

    /// <summary>Lý do không gửi OTP được (null = được gửi).</summary>
    public static string? CannotSendOtp(SignRequest r, DateTimeOffset now) =>
        r.Status != SignStatus.Pending ? "Yêu cầu ký không còn hiệu lực"
        : r.ExpiresAt <= now ? "Yêu cầu ký đã hết hạn — đề nghị HR gửi lại"
        : r.OtpSends >= MaxOtpSends ? "Đã gửi mã quá số lần cho phép — đề nghị HR gửi lại yêu cầu ký"
        : r.OtpSentAt is { } at && now - at < OtpResendGap ? $"Đợi {(int)Math.Ceiling((OtpResendGap - (now - at)).TotalSeconds)} giây rồi gửi lại mã"
        : null;

    /// <summary>Ảnh chữ ký: PNG (đúng chữ ký file), ≤ 300 KB.</summary>
    public static byte[]? ParseSignaturePng(string? dataUrl)
    {
        const string prefix = "data:image/png;base64,";
        if (dataUrl is null || !dataUrl.StartsWith(prefix, StringComparison.Ordinal)) return null;
        try
        {
            var bytes = Convert.FromBase64String(dataUrl[prefix.Length..]);
            ReadOnlySpan<byte> magic = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
            return bytes.Length is > 100 and <= MaxSignatureBytes && bytes.AsSpan().StartsWith(magic) ? bytes : null;
        }
        catch (FormatException) { return null; }
    }
}
