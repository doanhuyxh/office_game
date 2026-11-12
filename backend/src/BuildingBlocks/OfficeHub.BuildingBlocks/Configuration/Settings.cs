using System.ComponentModel.DataAnnotations;

namespace OfficeHub.BuildingBlocks.Configuration;

// Mỗi class ứng với một nhóm key trong .env: "<Section>__<Property>", ví dụ S3__AccessKey.

public sealed class AppSettings
{
    public const string Section = "App";
    [Required(ErrorMessage = "Thiếu App__Name trong .env")] public string Name { get; set; } = "OfficeHub";
    /// <summary>URL public của hệ thống, dùng để tạo link trong email (mời, quên mật khẩu).</summary>
    [Required(ErrorMessage = "Thiếu App__BaseUrl trong .env"), Url] public string BaseUrl { get; set; } = "";
}

public sealed class DataProtectionSettings
{
    public const string Section = "DataProtection";
    /// <summary>Thư mục lưu khoá mã hoá cookie / dữ liệu nhạy cảm. Api và Realtime PHẢI dùng chung.</summary>
    [Required(ErrorMessage = "Thiếu DataProtection__KeysPath trong .env")] public string KeysPath { get; set; } = "";
}

public sealed class S3Settings
{
    public const string Section = "S3";
    [Required(ErrorMessage = "Thiếu S3__Region trong .env")] public string Region { get; set; } = "";
    /// <summary>Để trống khi dùng AWS S3. Điền URL khi dùng MinIO / S3-compatible.</summary>
    public string? ServiceUrl { get; set; }
    public bool ForcePathStyle { get; set; }
    [Required(ErrorMessage = "Thiếu S3__AccessKey trong .env")] public string AccessKey { get; set; } = "";
    [Required(ErrorMessage = "Thiếu S3__SecretKey trong .env")] public string SecretKey { get; set; } = "";
    [Required(ErrorMessage = "Thiếu S3__BucketFiles trong .env")] public string BucketFiles { get; set; } = "";
    /// <summary>
    /// Thư mục gốc của OfficeHub trong bucket, ví dụ "officehub/". Dùng khi bucket chung với dự án khác:
    /// file nghiệp vụ nằm ở {KeyPrefix}files/..., backup ở {KeyPrefix}backup/..., bản build FE ở {KeyPrefix}web/...
    /// </summary>
    public string KeyPrefix { get; set; } = "";
    /// <summary>Tiền tố đầy đủ cho file nghiệp vụ (luôn kết thúc bằng "/").</summary>
    public string FilesPrefix => NormalizePrefix(KeyPrefix) + "files/";
    private static string NormalizePrefix(string p) => string.IsNullOrWhiteSpace(p) ? "" : p.Trim().Trim('/') + "/";
    [Range(1, 1440)] public int PresignMinutes { get; set; } = 5;
}

/// <summary>
/// Khoá AES-256 mã hoá từng trường nhạy cảm trong DB (lương, CCCD, số tài khoản, token…). Base64 của đúng 32 byte: `openssl rand -base64 32`.
/// KHÁC DataProtection: không nằm trong thư mục .keys. MẤT KHOÁ = MẤT DỮ LIỆU ĐÃ MÃ HOÁ → sao lưu cùng DB.
/// Xoay khoá (TEST-17): đặt khoá mới vào <see cref="Key"/> + <see cref="KeyId"/> mới, chuyển khoá cũ vào <see cref="PreviousKeys"/> ("id:base64");
/// job nền mã hoá lại dữ liệu sang khoá mới; khi log báo xong (không còn giá trị khoá cũ) mới bỏ khoá cũ khỏi PreviousKeys.
/// </summary>
public sealed class EncryptionSettings
{
    public const string Section = "Encryption";
    /// <summary>KeyId khi không đặt <c>Encryption__KeyId</c> — khoá đang dùng trước khi có keyring.</summary>
    public const string DefaultKeyId = "k1";
    public const string KeyIdError = "Encryption__KeyId chỉ gồm chữ thường / số / - (1–16 ký tự), vd k2";
    public const string PreviousError = "Encryption__PreviousKeys dạng \"id:base64;id:base64\" — id như Encryption__KeyId, khoá base64 đúng 32 byte";

    [Required(ErrorMessage = "Thiếu Encryption__Key trong .env")] public string Key { get; set; } = "";
    /// <summary>Tên khoá hiện hành, ghi vào mỗi giá trị mã hoá (tuỳ chọn, mặc định <see cref="DefaultKeyId"/>).</summary>
    public string? KeyId { get; set; }
    /// <summary>Khoá cũ CHỈ để giải mã, "id:base64;id:base64" (tuỳ chọn).</summary>
    public string? PreviousKeys { get; set; }

    public static bool IsValidKeyId(string id) => id.Length is >= 1 and <= 16 && id.All(c => char.IsAsciiLetterLower(c) || char.IsAsciiDigit(c) || c == '-');

    /// <summary>Phân tích PreviousKeys; sai định dạng → null. Rỗng → danh sách rỗng.</summary>
    public static List<(string Id, byte[] Key)>? ParsePrevious(string? value)
    {
        var list = new List<(string, byte[])>();
        foreach (var part in (value ?? "").Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var sep = part.IndexOf(':');
            if (sep <= 0) return null;
            var id = part[..sep].Trim();
            byte[]? key;
            try { key = Convert.FromBase64String(part[(sep + 1)..].Trim()) is { Length: 32 } k ? k : null; } catch (FormatException) { key = null; }
            if (!IsValidKeyId(id) || key is null) return null;
            list.Add((id, key));
        }
        return list;
    }
}

/// <summary>
/// Khoá nội bộ giữa OfficeHub.Realtime và OfficeHub.Api cho module Chat (Realtime báo "người này vừa vào phòng X" để cấp quyền xem kênh phòng;
/// chỉ Realtime biết vị trí thật trong văn phòng 3D). Gửi qua header <c>X-Chat-Key</c>; tối thiểu 32 ký tự (<c>openssl rand -base64 32</c>).
/// </summary>
public sealed class ChatSettings : IValidatableObject
{
    public const string Section = "Chat";
    [Required(ErrorMessage = "Thiếu Chat__InternalKey trong .env"), MinLength(32, ErrorMessage = "Chat__InternalKey phải dài tối thiểu 32 ký tự (openssl rand -base64 32)")]
    public string InternalKey { get; set; } = "";
    /// <summary>
    /// TEST-29 (tuỳ chọn): khoá riêng cho từng chiều gọi — lộ một khoá không mở được chiều còn lại. Trống → dùng <see cref="InternalKey"/>.
    /// <c>Chat__McpToRealtimeKey</c>: OfficeHub.Mcp → Realtime (<c>/rt/internal/*</c>: bot hiện diện, đi bộ, chiếu, chuyển tin chat).
    /// </summary>
    public string? McpToRealtimeKey { get; set; }
    /// <summary><c>Chat__RealtimeToApiKey</c>: Realtime → Api (<c>/api/chat/internal/*</c>: cấp quyền kênh chat phòng). Trống → <see cref="InternalKey"/>.</summary>
    public string? RealtimeToApiKey { get; set; }

    /// <summary>Khoá thực dùng cho chiều Mcp → Realtime.</summary>
    public string McpRealtimeKey => string.IsNullOrWhiteSpace(McpToRealtimeKey) ? InternalKey : McpToRealtimeKey.Trim();
    /// <summary>Khoá thực dùng cho chiều Realtime → Api.</summary>
    public string RealtimeApiKey => string.IsNullOrWhiteSpace(RealtimeToApiKey) ? InternalKey : RealtimeToApiKey.Trim();

    public IEnumerable<ValidationResult> Validate(ValidationContext context)
    {
        if (!string.IsNullOrWhiteSpace(McpToRealtimeKey) && McpToRealtimeKey.Trim().Length < 32)
            yield return new("Chat__McpToRealtimeKey phải dài tối thiểu 32 ký tự (hoặc để trống = dùng Chat__InternalKey)", [nameof(McpToRealtimeKey)]);
        if (!string.IsNullOrWhiteSpace(RealtimeToApiKey) && RealtimeToApiKey.Trim().Length < 32)
            yield return new("Chat__RealtimeToApiKey phải dài tối thiểu 32 ký tự (hoặc để trống = dùng Chat__InternalKey)", [nameof(RealtimeToApiKey)]);
    }
}

public sealed class SmtpSettings
{
    public const string Section = "Smtp";
    [Required(ErrorMessage = "Thiếu Smtp__Host trong .env")] public string Host { get; set; } = "";
    [Range(1, 65535)] public int Port { get; set; } = 587;
    public string? Username { get; set; }
    public string? Password { get; set; }
    /// <summary>true = SSL ngay từ đầu (cổng 465); false = STARTTLS nếu server hỗ trợ.</summary>
    public bool UseSsl { get; set; }
    [Required(ErrorMessage = "Thiếu Smtp__FromEmail trong .env"), EmailAddress] public string FromEmail { get; set; } = "";
    public string FromName { get; set; } = "OfficeHub";
    /// <summary>
    /// Kiểm tra thu hồi chứng chỉ (CRL/OCSP) khi bắt tay TLS. Mặc định BẬT. Chỉ chủ dự án tắt khi môi trường không hoàn tất
    /// được bước này (vd macOS dev với Gmail: "incomplete certificate revocation check"). Chuỗi chứng chỉ + tên máy chủ vẫn được kiểm tra.
    /// </summary>
    public bool CheckCertificateRevocation { get; set; } = true;
}

public sealed class OfficeSettings
{
    public const string Section = "Office";
    [Required(ErrorMessage = "Thiếu Office__TimeZone trong .env")] public string TimeZone { get; set; } = "Asia/Ho_Chi_Minh";
    /// <summary>Dải IP public của văn phòng (CIDR, cách nhau dấu phẩy). Dùng để phân biệt chấm công tại văn phòng / từ xa.</summary>
    public string IpRanges { get; set; } = "";
    [Range(1, 240)] public int InactiveMinutes { get; set; } = 15;
}
