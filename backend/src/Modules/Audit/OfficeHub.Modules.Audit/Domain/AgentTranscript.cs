namespace OfficeHub.Modules.Audit.Domain;

/// <summary>
/// Transcript một phiên agent (TEST-144): metadata ở đây, nội dung (.jsonl đã che bí mật + gzip) MÃ HOÁ bằng <c>IFieldEncryptor</c> rồi lưu S3
/// tại <see cref="StorageKey"/>. Một bản / (UserId, Key) — runner gửi lại = thay. Hết <see cref="ExpiresAt"/> (90 ngày từ lần gửi cuối) → job xoá
/// cả dòng lẫn file. Bot đọc lại bản của mình (khôi phục khi máy mất); admin / HR xem để tra soát.
/// </summary>
public sealed class AgentTranscript
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    /// <summary>Tài khoản bot (lấy từ token, không do runner khai).</summary>
    public Guid UserId { get; set; }
    /// <summary>Khoá phiên của runner: id việc hoặc <c>&lt;mã NV&gt;:&lt;id hội thoại / phiên họp&gt;</c>.</summary>
    public string Key { get; set; } = "";
    /// <summary>task | chat | meeting.</summary>
    public string Kind { get; set; } = "task";
    public string SessionId { get; set; } = "";
    public string? Cwd { get; set; }
    public string? Branch { get; set; }
    /// <summary>Bản bàn giao ngắn — mã hoá như nội dung (có thể chứa dữ liệu nghiệp vụ).</summary>
    public string? SummaryEncrypted { get; set; }
    /// <summary>SHA-256 (hex) của bản gzip — runner so để biết bản trên cloud có khớp không.</summary>
    public string Sha256 { get; set; } = "";
    /// <summary>Kích thước bản gzip (byte).</summary>
    public long SizeBytes { get; set; }
    public string StorageKey { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
}
