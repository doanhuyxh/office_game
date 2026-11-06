namespace OfficeHub.Modules.Identity.Domain;

/// <summary>
/// Token truy cập cá nhân cho trợ lý AI (MCP). Chỉ lưu SHA-256 của token; bản rõ hiện cho người dùng MỘT lần lúc tạo.
/// Thu hồi = đặt <see cref="RevokedAt"/> (giữ dòng để còn dấu vết).
/// </summary>
public sealed class AccessToken
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid UserId { get; set; }
    /// <summary>Tên do người dùng đặt, ví dụ "Claude trên laptop".</summary>
    public string Name { get; set; } = "";
    /// <summary>SHA-256 (hex, chữ thường) của token đầy đủ.</summary>
    public string TokenHash { get; set; } = "";
    /// <summary>Vài ký tự đầu để người dùng nhận ra token (ohk_AbCd…).</summary>
    public string Prefix { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? LastUsedAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }

    public bool IsUsable(DateTimeOffset now) => RevokedAt is null && ExpiresAt > now;
}
