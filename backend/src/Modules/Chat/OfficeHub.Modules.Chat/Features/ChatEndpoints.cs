using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.BuildingBlocks.Storage;
using OfficeHub.Modules.Chat.Domain;
using OfficeHub.Modules.Chat.Infrastructure;
using OfficeHub.Modules.Identity.Contracts;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Chat.Features;

/// <summary>
/// Chat: danh sách hội thoại, lịch sử (con trỏ Seq), gửi / thu hồi tin, đã đọc, chọn người nhắn 1-1, tải tệp đính kèm.
/// Mọi endpoint đòi đăng nhập; người ngoài hội thoại (Direct / Room) nhận 404 — không ai (kể cả admin, HR) có đường đọc tin 1-1 của người khác.
/// Tin được gửi qua hub Realtime (<c>ChatHub</c>) gọi lại các endpoint này bằng cookie của người dùng rồi phát đi.
/// </summary>
public static class ChatEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/conversations", ListConversationsAsync);
        g.MapGet("/unread-count", UnreadCountAsync);
        g.MapGet("/people", PeopleAsync);
        g.MapPost("/conversations/direct", CreateDirectAsync);
        g.MapGet("/conversations/{id}/messages", ListMessagesAsync);
        g.MapPost("/conversations/{id}/messages", SendAsync);
        g.MapPost("/conversations/{id}/read", ReadAsync);
        g.MapDelete("/messages/{id:guid}", DeleteAsync);
        g.MapPost("/uploads", CreateUploadAsync);
        g.MapGet("/attachments/{id:guid}/url", AttachmentUrlAsync);
    }

    private static Guid Me(ClaimsPrincipal user) => user.GetUserId() ?? throw new InvalidOperationException("Thiếu tài khoản");

    private static ProblemHttpResult Unknown() => Problems.NotFound("hội thoại");

    // ---------------- Hội thoại ----------------

    private static async Task<Results<Ok<List<ConversationDto>>, ProblemHttpResult>> ListConversationsAsync(ClaimsPrincipal user, ChatDbContext db, ChatStore store,
        IAccountService accounts, CancellationToken ct)
    {
        if (await AiGuardAsync(user, accounts, ct) is { } denied) return denied;
        var me = Me(user);
        await store.EnsureOfficeReadAsync(me, ct);
        var convs = (await store.VisibleAsync(me, ct)).Where(c => !user.IsAccessToken() || ChatRules.BotCanUse(c.Type)).ToList();
        var unread = await store.UnreadAsync(me, convs.Select(c => c.Id).ToList(), ct);
        var peerIds = convs.Where(c => c.Type == ConversationType.Direct).Select(c => PeerOf(c, me)).Distinct().ToList();
        var peers = peerIds.Count > 0 ? await accounts.GetManyAsync(peerIds, ct) : new Dictionary<Guid, AccountInfo>();

        var list = convs
            .OrderBy(c => c.Type == ConversationType.Office ? 0 : 1)
            .ThenByDescending(c => c.LastMessageAt ?? DateTimeOffset.MinValue)
            .ThenBy(c => c.CreatedAt)
            .Select(c => ToDto(c, me, store, peers, unread.GetValueOrDefault(c.Id)))
            .ToList();
        return TypedResults.Ok(list);
    }

    private static Guid PeerOf(Conversation c, Guid me) => c.UserLowId == me ? c.UserHighId!.Value : c.UserLowId!.Value;

    private static ConversationDto ToDto(Conversation c, Guid me, ChatStore store, IReadOnlyDictionary<Guid, AccountInfo> peers, int unread)
    {
        Guid? peer = c.Type == ConversationType.Direct ? PeerOf(c, me) : null;
        var title = c.Type switch
        {
            ConversationType.Office => "Toàn văn phòng",
            ConversationType.Room => store.RoomNameOf(c) ?? c.RoomId ?? "Phòng",
            _ => peers.TryGetValue(peer!.Value, out var p) ? (string.IsNullOrWhiteSpace(p.FullName) ? p.UserName : p.FullName) : "Người dùng",
        };
        var peerIsBot = peer is { } pid && peers.TryGetValue(pid, out var pa) && pa.IsBot;
        return new ConversationDto(c.Id, c.Type, title, c.RoomId, peer, c.LastMessageAt, c.LastPreview, unread, peerIsBot);
    }

    /// <summary>
    /// Token AI: chỉ tài khoản bot (cờ HR đặt) được chat — tin 1-1 của người thật không đi ra nhà cung cấp AI. Null = cho phép.
    /// Danh sách route token được gọi nằm ở AccessTokenAuth (không có tạo 1-1, tải tệp, thu hồi, tìm người).
    /// </summary>
    private static async Task<ProblemHttpResult?> AiGuardAsync(ClaimsPrincipal user, IAccountService accounts, CancellationToken ct)
    {
        if (!user.IsAccessToken()) return null;
        var acc = await accounts.GetAsync(Me(user), ct);
        return acc?.IsBot == true ? null : TypedResults.Problem(ChatRules.AiNotBotMessage, statusCode: StatusCodes.Status403Forbidden);
    }

    /// <summary>Bot không thấy kênh phòng (như không tồn tại).</summary>
    private static bool HiddenForAi(ClaimsPrincipal user, Conversation conv) => user.IsAccessToken() && !ChatRules.BotCanUse(conv.Type);

    private static async Task<Results<Ok<UnreadDto>, ProblemHttpResult>> UnreadCountAsync(ClaimsPrincipal user, ChatStore store,
        IAccountService accounts, CancellationToken ct)
    {
        if (await AiGuardAsync(user, accounts, ct) is { } denied) return denied;
        var me = Me(user);
        await store.EnsureOfficeReadAsync(me, ct);
        var ids = (await store.VisibleAsync(me, ct)).Where(c => !HiddenForAi(user, c)).Select(c => c.Id).ToList();
        return TypedResults.Ok(new UnreadDto((await store.UnreadAsync(me, ids, ct)).Values.Sum()));
    }

    private static async Task<Ok<List<PersonDto>>> PeopleAsync(string? search, ClaimsPrincipal user, IEmployeeDirectory dir, CancellationToken ct)
    {
        var me = Me(user);
        var term = ChatRules.Fold(search?.Trim());
        var people = (await dir.ListActiveAsync(ct))
            .Where(e => e.UserId is { } u && u != me)
            .Where(e => term.Length == 0 || ChatRules.Fold(e.FullName).Contains(term) || ChatRules.Fold(e.Code).Contains(term))
            .OrderBy(e => e.FullName, StringComparer.CurrentCultureIgnoreCase)
            .Take(20)
            .Select(e => new PersonDto(e.UserId!.Value, e.FullName, e.Code, e.DepartmentName))
            .ToList();
        return TypedResults.Ok(people);
    }

    private static async Task<Results<Ok<ConversationDto>, ProblemHttpResult, ValidationProblem>> CreateDirectAsync(DirectRequest req,
        ClaimsPrincipal user, ChatDbContext db, ChatStore store, IAccountService accounts, TimeProvider clock, CancellationToken ct)
    {
        var me = Me(user);
        if (req.UserId == Guid.Empty || req.UserId == me)
            return new Validation().Add("userId", "Chọn một đồng nghiệp khác để nhắn tin").Problem();
        var peer = await accounts.GetAsync(req.UserId, ct);
        if (peer is null || !peer.IsActive) return Problems.NotFound("người dùng");

        var (low, high) = ChatRules.DirectPair(me, req.UserId);
        var conv = await db.Conversations.FirstOrDefaultAsync(c => c.UserLowId == low && c.UserHighId == high, ct);
        if (conv is null)
        {
            conv = new Conversation { Type = ConversationType.Direct, UserLowId = low, UserHighId = high, CreatedAt = clock.GetUtcNow() };
            db.Conversations.Add(conv);
            try { await db.SaveChangesAsync(ct); }
            catch (DbUpdateException) // hai bên cùng mở lần đầu: bản của bên kia thắng
            {
                db.ChangeTracker.Clear();
                conv = await db.Conversations.FirstAsync(c => c.UserLowId == low && c.UserHighId == high, ct);
            }
        }
        var unread = await store.UnreadAsync(me, [conv.Id], ct);
        return TypedResults.Ok(ToDto(conv, me, store, new Dictionary<Guid, AccountInfo> { [req.UserId] = peer }, unread.GetValueOrDefault(conv.Id)));
    }

    // ---------------- Tin nhắn ----------------

    private static async Task<Results<Ok<MessagePageDto>, ProblemHttpResult>> ListMessagesAsync(string id, long? before, int? take,
        ClaimsPrincipal user, ChatDbContext db, ChatStore store, IAccountService accounts, CancellationToken ct)
    {
        if (await AiGuardAsync(user, accounts, ct) is { } denied) return denied;
        var me = Me(user);
        var conv = await store.ResolveAsync(id, ct);
        if (conv is null || HiddenForAi(user, conv) || !await store.CanAccessAsync(conv, me, ct)) return Unknown();

        var n = Math.Clamp(take ?? 50, 1, 100);
        var q = db.Messages.AsNoTracking().Include(m => m.Attachments).Where(m => m.ConversationId == conv.Id);
        if (before is > 0) q = q.Where(m => m.Seq < before);
        var rows = await q.OrderByDescending(m => m.Seq).Take(n + 1).ToListAsync(ct);
        var hasMore = rows.Count > n;
        var items = new List<MessageDto>();
        foreach (var m in rows.Take(n).Reverse()) items.Add(await store.ToDtoAsync(m));
        return TypedResults.Ok(new MessagePageDto(items, hasMore));
    }

    private static async Task<Results<Ok<SendResultDto>, ProblemHttpResult, ValidationProblem>> SendAsync(string id, SendRequest req,
        ClaimsPrincipal user, ChatDbContext db, ChatStore store, ChatThrottle throttle, IFileStorage files, IPushSender push, IAccountService accounts,
        TimeProvider clock, CancellationToken ct)
    {
        if (await AiGuardAsync(user, accounts, ct) is { } denied) return denied;
        var me = Me(user);
        var conv = await store.ResolveAsync(id, ct);
        if (conv is null || HiddenForAi(user, conv) || !await store.CanAccessAsync(conv, me, ct)) return Unknown();
        var byBot = user.IsAccessToken();

        var clientId = string.IsNullOrWhiteSpace(req.ClientId) ? null : req.ClientId.Trim();
        if (clientId is { Length: > 64 }) clientId = clientId[..64];

        // Gửi lại cùng ClientId (mạng chập chờn) → trả tin cũ, không tạo bản sao
        if (clientId is not null)
        {
            var dup = await db.Messages.AsNoTracking().Include(m => m.Attachments)
                .FirstOrDefaultAsync(m => m.ConversationId == conv.Id && m.SenderId == me && m.ClientId == clientId, ct);
            if (dup is not null) return TypedResults.Ok(await ResultAsync(conv, dup, store, ct));
        }

        var text = ChatRules.NormalizeText(req.Text);
        var uploadIds = (req.UploadIds ?? []).Where(u => u != Guid.Empty).Distinct().ToList();
        var val = new Validation();
        foreach (var (field, message) in ChatRules.ValidateMessage(text, uploadIds.Count)) val.Add(field, message);
        if (byBot && uploadIds.Count > 0) val.Add("uploadIds", "Bot chưa gửi được tệp đính kèm — chỉ gửi chữ");
        if (val.Failed) return val.Problem();
        if (byBot)
        {
            var since = clock.GetUtcNow() - ChatRules.BotQuotaWindow;
            var sent = await db.Messages.CountAsync(m => m.SenderId == me && m.ByBot && m.CreatedAt > since, ct);
            if (!ChatRules.BotQuotaLeft(sent))
                return TypedResults.Problem($"Bot đã gửi {ChatRules.BotMessagesPerHour} tin trong 1 giờ qua — đợi rồi gửi tiếp",
                    statusCode: StatusCodes.Status429TooManyRequests);
        }
        if (!throttle.TryAcquire(me)) return TypedResults.Problem("Gửi chậm lại một chút", statusCode: StatusCodes.Status429TooManyRequests);

        var tickets = uploadIds.Count == 0 ? [] : await db.UploadTickets.Where(t => uploadIds.Contains(t.Id) && t.UserId == me && t.ConversationId == conv.Id).ToListAsync(ct);
        if (tickets.Count != uploadIds.Count)
            return new Validation().Add("uploadIds", "Tệp đính kèm không hợp lệ hoặc đã hết hạn — tải lại tệp").Problem();

        var now = clock.GetUtcNow();
        var msg = new Message
        {
            ConversationId = conv.Id, SenderId = me, CreatedAt = now, Text = text, ClientId = clientId, ByBot = byBot,
            SenderName = user.FindFirstValue(ClaimNames.FullName) ?? user.Identity?.Name ?? "?",
        };
        foreach (var t in tickets)
        {
            var size = await files.GetSizeAsync(t.FileKey, ct);
            if (size is null) return Problems.Conflict($"Tệp \"{t.FileName}\" chưa tải lên xong — thử lại");
            if (size.Value <= 0 || size.Value > ChatRules.MaxSizeOf(t.ContentType))
            {
                await files.DeleteAsync(t.FileKey, ct);
                return new Validation().Add("uploadIds", $"Tệp \"{t.FileName}\" vượt giới hạn dung lượng").Problem();
            }
            msg.Attachments.Add(new MessageAttachment
            {
                MessageId = msg.Id, FileKey = t.FileKey, FileName = t.FileName, ContentType = t.ContentType, Size = size.Value,
                IsImage = ChatRules.IsImage(t.ContentType),
            });
        }
        db.Messages.Add(msg);
        db.UploadTickets.RemoveRange(tickets);
        await db.SaveChangesAsync(ct);

        var preview = ChatRules.Preview(text, msg.Attachments.Select(a => (a.FileName, a.IsImage)).ToList());
        await db.Conversations.Where(c => c.Id == conv.Id && c.LastSeq < msg.Seq).ExecuteUpdateAsync(s => s
            .SetProperty(c => c.LastSeq, msg.Seq).SetProperty(c => c.LastMessageAt, now).SetProperty(c => c.LastPreview, preview), ct);
        await store.MarkReadAsync(conv.Id, me, msg.Seq, ct);

        var recipients = await store.RecipientsAsync(conv, ct);
        // recipients == null ↔ kênh Office (toàn công ty) — không push, quá ồn; Direct/Room thì push cho người nhận (trừ người gửi).
        if (recipients is not null)
            await push.PushAsync(recipients.Where(r => r != me), msg.SenderName, preview, $"/chat?c={conv.Id}", ct);

        return TypedResults.Ok(new SendResultDto(await store.ToDtoAsync(msg), conv.Type, conv.RoomId, store.RoomNameOf(conv), recipients));
    }

    private static async Task<SendResultDto> ResultAsync(Conversation conv, Message msg, ChatStore store, CancellationToken ct) =>
        new(await store.ToDtoAsync(msg), conv.Type, conv.RoomId, store.RoomNameOf(conv), await store.RecipientsAsync(conv, ct));

    /// <summary>Thu hồi = xoá mềm: ẩn nội dung với mọi người, vẫn giữ trong DB / S3. Chỉ người gửi; thu hồi lại tin đã thu hồi là no-op.</summary>
    private static async Task<Results<Ok<DeleteResultDto>, ProblemHttpResult>> DeleteAsync(Guid id, ClaimsPrincipal user, ChatDbContext db,
        ChatStore store, TimeProvider clock, CancellationToken ct)
    {
        var me = Me(user);
        var msg = await db.Messages.FirstOrDefaultAsync(m => m.Id == id && m.SenderId == me, ct);
        if (msg is null) return Problems.NotFound("tin nhắn");
        var conv = await db.Conversations.FirstAsync(c => c.Id == msg.ConversationId, ct);
        if (!await store.CanAccessAsync(conv, me, ct)) return Problems.NotFound("tin nhắn");

        if (msg.DeletedAt is null)
        {
            msg.DeletedAt = clock.GetUtcNow();
            await db.SaveChangesAsync(ct);
            if (conv.LastSeq == msg.Seq)
                await db.Conversations.Where(c => c.Id == conv.Id && c.LastSeq == msg.Seq).ExecuteUpdateAsync(s => s.SetProperty(c => c.LastPreview, ChatRules.DeletedPreview), ct);
        }
        return TypedResults.Ok(new DeleteResultDto(conv.Id, msg.Id, conv.Type, conv.RoomId, await store.RecipientsAsync(conv, ct)));
    }

    private static async Task<Results<NoContent, ProblemHttpResult>> ReadAsync(string id, ClaimsPrincipal user, ChatStore store,
        IAccountService accounts, CancellationToken ct)
    {
        if (await AiGuardAsync(user, accounts, ct) is { } denied) return denied;
        var me = Me(user);
        var conv = await store.ResolveAsync(id, ct);
        if (conv is null || HiddenForAi(user, conv) || !await store.CanAccessAsync(conv, me, ct)) return Unknown();
        await store.MarkReadAsync(conv.Id, me, conv.LastSeq, ct);
        return TypedResults.NoContent();
    }

    // ---------------- Tệp đính kèm ----------------

    private static async Task<Results<Ok<UploadTicketDto>, ProblemHttpResult, ValidationProblem>> CreateUploadAsync(UploadRequest req,
        ClaimsPrincipal user, ChatDbContext db, ChatStore store, IFileStorage files, TimeProvider clock, CancellationToken ct)
    {
        var me = Me(user);
        var conv = await store.ResolveAsync(req.ConversationId, ct);
        if (conv is null || !await store.CanAccessAsync(conv, me, ct)) return Unknown();

        var name = ChatRules.CleanFileName(req.FileName);
        var contentType = ChatRules.NormalizeContentType(req.ContentType);
        var val = new Validation();
        foreach (var (field, message) in ChatRules.ValidateUpload(name, contentType, req.Size)) val.Add(field, message);
        if (val.Failed) return val.Problem();

        var now = clock.GetUtcNow();
        // Dọn vé bỏ dở (đã xin link nhưng không bao giờ gửi tin) — file mồ côi trên S3 giữ lại, chỉ xoá dòng vé
        await db.UploadTickets.Where(t => t.CreatedAt < now - ChatRules.TicketCleanupAfter).ExecuteDeleteAsync(ct);

        var ticket = new UploadTicket
        {
            ConversationId = conv.Id, UserId = me, FileName = name, ContentType = contentType, Size = req.Size, CreatedAt = now, FileKey = "",
        };
        ticket.FileKey = ChatRules.FileKey(now, ticket.Id, name);
        db.UploadTickets.Add(ticket);
        await db.SaveChangesAsync(ct);
        var url = await files.GetUploadUrlAsync(ticket.FileKey, contentType, ChatRules.UploadUrlTtl);
        return TypedResults.Ok(new UploadTicketDto(ticket.Id, url, contentType, now + ChatRules.UploadUrlTtl));
    }

    private static async Task<Results<Ok<UrlDto>, ProblemHttpResult>> AttachmentUrlAsync(Guid id, bool? download, ClaimsPrincipal user,
        ChatDbContext db, ChatStore store, IFileStorage files, CancellationToken ct)
    {
        var me = Me(user);
        var att = await db.Attachments.AsNoTracking().FirstOrDefaultAsync(a => a.Id == id, ct);
        var msg = att is null ? null : await db.Messages.AsNoTracking().FirstOrDefaultAsync(m => m.Id == att.MessageId && m.DeletedAt == null, ct);
        var conv = msg is null ? null : await db.Conversations.AsNoTracking().FirstOrDefaultAsync(c => c.Id == msg.ConversationId, ct);
        if (att is null || conv is null || !await store.CanAccessAsync(conv, me, ct)) return Problems.NotFound("tệp");
        var url = await files.GetDownloadUrlAsync(att.FileKey, att.FileName, inline: att.IsImage && download != true, ChatRules.AttachmentUrlTtl);
        return TypedResults.Ok(new UrlDto(url));
    }
}
