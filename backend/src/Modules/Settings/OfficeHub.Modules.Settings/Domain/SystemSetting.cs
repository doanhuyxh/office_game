using OfficeHub.BuildingBlocks.Auditing;

namespace OfficeHub.Modules.Settings.Domain;

/// <summary>
/// Một nhóm cấu hình hệ thống (S3, SMTP, FCM, IP văn phòng — <see cref="BuildingBlocks.Configuration.SettingsGroups"/>) admin sửa trên trang Hệ thống.
/// Có dòng → dùng DB, không có → .env. Trường bí mật gom thành một JSON mã hoá (<see cref="SecretsEncrypted"/>, tên đuôi Encrypted → lịch sử sửa chỉ ghi "đã đổi").
/// </summary>
[Audited]
public sealed class SystemSetting
{
    /// <summary>Mã nhóm: s3 / smtp / fcm / office_ips.</summary>
    public required string Group { get; set; }
    /// <summary>Tên hiển thị (nhãn trong lịch sử sửa).</summary>
    public required string Name { get; set; }
    /// <summary>Các trường thường, JSON object khoá camelCase.</summary>
    public required string ValuesJson { get; set; }
    /// <summary>JSON {khoá: giá trị} của trường bí mật, mã hoá bằng IFieldEncryptor. Null = nhóm không có bí mật.</summary>
    public string? SecretsEncrypted { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public Guid? UpdatedById { get; set; }
    public string? UpdatedByName { get; set; }
}
