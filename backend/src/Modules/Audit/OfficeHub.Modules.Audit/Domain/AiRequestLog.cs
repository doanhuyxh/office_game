namespace OfficeHub.Modules.Audit.Domain;

/// <summary>
/// Một request vào Api bằng token AI (token cá nhân hoặc ứng dụng OAuth), kể cả request bị chặn route / lỗi.
/// CHỈ THÊM; dọn bản ghi cũ hơn <see cref="AuditRules.AiRetentionDays"/> ngày.
/// </summary>
public sealed class AiRequestLog
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public DateTimeOffset OccurredAt { get; set; }
    public Guid UserId { get; set; }
    public Guid TokenId { get; set; }
    /// <summary>Tên token cá nhân hoặc tên ứng dụng OAuth.</summary>
    public string ClientName { get; set; } = "";
    public bool ViaOAuth { get; set; }
    /// <summary>Tên tool MCP (header X-Mcp-Tool) — null nếu gọi thẳng Api bằng token.</summary>
    public string? Tool { get; set; }
    public string Method { get; set; } = "";
    public string Path { get; set; } = "";
    public int Status { get; set; }
    public int DurationMs { get; set; }
    public string? Ip { get; set; }
}

public static class AuditRules
{
    public const int AiRetentionDays = 180;

    /// <summary>Tên tool hợp lệ: snake_case ≤ 64 ký tự; khác → bỏ (header do client gửi, không tin).</summary>
    public static string? CleanTool(string? value) =>
        value is { Length: > 0 and <= 64 } && value.All(c => c is >= 'a' and <= 'z' or >= '0' and <= '9' or '_') ? value : null;
}

/// <summary>
/// Lịch sử sửa dữ liệu nhân sự (entity có [Audited] ở các module + đổi vai trò). CHỈ THÊM, không xoá tự động.
/// Trường bí mật (lương mã hoá, hash) chỉ ghi "•••".
/// </summary>
public sealed class ChangeLog
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public DateTimeOffset OccurredAt { get; set; }
    /// <summary>"web" | "ai" | "system".</summary>
    public string Source { get; set; } = "";
    public Guid? UserId { get; set; }
    public string? UserName { get; set; }
    /// <summary>Schema của module (org, contracts, attendance, leave, identity).</summary>
    public string Module { get; set; } = "";
    public string Entity { get; set; } = "";
    public string EntityId { get; set; } = "";
    public string? EntityLabel { get; set; }
    public string Action { get; set; } = "";
    /// <summary>JSON: [{ field, old, new, masked }].</summary>
    public string ChangesJson { get; set; } = "[]";
}
