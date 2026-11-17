namespace OfficeHub.Mcp.Infrastructure;

/// <summary>
/// Hồ sơ tool theo loại phiên agent (TEST-143): agent-runner gọi <c>/mcp?profile=chat|meeting|task</c> → <c>tools/list</c> chỉ trả các tool hợp
/// loại phiên đó, bớt schema nạp vào mỗi lượt gọi model (mỗi tool là tên + mô tả + tham số, gửi lại ở MỌI lượt). Không có / sai <c>profile</c>
/// → đủ tool như cũ (trợ lý AI cá nhân, Claude Desktop…).
/// <para>
/// Đây KHÔNG phải lớp bảo mật: gọi thẳng tool ngoài hồ sơ vẫn chạy, quyền vẫn do Api kiểm tra theo token. Hồ sơ chỉ để model không thấy
/// tool không dùng tới.
/// </para>
/// </summary>
public static class ToolProfiles
{
    public const string QueryKey = "profile";
    public const string Chat = "chat", Meeting = "meeting", Task = "task";

    /// <summary>
    /// chat (người thật @nhắc bot): mọi tool ĐỌC (trả lời bằng số liệu) + gửi / đánh dấu tin + việc dự án (người nhắn nhờ rõ ràng) + đặt / huỷ
    /// phòng họp + go_to (được nhờ vào phòng).
    /// </summary>
    public static readonly IReadOnlySet<string> ChatWrites = new HashSet<string>(StringComparer.Ordinal)
    {
        "send_chat_message", "mark_chat_read", "create_task", "comment_task", "update_task", "update_task_status", "book_meeting_room", "cancel_meeting", "go_to",
    };

    /// <summary>meeting (một lượt nói): mọi tool ĐỌC (số liệu cho phát biểu) + phát biểu / bỏ / chỉ định lượt + tạo việc khi tổng kết + chiếu lên TV phòng.</summary>
    public static readonly IReadOnlySet<string> MeetingWrites = new HashSet<string>(StringComparer.Ordinal)
    {
        "speak_in_meeting", "pass_turn", "assign_turn", "create_task", "present_markdown", "present_document", "stop_presenting",
    };

    /// <summary>
    /// task (làm việc được giao): đủ tool TRỪ tool của phiên họp / chat (runner xử lý trong phiên riêng) và tool tự phục vụ cá nhân / duyệt đơn
    /// (bot không chấm công, xin nghỉ, và không bao giờ duyệt — ServerInstructions). chat / meeting cũng không có create_upload (phiên chỉ có
    /// tool MCP, không Bash để PUT file).
    /// </summary>
    public static readonly IReadOnlySet<string> TaskExcluded = new HashSet<string>(StringComparer.Ordinal)
    {
        "speak_in_meeting", "pass_turn", "assign_turn", "get_my_meeting",
        "list_chats", "read_chat", "send_chat_message", "mark_chat_read",
        // TEST-152: tải tệp hiện chỉ để gửi kèm tin chat (không có trong phiên task) — TEST-153 mở lại khi comment_task nhận tệp
        "create_upload",
        "approve_request", "reject_request", "cancel_my_request",
        "check_in_out", "register_overtime", "submit_attendance_correction", "submit_leave_request",
    };

    /// <summary>Hồ sơ hợp lệ từ query (không phân biệt hoa thường); trống / lạ → null = đủ tool.</summary>
    public static string? Parse(string? value) => value?.Trim().ToLowerInvariant() switch
    {
        Chat => Chat,
        Meeting => Meeting,
        Task => Task,
        _ => null,
    };

    /// <summary>Tool <paramref name="name"/> (đọc hay ghi theo annotation ReadOnly) có trong hồ sơ không.</summary>
    public static bool Allows(string? profile, string name, bool readOnly) => profile switch
    {
        Chat => readOnly || ChatWrites.Contains(name),
        Meeting => readOnly || MeetingWrites.Contains(name),
        Task => !TaskExcluded.Contains(name),
        _ => true,
    };
}
