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
    /// <summary>JSON tóm tắt body của lệnh GHI (đã cắt + che trường nhạy cảm, <see cref="AiRequestSummary"/>). Chỉ giữ
    /// <see cref="AuditRules.AiSummaryRetentionDays"/> ngày rồi đặt null; null với lệnh đọc / bị chặn.</summary>
    public string? RequestSummary { get; set; }
}

public static class AuditRules
{
    public const int AiRetentionDays = 180;
    /// <summary>Nội dung lệnh ghi chỉ lưu 7 ngày (chủ dự án chốt 2026-11-11) — dòng nhật ký vẫn giữ 180 ngày.</summary>
    public const int AiSummaryRetentionDays = 7;

    /// <summary>Lệnh ghi = method khác GET / HEAD / OPTIONS (cùng định nghĩa với báo cáo sử dụng).</summary>
    public static bool IsWrite(string method) =>
        !HttpMethodsEq(method, "GET") && !HttpMethodsEq(method, "HEAD") && !HttpMethodsEq(method, "OPTIONS");

    /// <summary>Có lưu nội dung không: lệnh ghi, route không bị chặn (403) và không bị giới hạn tần suất (429).</summary>
    public static bool KeepsSummary(string method, int status) => IsWrite(method) && status is not (403 or 429);

    private static bool HttpMethodsEq(string a, string b) => string.Equals(a, b, StringComparison.OrdinalIgnoreCase);

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
