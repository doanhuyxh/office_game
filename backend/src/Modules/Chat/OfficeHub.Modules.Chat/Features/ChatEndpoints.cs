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
        g.MapPatch("/messages/{id:guid}", EditAsync);
        g.MapPost("/messages/{id:guid}/reactions", ReactAsync);
        g.MapGet("/conversations/{id}/search", SearchAsync);
        g.MapPost("/conversations/group", CreateGroupAsync);
        g.MapGet("/conversations/{id}/members", MembersAsync);
        g.MapPost("/conversations/{id}/members", AddMembersAsync);
        g.MapDelete("/conversations/{id}/members/me", LeaveGroupAsync);
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
            ConversationType.Group => c.Title ?? "Nhóm",
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
        var q = store.MessagesWithDetails().AsNoTracking().Where(m => m.ConversationId == conv.Id);
        if (before is > 0) q = q.Where(m => m.Seq < before);
        var rows = await q.OrderByDescending(m => m.Seq).Take(n + 1).ToListAsync(ct);
        var hasMore = rows.Count > n;
        var items = new List<MessageDto>();
        foreach (var m in rows.Take(n).Reverse()) items.Add(await store.ToDtoAsync(m));
        return TypedResults.Ok(new MessagePageDto(items, hasMore));
    }

    private static async Task<Results<Ok<SendResultDto>, ProblemHttpResult, ValidationProblem>> SendAsync(string id, SendRequest req,
        ClaimsPrincipal user, ChatDbContext db, ChatStore store, ChatThrottle throttle, IFileStorage files, IPushSender push, IAccountService accounts,
        IWebhookPublisher webhooks, TimeProvider clock, CancellationToken ct)
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
            var dup = await store.MessagesWithDetails().AsNoTracking()
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
            // TEST-13: chép key tạm → key chính + kiểm chữ ký đầu file trên bản đã chép
            var check = await files.PromoteUploadAsync(t.FileKey, t.FileName, ct);
            if (check.Error is { } bad) return new Validation().Add("uploadIds", $"Tệp \"{t.FileName}\": {bad}").Problem();
            var size = check.Size;
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
        // Tin 1-1 → webhook cá nhân của người nhận (đánh thức agent; người không đặt webhook bỏ qua). Office / kênh phòng: không (quá ồn).
        if (conv.Type == ConversationType.Direct && recipients is not null)
            await webhooks.PublishAsync(recipients.Where(r => r != me).ToList(), WebhookEvents.ChatMessage, new
            {
                conversationId = conv.Id, messageId = msg.Id, seq = msg.Seq, senderId = me, senderName = msg.SenderName, byBot = msg.ByBot,
                text = msg.Text, files = msg.Attachments.Select(a => a.FileName).ToList(), createdAt = msg.CreatedAt, link = $"/chat?c={conv.Id}",
            }, ct);

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

    /// <summary>Sửa nội dung tin của chính mình trong 24 giờ (tệp đính kèm giữ nguyên). Tin không có tệp thì phải còn chữ.</summary>
    private static async Task<Results<Ok<SendResultDto>, ProblemHttpResult, ValidationProblem>> EditAsync(Guid id, EditRequest req,
        ClaimsPrincipal user, ChatDbContext db, ChatStore store, TimeProvider clock, CancellationToken ct)
    {
        var me = Me(user);
        var msg = await store.MessagesWithDetails().FirstOrDefaultAsync(m => m.Id == id && m.SenderId == me, ct);
        if (msg is null || msg.DeletedAt is not null) return Problems.NotFound("tin nhắn");
        var conv = await db.Conversations.FirstAsync(c => c.Id == msg.ConversationId, ct);
        if (!await store.CanAccessAsync(conv, me, ct)) return Problems.NotFound("tin nhắn");

        var now = clock.GetUtcNow();
        if (!ChatRules.CanEdit(msg.CreatedAt, now)) return Problems.Conflict(ChatRules.EditExpiredMessage);
        var text = ChatRules.NormalizeText(req.Text);
        var val = new Validation();
        foreach (var (field, message) in ChatRules.ValidateMessage(text, msg.Attachments.Count)) val.Add(field, message);
        if (val.Failed) return val.Problem();

        if (text != msg.Text)
        {
            msg.Text = text;
            msg.EditedAt = now;
            await db.SaveChangesAsync(ct);
            if (conv.LastSeq == msg.Seq)
            {
                var preview = ChatRules.Preview(text, msg.Attachments.Select(a => (a.FileName, a.IsImage)).ToList());
                await db.Conversations.Where(c => c.Id == conv.Id && c.LastSeq == msg.Seq).ExecuteUpdateAsync(s => s.SetProperty(c => c.LastPreview, preview), ct);
            }
        }
        return TypedResults.Ok(await ResultAsync(conv, msg, store, ct));
    }

    /// <summary>Thả / gỡ cảm xúc (emoji tự do): người đã thả emoji này rồi → gỡ, chưa → thêm. Mọi thành viên hội thoại, kể cả với tin của mình.</summary>
    private static async Task<Results<Ok<SendResultDto>, ProblemHttpResult, ValidationProblem>> ReactAsync(Guid id, ReactRequest req,
        ClaimsPrincipal user, ChatDbContext db, ChatStore store, TimeProvider clock, CancellationToken ct)
    {
        var me = Me(user);
        var msg = await db.Messages.AsNoTracking().FirstOrDefaultAsync(m => m.Id == id, ct);
        var conv = msg is null ? null : await db.Conversations.AsNoTracking().FirstOrDefaultAsync(c => c.Id == msg.ConversationId, ct);
        if (msg is null || msg.DeletedAt is not null || conv is null || !await store.CanAccessAsync(conv, me, ct)) return Problems.NotFound("tin nhắn");
        if (ChatRules.NormalizeEmoji(req.Emoji) is not { } emoji) return new Validation().Add("emoji", "Chọn một emoji").Problem();

        var existing = await db.Reactions.FirstOrDefaultAsync(r => r.MessageId == id && r.UserId == me && r.Emoji == emoji, ct);
        if (existing is not null) db.Reactions.Remove(existing);
        else
        {
            var kinds = await db.Reactions.Where(r => r.MessageId == id).Select(r => r.Emoji).Distinct().ToListAsync(ct);
            if (!kinds.Contains(emoji) && kinds.Count >= ChatRules.MaxReactionKinds)
                return new Validation().Add("emoji", $"Mỗi tin tối đa {ChatRules.MaxReactionKinds} loại cảm xúc").Problem();
            db.Reactions.Add(new MessageReaction { MessageId = id, UserId = me, Emoji = emoji, CreatedAt = clock.GetUtcNow() });
        }
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException) { db.ChangeTracker.Clear(); } // bấm đúp: lần kia đã thêm / gỡ — trả trạng thái hiện tại

        var fresh = await store.MessagesWithDetails().AsNoTracking().FirstAsync(m => m.Id == id, ct);
        return TypedResults.Ok(await ResultAsync(conv, fresh, store, ct));
    }

    /// <summary>Tìm tin (chứa chuỗi, không phân biệt hoa thường) trong một hội thoại mình xem được — mới nhất trước, bỏ tin thu hồi.</summary>
    private static async Task<Results<Ok<List<MessageDto>>, ProblemHttpResult, ValidationProblem>> SearchAsync(string id, string? q,
        ClaimsPrincipal user, ChatStore store, CancellationToken ct)
    {
        var me = Me(user);
        var conv = await store.ResolveAsync(id, ct);
        if (conv is null || HiddenForAi(user, conv) || !await store.CanAccessAsync(conv, me, ct)) return Unknown();
        var term = q?.Trim() ?? "";
        if (term.Length < ChatRules.MinSearchLength) return new Validation().Add("q", $"Nhập ít nhất {ChatRules.MinSearchLength} ký tự").Problem();
        if (term.Length > 100) term = term[..100];

        var pattern = ChatRules.LikeContains(term);
        var rows = await store.MessagesWithDetails().AsNoTracking()
            .Where(m => m.ConversationId == conv.Id && m.DeletedAt == null && m.Text != null && EF.Functions.ILike(m.Text, pattern, "\\"))
            .OrderByDescending(m => m.Seq).Take(ChatRules.MaxSearchResults).ToListAsync(ct);
        var items = new List<MessageDto>();
        foreach (var m in rows) items.Add(await store.ToDtoAsync(m));
        return TypedResults.Ok(items);
    }

    // ---------------- Nhóm tuỳ chọn (Group) ----------------

    /// <summary>Ai cũng tạo được nhóm (chủ dự án chốt 2026-11-12) với các đồng nghiệp đang làm việc. Không qua token AI.</summary>
    private static async Task<Results<Ok<ConversationDto>, ProblemHttpResult, ValidationProblem>> CreateGroupAsync(GroupRequest req,
        ClaimsPrincipal user, ChatDbContext db, ChatStore store, IAccountService accounts, TimeProvider clock, CancellationToken ct)
    {
        var me = Me(user);
        var ids = (req.UserIds ?? []).Where(u => u != Guid.Empty && u != me).Distinct().ToList();
        var val = new Validation();
        foreach (var (field, message) in ChatRules.ValidateGroup(req.Title, ids.Count)) val.Add(field, message);
        if (val.Failed) return val.Problem();
        if (await InactiveAsync(ids, accounts, ct)) return new Validation().Add("userIds", "Có người được chọn không còn hoạt động").Problem();

        var now = clock.GetUtcNow();
        var conv = new Conversation { Type = ConversationType.Group, Title = req.Title!.Trim(), CreatedBy = me, CreatedAt = now };
        db.Conversations.Add(conv);
        foreach (var u in ids.Append(me)) db.RoomMembers.Add(new RoomMember { ConversationId = conv.Id, UserId = u, JoinedAt = now });
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(ToDto(conv, me, store, new Dictionary<Guid, AccountInfo>(), 0));
    }

    private static async Task<bool> InactiveAsync(List<Guid> ids, IAccountService accounts, CancellationToken ct)
    {
        var found = await accounts.GetManyAsync(ids, ct);
        return ids.Any(u => !found.TryGetValue(u, out var a) || !a.IsActive);
    }

    /// <summary>Nhóm mình là thành viên (khác → 404, như hội thoại không tồn tại).</summary>
    private static async Task<Conversation?> MyGroupAsync(string id, Guid me, ChatStore store, CancellationToken ct)
    {
        var conv = await store.ResolveAsync(id, ct);
        return conv is { Type: ConversationType.Group } && await store.CanAccessAsync(conv, me, ct) ? conv : null;
    }

    private static async Task<Results<Ok<List<GroupMemberDto>>, ProblemHttpResult>> MembersAsync(string id, ClaimsPrincipal user, ChatDbContext db,
        ChatStore store, IEmployeeDirectory dir, IAccountService accounts, CancellationToken ct)
    {
        var me = Me(user);
        if (await MyGroupAsync(id, me, store, ct) is not { } conv) return Unknown();
        var userIds = await db.RoomMembers.AsNoTracking().Where(m => m.ConversationId == conv.Id).OrderBy(m => m.JoinedAt).Select(m => m.UserId).ToListAsync(ct);
        var people = (await dir.ListActiveAsync(ct)).Where(e => e.UserId is not null).ToDictionary(e => e.UserId!.Value);
        var accs = await accounts.GetManyAsync(userIds, ct);
        var list = userIds.Select(u => people.TryGetValue(u, out var e)
                ? new GroupMemberDto(u, e.FullName, e.Code, u == conv.CreatedBy)
                : new GroupMemberDto(u, accs.TryGetValue(u, out var a) ? (string.IsNullOrWhiteSpace(a.FullName) ? a.UserName : a.FullName) : "Người dùng", null, u == conv.CreatedBy))
            .ToList();
        return TypedResults.Ok(list);
    }

    /// <summary>Thành viên nào cũng thêm được người vào nhóm; người mới bắt đầu "đã đọc" từ tin mới nhất (không bị tính lịch sử cũ là chưa đọc).</summary>
    private static async Task<Results<NoContent, ProblemHttpResult, ValidationProblem>> AddMembersAsync(string id, MembersRequest req,
        ClaimsPrincipal user, ChatDbContext db, ChatStore store, IAccountService accounts, TimeProvider clock, CancellationToken ct)
    {
        var me = Me(user);
        if (await MyGroupAsync(id, me, store, ct) is not { } conv) return Unknown();
        var current = await db.RoomMembers.Where(m => m.ConversationId == conv.Id).Select(m => m.UserId).ToListAsync(ct);
        var ids = (req.UserIds ?? []).Where(u => u != Guid.Empty && !current.Contains(u)).Distinct().ToList();
        if (ids.Count == 0) return TypedResults.NoContent();
        if (current.Count + ids.Count > ChatRules.MaxGroupMembers)
            return new Validation().Add("userIds", $"Nhóm tối đa {ChatRules.MaxGroupMembers} người").Problem();
        if (await InactiveAsync(ids, accounts, ct)) return new Validation().Add("userIds", "Có người được chọn không còn hoạt động").Problem();

        var now = clock.GetUtcNow();
        foreach (var u in ids)
        {
            db.RoomMembers.Add(new RoomMember { ConversationId = conv.Id, UserId = u, JoinedAt = now });
            if (!await db.ReadStates.AnyAsync(r => r.ConversationId == conv.Id && r.UserId == u, ct))
                db.ReadStates.Add(new ReadState { ConversationId = conv.Id, UserId = u, LastReadSeq = conv.LastSeq, UpdatedAt = now });
        }
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException) { db.ChangeTracker.Clear(); } // hai người cùng thêm một người — đã là thành viên
        return TypedResults.NoContent();
    }

    /// <summary>Rời nhóm: mất quyền xem nhóm (tin cũ của mình vẫn còn). Người cuối cùng rời → nhóm không còn ai thấy.</summary>
    private static async Task<Results<NoContent, ProblemHttpResult>> LeaveGroupAsync(string id, ClaimsPrincipal user, ChatDbContext db,
        ChatStore store, CancellationToken ct)
    {
        var me = Me(user);
        if (await MyGroupAsync(id, me, store, ct) is not { } conv) return Unknown();
        await db.RoomMembers.Where(m => m.ConversationId == conv.Id && m.UserId == me).ExecuteDeleteAsync(ct);
        await db.ReadStates.Where(r => r.ConversationId == conv.Id && r.UserId == me).ExecuteDeleteAsync(ct);
        return TypedResults.NoContent();
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
        var contentType = FileTypes.ContentTypeFor(name); // TEST-13: theo đuôi, không tin trình duyệt
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
