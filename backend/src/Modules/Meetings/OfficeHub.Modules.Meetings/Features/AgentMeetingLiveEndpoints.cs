using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Office;
using OfficeHub.Modules.Meetings.Domain;
using OfficeHub.Modules.Meetings.Infrastructure;

namespace OfficeHub.Modules.Meetings.Features;

/// <summary>
/// Đường nội bộ Realtime → Api (TEST-76), KHÔNG dùng cookie mà dùng khoá <c>Chat__RealtimeToApiKey</c> (trống = <c>Chat__InternalKey</c>,
/// header <see cref="AgentMeetingLiveRoute.KeyHeader"/>): các phiên họp agent đang họp + bot dự họp để văn phòng 3D cho bot đi vào phòng họp.
/// Chỉ gọi trong mạng Docker — nginx chặn <c>/api/meetings/internal/</c> từ ngoài.
/// </summary>
internal static class AgentMeetingLiveEndpoints
{
    public static void Map(RouteGroupBuilder g) => g.MapGet("/live", LiveAsync);

    private static async Task<Results<Ok<List<AgentMeetingLive>>, ProblemHttpResult>> LiveAsync(HttpRequest http, IOptions<ChatSettings> settings,
        MeetingsDbContext db, MeetingRooms rooms, TimeProvider clock, CancellationToken ct)
    {
        if (!BotActivityRoute.KeyMatches(http.Headers[AgentMeetingLiveRoute.KeyHeader].ToString(), settings.Value.RealtimeApiKey))
            return TypedResults.Problem("Khoá nội bộ không đúng", statusCode: StatusCodes.Status401Unauthorized);
        var now = clock.GetUtcNow();
        var rows = await db.AgentMeetings.AsNoTracking().Include(m => m.Bots)
            .Where(m => m.Status == AgentMeetingStatus.Active).ToListAsync(ct);
        // Phiên đã quá trần mà job chưa kịp đóng → coi như đã kết thúc (bot về chỗ ngay, không chờ job mỗi phút)
        return TypedResults.Ok(rows.Where(m => AgentMeetingRules.LimitReached(m, now) is null).Select(m => new AgentMeetingLive(
            m.Id, m.RoomId, rooms.Find(m.RoomId)?.Name ?? m.RoomId, m.Topic, m.TurnsUsed, m.MaxTurns, m.ExpiresAt,
            m.Bots.FirstOrDefault(b => b.EmployeeId == m.CurrentSpeakerEmployeeId)?.UserId,
            m.Bots.OrderByDescending(b => b.EmployeeId == m.ChairEmployeeId).ThenBy(b => b.Name)
                .Select(b => new AgentMeetingLiveBot(b.UserId, b.Name)).ToList())).ToList());
    }
}
