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
}

public sealed class OfficeSettings
{
    public const string Section = "Office";
    [Required(ErrorMessage = "Thiếu Office__TimeZone trong .env")] public string TimeZone { get; set; } = "Asia/Ho_Chi_Minh";
    /// <summary>Dải IP public của văn phòng (CIDR, cách nhau dấu phẩy). Dùng để phân biệt chấm công tại văn phòng / từ xa.</summary>
    public string IpRanges { get; set; } = "";
    [Range(1, 240)] public int InactiveMinutes { get; set; } = 15;
}
