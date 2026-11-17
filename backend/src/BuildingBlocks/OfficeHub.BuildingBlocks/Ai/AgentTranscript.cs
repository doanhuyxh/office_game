namespace OfficeHub.BuildingBlocks.Ai;

/// <summary>
/// Transcript phiên agent lưu trên cloud (TEST-144, chủ dự án chốt 2026-11-17: cả transcript, giữ 90 ngày, mã hoá như lương, admin + HR xem).
/// runner —(token AI của bot)→ <see cref="McpPath"/> trên host OfficeHub.Mcp (chỉ tài khoản bot) —(khoá nội bộ, kèm userId của token)→
/// <see cref="Path"/> trên Api (module Audit: metadata <c>audit.agent_transcripts</c>, nội dung đã mã hoá trên S3).
/// Một bản / (bot, <see cref="AgentTranscriptUpload.Key"/>) — gửi lại = thay bản cũ. Runner che bí mật + gzip trước khi gửi; máy chủ mã hoá
/// (<c>IFieldEncryptor</c>, khoá <c>Encryption__Key</c>) trước khi lên S3. Bot chỉ đọc lại transcript của chính mình (khôi phục lười khi máy mất).
/// </summary>
public static class AgentTranscriptRoute
{
    /// <summary>POST = ghi (body <see cref="AgentTranscriptUpload"/>), GET <c>?key=</c> = đọc lại của chính bot.</summary>
    public const string McpPath = "/mcp/transcripts";
    /// <summary>Đường nội bộ Mcp → Api (nginx chặn từ ngoài): POST body <see cref="AgentTranscriptBatch"/>, GET <c>?userId=&amp;key=</c>.</summary>
    public const string Path = "/api/audit/internal/agent-transcripts";

    public const int RetentionDays = 90;
    public const int MaxKey = 200;
    public const int MaxSessionId = 100;
    public const int MaxCwd = 500;
    public const int MaxBranch = 200;
    public const int MaxSummary = 4000;
    /// <summary>Transcript đã gzip tối đa 6 MB (base64 ≈ 8 MB) — lớn hơn thì runner không gửi.</summary>
    public const int MaxGzipBytes = 6 * 1024 * 1024;
    /// <summary>Body tối đa (base64 + metadata).</summary>
    public const int MaxBodyBytes = 9 * 1024 * 1024;

    public static readonly IReadOnlySet<string> Kinds = new HashSet<string>(StringComparer.Ordinal) { "task", "chat", "meeting" };

    /// <summary>Kiểm tra bản gửi lên; null = hợp lệ, khác = câu lỗi tiếng Việt (400). Trả kèm nội dung gzip đã giải base64.</summary>
    public static string? Validate(AgentTranscriptUpload? u, out byte[] gzip)
    {
        gzip = [];
        if (u is null) return "Thiếu nội dung";
        if (string.IsNullOrWhiteSpace(u.Key) || u.Key.Trim().Length > MaxKey) return $"key: bắt buộc, tối đa {MaxKey} ký tự";
        if (u.Kind is null || !Kinds.Contains(u.Kind)) return "kind: phải là task, chat hoặc meeting";
        if (string.IsNullOrWhiteSpace(u.SessionId) || u.SessionId.Trim().Length > MaxSessionId) return $"sessionId: bắt buộc, tối đa {MaxSessionId} ký tự";
        if (u.Cwd is { Length: > MaxCwd }) return $"cwd: tối đa {MaxCwd} ký tự";
        if (u.Branch is { Length: > MaxBranch }) return $"branch: tối đa {MaxBranch} ký tự";
        if (u.Summary is { Length: > MaxSummary }) return $"summary: tối đa {MaxSummary} ký tự";
        if (string.IsNullOrEmpty(u.ContentBase64)) return "contentBase64: bắt buộc (transcript .jsonl đã gzip, base64)";
        try { gzip = Convert.FromBase64String(u.ContentBase64); }
        catch (FormatException) { return "contentBase64: không phải base64"; }
        if (gzip.Length > MaxGzipBytes) return $"Transcript tối đa {MaxGzipBytes / 1024 / 1024} MB sau khi nén";
        if (gzip.Length < 2 || gzip[0] != 0x1f || gzip[1] != 0x8b) return "contentBase64: phải là dữ liệu gzip";
        return null;
    }
}

/// <param name="Key">Khoá phiên của runner: id việc, hoặc <c>&lt;mã NV&gt;:&lt;id hội thoại / phiên họp&gt;</c>.</param>
/// <param name="SessionId">Id phiên CLI (Claude Code) — tên file transcript khi khôi phục.</param>
/// <param name="Summary">Bản bàn giao ngắn (câu cuối của agent), không bắt buộc.</param>
/// <param name="ContentBase64">Transcript .jsonl đã che bí mật + gzip, base64.</param>
public sealed record AgentTranscriptUpload(string? Key, string? Kind, string? SessionId, string? Cwd, string? Branch, string? Summary, string? ContentBase64);

/// <summary>Body Mcp → Api: userId lấy từ token của bot, không do runner tự khai.</summary>
public sealed record AgentTranscriptBatch(Guid UserId, AgentTranscriptUpload? Upload);

/// <summary>Bản đã lưu (bot đọc lại): metadata + nội dung gzip base64 đã giải mã. <c>Sha256</c> của gzip.</summary>
public sealed record AgentTranscriptDto(string Key, string Kind, string SessionId, string? Cwd, string? Branch, string? Summary, string Sha256,
    long SizeBytes, DateTimeOffset UpdatedAt, DateTimeOffset ExpiresAt, string? ContentBase64);
