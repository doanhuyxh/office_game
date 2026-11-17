namespace OfficeHub.BuildingBlocks.Ai;

/// <summary>
/// Mức dùng AI (chi phí / token) của từng phiên agent (TEST-134). Máy chủ MCP / Api không biết số token → bên chạy agent
/// (agent-runner) gửi sau mỗi phiên:
/// runner —(token AI của bot)→ <see cref="McpPath"/> trên host OfficeHub.Mcp (chỉ tài khoản bot) —(khoá nội bộ, kèm userId của token)→
/// <see cref="Path"/> trên Api (module Audit, bảng <c>audit.ai_usage_sessions</c> / <c>audit.ai_usage_models</c>).
/// Gửi lại cùng <see cref="AiUsageSession.SourceId"/> = cập nhật (không đếm hai lần). Chi phí / token có thể trống (nhà cung cấp không báo).
/// </summary>
public static class AiUsageRoute
{
    /// <summary>Cửa vào công khai trên host OfficeHub.Mcp, sau BearerGate (token AI của bot): body <see cref="AiUsageUpload"/>.</summary>
    public const string McpPath = "/mcp/usage";
    /// <summary>Đường nội bộ Mcp → Api (nginx chặn từ ngoài): body <see cref="AiUsageBatch"/>, khoá <c>Chat__McpToApiKey</c> (trống = <c>Chat__InternalKey</c>).</summary>
    public const string Path = "/api/audit/internal/ai-usage";
    public const string KeyHeader = "X-Internal-Key";

    public const int MaxSessions = 50;
    public const int MaxBodyBytes = 256 * 1024;
    public const int MaxModels = 20;
    public const int MaxSourceId = 100;
    public const int MaxTaskCode = 50;
    public const int MaxExecutor = 30;
    public const int MaxModel = 100;
    /// <summary>Chi phí một phiên / một model tối đa (cột numeric(12,6)).</summary>
    public const decimal MaxCostUsd = 999_999m;
    /// <summary>Thời điểm phiên không được lệch quá bấy nhiêu vào tương lai (đồng hồ máy chạy agent lệch).</summary>
    public static readonly TimeSpan MaxFutureSkew = TimeSpan.FromDays(1);

    /// <summary>Phiên không báo model nào → một dòng model tên này.</summary>
    public const string UnknownModel = "không rõ";
    public const string DefaultKind = "other";
    public const string DefaultExecutor = "other";

    public static readonly IReadOnlySet<string> Kinds = new HashSet<string>(StringComparer.Ordinal) { "task", "chat", "meeting", "other" };
    public static readonly IReadOnlySet<string> Statuses = new HashSet<string>(StringComparer.Ordinal) { "done", "failed", "skipped" };

    /// <summary>Kiểm tra lô phiên; null = hợp lệ, khác = câu lỗi tiếng Việt (400). Dùng ở cả Mcp (báo sớm) và Api (quyết định).</summary>
    public static string? Validate(IReadOnlyList<AiUsageSession?>? sessions, DateTimeOffset now)
    {
        if (sessions is null || sessions.Count == 0) return "sessions phải có ít nhất 1 phiên";
        if (sessions.Count > MaxSessions) return $"Tối đa {MaxSessions} phiên mỗi lần gửi";
        var limit = now + MaxFutureSkew;
        var seen = new HashSet<string>(StringComparer.Ordinal);
        for (var i = 0; i < sessions.Count; i++)
        {
            var at = $"sessions[{i}]";
            if (sessions[i] is not { } s) return $"{at}: phiên trống";
            if (string.IsNullOrWhiteSpace(s.SourceId)) return $"{at}.sourceId: bắt buộc";
            if (s.SourceId.Trim().Length > MaxSourceId) return $"{at}.sourceId: tối đa {MaxSourceId} ký tự";
            if (!seen.Add(s.SourceId.Trim())) return $"{at}.sourceId: trùng phiên khác trong cùng lô";
            if (s.Kind is not null && !Kinds.Contains(s.Kind)) return $"{at}.kind: phải là task, chat, meeting hoặc other";
            if (s.Status is null || !Statuses.Contains(s.Status)) return $"{at}.status: phải là done, failed hoặc skipped";
            if (s.Executor is { } ex && ex.Trim().Length > MaxExecutor) return $"{at}.executor: tối đa {MaxExecutor} ký tự";
            if (s.TaskCode is { } tc && tc.Trim().Length > MaxTaskCode) return $"{at}.taskCode: tối đa {MaxTaskCode} ký tự";
            if (s.StartedAt is not { } start) return $"{at}.startedAt: bắt buộc";
            if (s.FinishedAt is not { } end) return $"{at}.finishedAt: bắt buộc";
            if (end < start) return $"{at}.finishedAt: trước startedAt";
            if (end > limit) return $"{at}.finishedAt: ở tương lai";
            if (s.Turns is < 0) return $"{at}.turns: không được âm";
            if (CostError(s.CostUsd) is { } ce) return $"{at}.costUsd: {ce}";
            if (s.Models is { Count: > MaxModels }) return $"{at}.models: tối đa {MaxModels} model";
            for (var j = 0; j < (s.Models?.Count ?? 0); j++)
            {
                var mat = $"{at}.models[{j}]";
                if (s.Models![j] is not { } m) return $"{mat}: trống";
                if (m.Model is { } name && name.Trim().Length > MaxModel) return $"{mat}.model: tối đa {MaxModel} ký tự";
                if (m.InputTokens is < 0 || m.OutputTokens is < 0 || m.CacheReadTokens is < 0 || m.CacheWriteTokens is < 0)
                    return $"{mat}: số token không được âm";
                if (CostError(m.CostUsd) is { } mce) return $"{mat}.costUsd: {mce}";
            }
        }
        return null;
    }

    private static string? CostError(decimal? cost) => cost switch
    {
        < 0 => "không được âm",
        > MaxCostUsd => $"tối đa {MaxCostUsd} USD",
        _ => null,
    };
}

/// <summary>Body của <see cref="AiUsageRoute.McpPath"/> (runner → Mcp).</summary>
public sealed record AiUsageUpload(IReadOnlyList<AiUsageSession?>? Sessions);

/// <summary>Body của <see cref="AiUsageRoute.Path"/> (Mcp → Api): userId lấy từ token của bot, không do runner tự khai.</summary>
public sealed record AiUsageBatch(Guid UserId, IReadOnlyList<AiUsageSession?>? Sessions);

/// <param name="SourceId">Khoá phiên do runner đặt (vd <c>máy:NV018:jobId</c>) — duy nhất theo tài khoản bot.</param>
/// <param name="Kind">task | chat | meeting | other (trống = other).</param>
/// <param name="Executor">claude / custom… (trống = other).</param>
/// <param name="Status">done | failed | skipped.</param>
/// <param name="CostUsd">Tổng chi phí phiên (USD); trống = nhà cung cấp không báo.</param>
public sealed record AiUsageSession(string? SourceId, string? Kind, Guid? TaskId, Guid? ProjectId, string? TaskCode, string? Executor,
    string? Status, DateTimeOffset? StartedAt, DateTimeOffset? FinishedAt, int? Turns, decimal? CostUsd, IReadOnlyList<AiUsageModel?>? Models);

public sealed record AiUsageModel(string? Model, long? InputTokens, long? OutputTokens, long? CacheReadTokens, long? CacheWriteTokens, decimal? CostUsd);

/// <summary>Kết quả ghi: số phiên nhận, trong đó tạo mới / cập nhật (gửi lại cùng SourceId).</summary>
public sealed record AiUsageAccepted(int Accepted, int Created, int Updated);
