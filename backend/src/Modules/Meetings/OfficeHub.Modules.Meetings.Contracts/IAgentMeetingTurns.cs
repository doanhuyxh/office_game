namespace OfficeHub.Modules.Meetings.Contracts;

/// <summary>
/// Kết quả kiểm tra trước khi lưu tin vào kênh phòng đang có phiên họp agent (TEST-75).
/// </summary>
/// <param name="SessionId">Phiên đang họp trong phòng.</param>
/// <param name="IsAttendee">Người gửi là bot dự họp (theo tài khoản).</param>
/// <param name="Denied">Lý do chặn (409) khi bot dự họp gửi lúc không giữ lượt; null = được gửi.</param>
public sealed record MeetingSpeakGate(Guid SessionId, bool IsAttendee, string? Denied);

/// <summary>Thông điệp lỗi Chat trả (409) khi phòng đang họp agent.</summary>
public static class AgentMeetingTurnsText
{
    public const string NotAttendee = "Phòng đang có cuộc họp agent — chỉ bot dự họp được nhắn vào kênh phòng lúc này";
    public const string EditBlocked = "Phòng đang có cuộc họp agent — bot không sửa tin trong kênh phòng lúc đang họp";
}

/// <summary>
/// Chia lượt nói trong phiên họp agent (module Meetings cài đặt, Chat gọi — TEST-75). Chat không tham chiếu project Meetings, chỉ hợp đồng này.
/// </summary>
public interface IAgentMeetingTurns
{
    /// <summary>Phòng <paramref name="roomId"/> đang họp → cổng gửi tin của <paramref name="userId"/>; không có phiên đang họp → null (chat như thường).</summary>
    Task<MeetingSpeakGate?> GateAsync(string roomId, Guid userId, CancellationToken ct = default);

    /// <summary>
    /// Tin vừa lưu vào kênh phòng đang họp: bot giữ lượt nói → tính lượt, chuyển lượt theo @nhắc (lần lượt) / về bot chủ trì;
    /// người thật @nhắc bot dự họp → bot đó được lượt ngay (tin người thật không tính lượt). Trả tài khoản bot vừa được đánh thức
    /// (<c>meeting_turn</c>) để Chat bỏ đánh thức <c>chat_mention</c> trùng.
    /// </summary>
    Task<IReadOnlyList<Guid>> OnMessageAsync(string roomId, Guid conversationId, Guid senderUserId, IReadOnlyList<Guid> mentionedUserIds,
        CancellationToken ct = default);
}

/// <summary>
/// Kênh chat của phòng họp — module Chat cài đặt, Meetings gọi (chiều ngược lại của <see cref="IAgentMeetingTurns"/>, không tạo vòng tham chiếu).
/// </summary>
public interface IMeetingRoomChannel
{
    /// <summary>Id hội thoại kênh phòng (<c>chat.conversations</c> theo RoomId); phòng chưa có kênh → null.</summary>
    Task<Guid?> ConversationIdAsync(string roomId, CancellationToken ct = default);

    /// <summary>Cho bot dự họp vào kênh phòng (xem / nhắn / được @nhắc) như khi đi vào phòng; đã là thành viên → bỏ qua.</summary>
    Task EnsureMembersAsync(string roomId, IReadOnlyCollection<Guid> userIds, CancellationToken ct = default);

    /// <summary>Tin hệ thống trong kênh phòng (vd báo kết thúc họp) — người gửi "OfficeHub", không tính lượt, không đánh thức ai. Lỗi chỉ ghi log.</summary>
    Task PostSystemAsync(string roomId, string text, CancellationToken ct = default);
}
