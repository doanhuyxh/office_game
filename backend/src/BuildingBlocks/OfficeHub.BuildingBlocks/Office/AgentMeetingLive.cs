namespace OfficeHub.BuildingBlocks.Office;

/// <summary>
/// OfficeHub.Realtime → OfficeHub.Api (TEST-76): Realtime hỏi định kỳ các phiên họp agent ĐANG HỌP để cho bot dự họp đi bộ vào phòng họp,
/// giữ ở đó suốt phiên, bong bóng "🎤 Đang phát biểu" cho bot giữ lượt, rồi về chỗ khi phiên kết thúc. Khoá chiều Realtime → Api
/// (<c>Chat__RealtimeToApiKey</c>, trống = <c>Chat__InternalKey</c>) qua header <see cref="KeyHeader"/> — không thêm biến .env.
/// </summary>
public static class AgentMeetingLiveRoute
{
    public const string Path = "/api/meetings/internal/live";
    public const string KeyHeader = "X-Chat-Key";
    /// <summary>Chu kỳ hỏi (giây) — cùng nhịp thanh trạng thái họp trên web (3 giây khi đang họp).</summary>
    public const int PollSeconds = 3;
}

/// <param name="RoomId">Id phòng họp trong shared/office-map.json.</param>
/// <param name="SpeakerUserId">Tài khoản bot đang giữ lượt nói; null = chưa ai.</param>
public sealed record AgentMeetingLive(Guid SessionId, string RoomId, string RoomName, string Topic, int TurnsUsed, int MaxTurns,
    DateTimeOffset ExpiresAt, Guid? SpeakerUserId, IReadOnlyList<AgentMeetingLiveBot> Bots);

public sealed record AgentMeetingLiveBot(Guid UserId, string Name);
