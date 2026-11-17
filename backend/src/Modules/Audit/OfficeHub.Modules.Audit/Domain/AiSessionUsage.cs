namespace OfficeHub.Modules.Audit.Domain;

/// <summary>
/// Mức dùng AI của một phiên agent (TEST-134) — runner gửi qua <c>/mcp/usage</c>. Duy nhất theo (UserId, SourceId): gửi lại = cập nhật.
/// CHỈ THÊM / CẬP NHẬT, không xoá (như <see cref="AiRequestLog"/> nhưng không có hạn lưu). Thời điểm UTC.
/// </summary>
public sealed class AiSessionUsage
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    /// <summary>Tài khoản bot (lấy từ token, không do runner khai).</summary>
    public Guid UserId { get; set; }
    public string SourceId { get; set; } = "";
    /// <summary>task | chat | meeting | other.</summary>
    public string Kind { get; set; } = "other";
    public Guid? TaskId { get; set; }
    public Guid? ProjectId { get; set; }
    public string? TaskCode { get; set; }
    public string Executor { get; set; } = "other";
    /// <summary>done | failed | skipped.</summary>
    public string Status { get; set; } = "done";
    public DateTimeOffset StartedAt { get; set; }
    public DateTimeOffset FinishedAt { get; set; }
    public int? Turns { get; set; }
    /// <summary>Tổng chi phí phiên (USD); null = không rõ.</summary>
    public decimal? CostUsd { get; set; }
    public DateTimeOffset ReceivedAt { get; set; }
    public List<AiSessionModel> Models { get; set; } = [];
}

/// <summary>Token / chi phí của một model trong phiên (một phiên nhiều model). Null = nhà cung cấp không báo.</summary>
public sealed class AiSessionModel
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid SessionId { get; set; }
    public string Model { get; set; } = "";
    public long? InputTokens { get; set; }
    public long? OutputTokens { get; set; }
    public long? CacheReadTokens { get; set; }
    public long? CacheWriteTokens { get; set; }
    public decimal? CostUsd { get; set; }
}
