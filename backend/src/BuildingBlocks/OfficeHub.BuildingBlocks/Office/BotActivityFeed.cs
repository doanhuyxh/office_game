namespace OfficeHub.BuildingBlocks.Office;

/// <summary>
/// Một sự kiện trong luồng "agent đang làm gì" (TEST-92, chủ dự án duyệt 2026-11-14): bấm vào bot trong 3D → bảng xem trực tiếp lệnh, file đang sửa (diff),
/// suy nghĩ, lời agent. Chỉ trong RAM của Realtime (không DB / S3). Gửi lại cùng <see cref="Id"/> = cập nhật sự kiện cũ (vd kết quả lệnh về sau):
/// trường null giữ giá trị cũ. Server gán <see cref="Seq"/> (tăng dần theo bot) và <see cref="At"/>; giá trị bên gửi đặt bị bỏ qua.
/// </summary>
/// <param name="Id">Do bên gửi đặt, ≤ <see cref="BotActivityFeedRoute.MaxId"/> ký tự.</param>
/// <param name="Kind">Một trong <see cref="BotActivityFeedRoute.Kinds"/>; lạ → 400.</param>
/// <param name="Title">Dòng tóm tắt, vd "Chạy lệnh", "Sửa src/a.ts".</param>
/// <param name="Text">Lệnh bash / suy nghĩ / lời agent / truy vấn tìm kiếm.</param>
/// <param name="Path">Đường dẫn file tương đối so với repo.</param>
/// <param name="Diff">Unified diff (dòng <c>-</c> / <c>+</c>).</param>
/// <param name="Output">Phần CUỐI kết quả lệnh (cắt giữ đuôi).</param>
/// <param name="Ok">Lệnh / tool thành công hay lỗi; null = chưa xong / không rõ.</param>
/// <param name="Task"><c>session_start</c> / <c>session_end</c>: "MÃ · tên việc".</param>
public sealed record BotActivityEvent(string Id, string Kind, string? Title = null, string? Text = null, string? Path = null, string? Diff = null,
    string? Output = null, bool? Ok = null, string? Task = null, string? Model = null, int? Turns = null, decimal? CostUsd = null,
    long Seq = 0, DateTimeOffset? At = null);

/// <summary>Body <see cref="BotActivityFeedRoute.Path"/>: ≤ <see cref="BotActivityFeedRoute.MaxEvents"/> sự kiện của một bot mỗi lần.</summary>
public sealed record BotActivityBatch(Guid UserId, IReadOnlyList<BotActivityEvent>? Events);

/// <summary>Body <see cref="BotActivityFeedRoute.McpPath"/> (TEST-94): sự kiện của chính bot gọi — userId lấy từ token, không nhận từ body.</summary>
public sealed record BotActivityFeedReport(IReadOnlyList<BotActivityEvent>? Events);

/// <summary>Hợp đồng luồng hoạt động bot (bên gửi → Realtime, khoá <c>Chat__McpToRealtimeKey</c> / <c>Chat__InternalKey</c> như <see cref="BotScreenRoute"/>).</summary>
public static class BotActivityFeedRoute
{
    /// <summary>
    /// Không dùng <c>/rt/internal/bot-activity</c> như mô tả việc: đường đó đã là báo presence (<see cref="BotActivityRoute.Path"/>, body <see cref="BotActivity"/>).
    /// </summary>
    public const string Path = "/rt/internal/bot-activity-feed";

    /// <summary>
    /// Cửa vào công khai trên host OfficeHub.Mcp (TEST-94, sau BearerGate — token AI của bot, như <see cref="BotWork.PresencePath"/>):
    /// body <see cref="BotActivityFeedReport"/>; Mcp xác thực bot rồi chuyển nguyên lô sang <see cref="Path"/> kèm userId của token, không lưu.
    /// </summary>
    public const string McpPath = "/mcp/activity";
    /// <summary>Thân request <see cref="McpPath"/> tối đa (bytes); quá → 400.</summary>
    public const int McpMaxBodyBytes = 256 * 1024;
    /// <summary>Mỗi token gọi <see cref="McpPath"/> tối đa bấy nhiêu lần một giây; quá → 429 (gộp sự kiện thành lô).</summary>
    public const int McpMaxCallsPerSecond = 5;

    public const string SessionStart = "session_start";
    public const string SessionEnd = "session_end";
    public static readonly IReadOnlySet<string> Kinds = new HashSet<string>(StringComparer.Ordinal)
    {
        SessionStart, SessionEnd, "command", "file_edit", "file_write", "file_read", "search", "thinking", "say", "tool",
    };

    public const int MaxEvents = 50;
    /// <summary>Số sự kiện gần nhất của phiên hiện tại giữ cho mỗi bot.</summary>
    public const int BufferSize = 200;
    public const int MaxId = 64;
    public const int MaxTitle = 200;
    public const int MaxText = 4_000;
    public const int MaxPath = 400;
    public const int MaxDiffLines = 200;
    public const int MaxDiffChars = 16_000;
    public const int MaxOutput = 4_000;
    public const int MaxTask = 200;
    public const int MaxModel = 100;
}
