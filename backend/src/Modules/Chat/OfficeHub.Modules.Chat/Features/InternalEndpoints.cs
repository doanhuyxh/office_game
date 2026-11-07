using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Chat.Domain;
using OfficeHub.Modules.Chat.Infrastructure;

namespace OfficeHub.Modules.Chat.Features;

/// <summary>
/// Đường nội bộ Realtime → Api, KHÔNG dùng cookie mà dùng khoá chung <c>Chat__InternalKey</c> (header X-Chat-Key):
/// chỉ Realtime biết người này đang đứng trong phòng nào ở văn phòng 3D nên chỉ Realtime được cấp quyền xem kênh phòng.
/// </summary>
public static class InternalEndpoints
{
    public const string KeyHeader = "X-Chat-Key";

    public static void Map(RouteGroupBuilder g) => g.MapPost("/rooms/{roomId}/members", JoinRoomAsync);

    private static async Task<Results<NoContent, ProblemHttpResult, ValidationProblem>> JoinRoomAsync(string roomId, JoinRoomRequest req,
        HttpRequest http, IOptions<ChatSettings> settings, ChatDbContext db, ChatRooms rooms, TimeProvider clock, CancellationToken ct)
    {
        if (!KeyMatches(http.Headers[KeyHeader].ToString(), settings.Value.InternalKey))
            return TypedResults.Problem("Khoá nội bộ không đúng", statusCode: StatusCodes.Status401Unauthorized);
        if (req.UserId == Guid.Empty) return new Validation().Add("userId", "Thiếu userId").Problem();
        if (rooms.Find(roomId) is null) return Problems.NotFound("phòng");

        var conv = await db.Conversations.AsNoTracking().FirstOrDefaultAsync(c => c.RoomId == roomId, ct);
        if (conv is null) return Problems.NotFound("kênh phòng");
        if (await db.RoomMembers.AnyAsync(m => m.ConversationId == conv.Id && m.UserId == req.UserId, ct)) return TypedResults.NoContent();

        var now = clock.GetUtcNow();
        db.RoomMembers.Add(new RoomMember { ConversationId = conv.Id, UserId = req.UserId, JoinedAt = now });
        // Xem được lịch sử cũ nhưng không bị "hàng loạt tin chưa đọc" từ trước khi vào phòng
        db.ReadStates.Add(new ReadState { ConversationId = conv.Id, UserId = req.UserId, LastReadSeq = conv.LastSeq, UpdatedAt = now });
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException) { /* hai lần báo cùng lúc — bản còn lại đã ghi */ }
        return TypedResults.NoContent();
    }

    /// <summary>So sánh thời gian cố định (không lộ độ dài khớp qua thời gian phản hồi).</summary>
    public static bool KeyMatches(string? provided, string expected) =>
        !string.IsNullOrEmpty(provided) && !string.IsNullOrEmpty(expected)
        && CryptographicOperations.FixedTimeEquals(SHA256.HashData(Encoding.UTF8.GetBytes(provided)), SHA256.HashData(Encoding.UTF8.GetBytes(expected)));
}
