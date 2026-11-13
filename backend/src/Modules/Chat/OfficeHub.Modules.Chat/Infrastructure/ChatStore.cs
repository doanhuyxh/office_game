using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Storage;
using OfficeHub.Modules.Chat.Domain;
using OfficeHub.Modules.Chat.Features;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Chat.Infrastructure;

/// <summary>Giới hạn tốc độ gửi: một tài khoản tối đa 1 tin / giây (bộ nhớ, đủ cho một instance Api).</summary>
public sealed class ChatThrottle(TimeProvider clock)
{
    private readonly ConcurrentDictionary<Guid, DateTimeOffset> _last = new();

    public bool TryAcquire(Guid userId)
    {
        var now = clock.GetUtcNow();
        var ok = false;
        _last.AddOrUpdate(userId, _ => { ok = true; return now; }, (_, last) =>
        {
            ok = now - last >= ChatRules.MinSendInterval;
            return ok ? now : last;
        });
        return ok;
    }
}

/// <summary>Truy cập hội thoại / tin nhắn dùng chung cho các endpoint: tra hội thoại, kiểm tra quyền, người nhận, quy đổi DTO, đếm chưa đọc.</summary>
public sealed class ChatStore(ChatDbContext db, ChatRooms rooms, IFileStorage files, IEmployeeDirectory dir, TimeProvider clock)
{
    private Dictionary<Guid, EmployeeRef>? _people;

    /// <summary>Nhân viên đang làm việc có tài khoản, theo UserId — nạp một lần mỗi request (tên người được @nhắc, gợi ý @).</summary>
    public async Task<IReadOnlyDictionary<Guid, EmployeeRef>> PeopleAsync(CancellationToken ct = default) =>
        _people ??= (await dir.ListActiveAsync(ct)).Where(e => e.UserId is not null).GroupBy(e => e.UserId!.Value).ToDictionary(g => g.Key, g => g.First());

    /// <summary>
    /// Người có thể được @nhắc trong hội thoại (TEST-70): Office → mọi nhân viên đang làm có tài khoản; Room / Group → thành viên (đang làm);
    /// Direct → không ai (1-1 không cần nhắc).
    /// </summary>
    public async Task<List<EmployeeRef>> MentionableAsync(Conversation c, CancellationToken ct)
    {
        if (!ChatRules.CanMention(c.Type)) return [];
        var people = await PeopleAsync(ct);
        if (c.Type == ConversationType.Office) return people.Values.ToList();
        var members = await db.RoomMembers.AsNoTracking().Where(m => m.ConversationId == c.Id).Select(m => m.UserId).ToListAsync(ct);
        return members.Select(u => people.GetValueOrDefault(u)).OfType<EmployeeRef>().ToList();
    }

    /// <summary>Số tin chưa đọc có @nhắc tới <paramref name="userId"/> theo hội thoại (cùng điều kiện "chưa đọc" như <see cref="UnreadAsync"/>).</summary>
    public async Task<Dictionary<Guid, int>> UnreadMentionsAsync(Guid userId, IReadOnlyCollection<Guid> conversationIds, CancellationToken ct)
    {
        var rows = await (from m in db.Messages.AsNoTracking()
                          where conversationIds.Contains(m.ConversationId) && m.SenderId != userId && m.DeletedAt == null && m.MentionedUserIds.Contains(userId)
                          join r in db.ReadStates.Where(r => r.UserId == userId) on m.ConversationId equals r.ConversationId into rs
                          from r in rs.DefaultIfEmpty()
                          where m.Seq > (r == null ? 0L : r.LastReadSeq)
                          group m by m.ConversationId into g
                          select new { Id = g.Key, N = g.Count() }).ToListAsync(ct);
        return rows.ToDictionary(x => x.Id, x => x.N);
    }

    /// <summary>Id hội thoại là Guid thật, "office" hoặc "room:&lt;id phòng&gt;" (Realtime dùng hai dạng chuỗi để khỏi tra id).</summary>
    public async Task<Conversation?> ResolveAsync(string? idOrAlias, CancellationToken ct)
    {
        var key = idOrAlias?.Trim() ?? "";
        if (Guid.TryParse(key, out var id)) return await db.Conversations.FirstOrDefaultAsync(c => c.Id == id, ct);
        if (key.Equals(ChatRules.OfficeAlias, StringComparison.OrdinalIgnoreCase))
            return await db.Conversations.FirstOrDefaultAsync(c => c.Type == ConversationType.Office, ct);
        if (key.StartsWith(ChatRules.RoomAliasPrefix, StringComparison.OrdinalIgnoreCase))
        {
            var roomId = key[ChatRules.RoomAliasPrefix.Length..];
            return rooms.Find(roomId) is null ? null : await db.Conversations.FirstOrDefaultAsync(c => c.RoomId == roomId, ct);
        }
        return null;
    }

    public async Task<bool> CanAccessAsync(Conversation c, Guid userId, CancellationToken ct) => c.Type switch
    {
        ConversationType.Office => true,
        ConversationType.Direct => c.UserLowId == userId || c.UserHighId == userId,
        _ => await db.RoomMembers.AnyAsync(m => m.ConversationId == c.Id && m.UserId == userId, ct),
    };

    /// <summary>Null = mọi người (Office). Direct: hai người; Room / Group: thành viên.</summary>
    public async Task<IReadOnlyList<Guid>?> RecipientsAsync(Conversation c, CancellationToken ct) => c.Type switch
    {
        ConversationType.Office => null,
        ConversationType.Direct => [c.UserLowId!.Value, c.UserHighId!.Value],
        _ => await db.RoomMembers.Where(m => m.ConversationId == c.Id).Select(m => m.UserId).ToListAsync(ct),
    };

    public string? RoomNameOf(Conversation c) => c.RoomId is null ? null : rooms.Find(c.RoomId)?.Name;

    /// <summary>Tin kèm tệp + cảm xúc (đủ để quy đổi DTO).</summary>
    public IQueryable<Message> MessagesWithDetails() => db.Messages.Include(m => m.Attachments).Include(m => m.Reactions).AsSplitQuery();

    public async Task<MessageDto> ToDtoAsync(Message m)
    {
        var deleted = m.DeletedAt is not null;
        var atts = new List<AttachmentDto>();
        if (!deleted)
            foreach (var a in m.Attachments)
                atts.Add(new AttachmentDto(a.Id, a.FileName, a.ContentType, a.Size, a.IsImage,
                    await files.GetDownloadUrlAsync(a.FileKey, a.FileName, inline: a.IsImage, ChatRules.AttachmentUrlTtl)));
        // Cảm xúc theo thứ tự lần đầu được thả; tin thu hồi không còn cảm xúc
        var reactions = deleted ? [] : m.Reactions.OrderBy(r => r.CreatedAt).GroupBy(r => r.Emoji)
            .Select(g => new ReactionDto(g.Key, g.Select(r => r.UserId).ToList())).ToList();
        // @nhắc: tên hiện tại (đổi tên → hiện tên mới); người đã nghỉ việc bị bỏ (FE hiện chữ "@mã" thường)
        List<MentionDto> mentions = [];
        if (!deleted && m.MentionedUserIds.Count > 0)
        {
            var people = await PeopleAsync();
            mentions = m.MentionedUserIds.Select(u => people.GetValueOrDefault(u)).OfType<EmployeeRef>()
                .Select(e => new MentionDto(e.UserId!.Value, e.Code, e.FullName)).ToList();
        }
        return new MessageDto(m.Id, m.Seq, m.ConversationId, m.SenderId, m.SenderName, deleted ? null : m.Text, m.CreatedAt, deleted, atts, m.ClientId, m.ByBot,
            m.EditedAt, reactions, mentions);
    }

    /// <summary>Office chưa có dòng đã đọc → khởi tạo ở tin mới nhất (người mới / lần đầu mở chat không bị "hàng nghìn tin chưa đọc").</summary>
    public async Task EnsureOfficeReadAsync(Guid userId, CancellationToken ct)
    {
        var office = await db.Conversations.AsNoTracking().FirstOrDefaultAsync(c => c.Type == ConversationType.Office, ct);
        if (office is null || await db.ReadStates.AnyAsync(r => r.ConversationId == office.Id && r.UserId == userId, ct)) return;
        db.ReadStates.Add(new ReadState { ConversationId = office.Id, UserId = userId, LastReadSeq = office.LastSeq, UpdatedAt = clock.GetUtcNow() });
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException) { db.ChangeTracker.Clear(); } // hai request cùng khởi tạo — dòng của request kia đã đủ
    }

    /// <summary>Hội thoại người dùng thấy được: Office + Direct có mình + Room mình là thành viên.</summary>
    public async Task<List<Conversation>> VisibleAsync(Guid userId, CancellationToken ct)
    {
        var roomIds = db.RoomMembers.Where(m => m.UserId == userId).Select(m => m.ConversationId);
        return await db.Conversations.AsNoTracking()
            .Where(c => c.Type == ConversationType.Office || c.UserLowId == userId || c.UserHighId == userId || roomIds.Contains(c.Id))
            .ToListAsync(ct);
    }

    /// <summary>Số tin chưa đọc (của người khác, chưa thu hồi) theo hội thoại.</summary>
    public async Task<Dictionary<Guid, int>> UnreadAsync(Guid userId, IReadOnlyCollection<Guid> conversationIds, CancellationToken ct)
    {
        var rows = await (from m in db.Messages.AsNoTracking()
                          where conversationIds.Contains(m.ConversationId) && m.SenderId != userId && m.DeletedAt == null
                          join r in db.ReadStates.Where(r => r.UserId == userId) on m.ConversationId equals r.ConversationId into rs
                          from r in rs.DefaultIfEmpty()
                          where m.Seq > (r == null ? 0L : r.LastReadSeq)
                          group m by m.ConversationId into g
                          select new { Id = g.Key, N = g.Count() }).ToListAsync(ct);
        return rows.ToDictionary(x => x.Id, x => x.N);
    }

    /// <summary>Đặt đã đọc đến <paramref name="seq"/> (chỉ tiến, không lùi).</summary>
    public async Task MarkReadAsync(Guid conversationId, Guid userId, long seq, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        for (var attempt = 0; attempt < 2; attempt++)
        {
            var rs = await db.ReadStates.FirstOrDefaultAsync(r => r.ConversationId == conversationId && r.UserId == userId, ct);
            if (rs is null) db.ReadStates.Add(new ReadState { ConversationId = conversationId, UserId = userId, LastReadSeq = seq, UpdatedAt = now });
            else if (rs.LastReadSeq < seq) { rs.LastReadSeq = seq; rs.UpdatedAt = now; }
            else return;
            try { await db.SaveChangesAsync(ct); return; }
            catch (DbUpdateException) when (attempt == 0) { db.ChangeTracker.Clear(); } // đua tạo dòng → thử lại bằng cập nhật
        }
    }
}
