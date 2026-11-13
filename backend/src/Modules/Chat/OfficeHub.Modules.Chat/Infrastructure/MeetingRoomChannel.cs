using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using OfficeHub.Modules.Chat.Domain;
using OfficeHub.Modules.Meetings.Contracts;

namespace OfficeHub.Modules.Chat.Infrastructure;

/// <summary>
/// Kênh phòng cho phiên họp agent (TEST-75) — Meetings gọi qua <see cref="IMeetingRoomChannel"/>. Tin hệ thống chỉ lưu DB (người gửi
/// <see cref="ChatRules.SystemSenderName"/>, SenderId rỗng): người đang mở kênh thấy khi tải lại / đọc tiếp (MCP read_chat), chưa phát realtime.
/// </summary>
internal sealed class MeetingRoomChannel(ChatDbContext db, TimeProvider clock, ILogger<MeetingRoomChannel> log) : IMeetingRoomChannel
{
    public Task<Guid?> ConversationIdAsync(string roomId, CancellationToken ct = default) =>
        db.Conversations.AsNoTracking().Where(c => c.RoomId == roomId).Select(c => (Guid?)c.Id).FirstOrDefaultAsync(ct);

    public async Task EnsureMembersAsync(string roomId, IReadOnlyCollection<Guid> userIds, CancellationToken ct = default)
    {
        var conv = await db.Conversations.AsNoTracking().FirstOrDefaultAsync(c => c.RoomId == roomId, ct);
        if (conv is null || userIds.Count == 0) return;
        var have = await db.RoomMembers.Where(m => m.ConversationId == conv.Id && userIds.Contains(m.UserId)).Select(m => m.UserId).ToListAsync(ct);
        var now = clock.GetUtcNow();
        foreach (var u in userIds.Distinct().Except(have))
        {
            db.RoomMembers.Add(new RoomMember { ConversationId = conv.Id, UserId = u, JoinedAt = now });
            // Như khi đi vào phòng (InternalEndpoints): xem được lịch sử, không bị "hàng loạt tin chưa đọc"
            if (!await db.ReadStates.AnyAsync(r => r.ConversationId == conv.Id && r.UserId == u, ct))
                db.ReadStates.Add(new ReadState { ConversationId = conv.Id, UserId = u, LastReadSeq = conv.LastSeq, UpdatedAt = now });
        }
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException) { db.ChangeTracker.Clear(); } // bot vừa đi vào phòng cùng lúc — bản còn lại đã ghi
    }

    public async Task PostSystemAsync(string roomId, string text, CancellationToken ct = default)
    {
        try
        {
            var conv = await db.Conversations.AsNoTracking().FirstOrDefaultAsync(c => c.RoomId == roomId, ct);
            if (conv is null) return;
            var now = clock.GetUtcNow();
            var body = text.Length > ChatRules.MaxTextLength ? text[..ChatRules.MaxTextLength] : text;
            var msg = new Message { ConversationId = conv.Id, SenderId = Guid.Empty, SenderName = ChatRules.SystemSenderName, Text = body, CreatedAt = now };
            db.Messages.Add(msg);
            await db.SaveChangesAsync(ct);
            var preview = ChatRules.Preview(body, []);
            await db.Conversations.Where(c => c.Id == conv.Id && c.LastSeq < msg.Seq).ExecuteUpdateAsync(s => s
                .SetProperty(c => c.LastSeq, msg.Seq).SetProperty(c => c.LastMessageAt, now).SetProperty(c => c.LastPreview, preview), ct);
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            log.LogError(ex, "Không ghi được tin hệ thống vào kênh phòng {Room}", roomId);
        }
    }
}
