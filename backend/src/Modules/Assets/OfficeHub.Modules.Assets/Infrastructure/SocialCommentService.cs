using System.Collections.Concurrent;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Security;
using OfficeHub.Modules.Assets.Domain;

namespace OfficeHub.Modules.Assets.Infrastructure;

/// <summary>Lỗi trả cho người dùng: mã HTTP (404 / 409 / 400 / 502) + lý do đọc được.</summary>
internal sealed record SocialCallError(int Status, string Message);

/// <summary>
/// Xem bình luận + trả lời bình luận dưới tên Trang (TEST-212). Bình luận không lưu DB — gọi Facebook mỗi lần mở / tải thêm; chỉ lưu nhật ký trả lời
/// (<see cref="SocialCommentReply"/>). Quyền (HR / người đang giữ BM) kiểm tra ở endpoint.
/// </summary>
internal sealed class SocialCommentService(AssetsDbContext db, IFacebookGraph graph, IFieldEncryptor enc, AssetClock clock, SocialService social)
{
    /// <summary>Khoá theo người + bình luận: hai lần bấm gửi cùng lúc đi lần lượt → lần sau thấy lần trước trong nhật ký (giả định một instance Api).</summary>
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> ReplyLocks = new();

    /// <summary>Lý do không trả lời được (null = được) — FE ẩn ô trả lời + hiện lý do.</summary>
    public static string? ReplyBlockedReason(SocialPage page, SocialAccount account, SocialPagePost row) =>
        SocialRules.CannotReply(page.IsActive, page.TokenEncrypted is not null, row.DeletedAt is not null, account.TokenStatus,
            SocialRules.ParsePermissions(account.TokenPermissions));

    /// <summary>Bình luận cấp 1 của bài (<paramref name="commentId"/> null, mới nhất trước) hoặc trả lời của một bình luận (cũ nhất trước).</summary>
    public async Task<(FbCommentPage? Page, SocialCallError? Error)> ListAsync(SocialPage page, SocialPagePost row, string? commentId, string? after,
        CancellationToken ct)
    {
        if (row.DeletedAt is not null) return (null, new(StatusCodes.Status404NotFound, "Bài viết không còn trên Facebook"));
        if (SocialRules.CannotModeratePagePost(page.IsActive, page.TokenEncrypted is not null, false) is { } blocked)
            return (null, new(StatusCodes.Status409Conflict, blocked));
        try
        {
            return (await graph.CommentsAsync(commentId ?? row.ExternalPostId, enc.Decrypt(page.TokenEncrypted!), commentId is null, after,
                SocialRules.CommentsPageSize, ct), null);
        }
        catch (GraphException g) { return (null, await FailAsync(page, row, commentId, g, ct)); }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            return (null, NetworkError);
        }
    }

    /// <summary>
    /// Trả lời bình luận dưới tên Trang + ghi nhật ký. Cùng người + cùng bình luận + cùng nội dung trong 30 giây → trả lại trả lời cũ
    /// (<c>Duplicate</c> = true), không gửi lên Facebook lần nữa. <paramref name="message"/> đã kiểm tra bằng <see cref="SocialRules.ValidateReply"/>.
    /// </summary>
    public async Task<(SocialCommentReply? Reply, bool Duplicate, SocialCallError? Error)> ReplyAsync(SocialPage page, SocialAccount account,
        SocialPagePost row, string commentId, string message, Guid userId, string byName, CancellationToken ct)
    {
        if (row.DeletedAt is not null) return (null, false, new(StatusCodes.Status404NotFound, "Bài viết không còn trên Facebook"));
        if (ReplyBlockedReason(page, account, row) is { } blocked) return (null, false, new(StatusCodes.Status409Conflict, blocked));
        var msg = SocialRules.NormalizeReply(message);
        var gate = ReplyLocks.GetOrAdd($"{userId:N}:{commentId}", _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(ct);
        try
        {
            var now = clock.Now;
            var since = now - SocialRules.ReplyDedupeWindow;
            var recent = await db.SocialCommentReplies.AsNoTracking()
                .Where(r => r.FacebookCommentId == commentId && r.ByUserId == userId && r.CreatedAt >= since)
                .OrderByDescending(r => r.CreatedAt).ToListAsync(ct);
            if (recent.FirstOrDefault(r => SocialRules.IsDuplicateReply(r.Message, r.CreatedAt, msg, now)) is { } dup) return (dup, true, null);

            string replyId;
            try { replyId = await graph.ReplyCommentAsync(commentId, enc.Decrypt(page.TokenEncrypted!), msg, ct); }
            catch (GraphException g) { return (null, false, await FailAsync(page, row, commentId, g, ct)); }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
            {
                return (null, false, NetworkError);
            }

            var reply = new SocialCommentReply
            {
                PagePostId = row.Id, FacebookCommentId = commentId, ReplyFacebookId = replyId, Message = msg, ByUserId = userId,
                ByName = byName.Length <= 200 ? byName : byName[..200], CreatedAt = clock.Now,
            };
            db.SocialCommentReplies.Add(reply);
            await db.SaveChangesAsync(ct);
            return (reply, false, null);
        }
        finally { gate.Release(); }
    }

    /// <summary>Nhật ký trả lời theo id Facebook của trả lời (để gắn "Trả lời bởi … lúc …").</summary>
    public async Task<Dictionary<string, SocialCommentReply>> RepliesByFacebookIdAsync(IEnumerable<string> ids, CancellationToken ct)
    {
        var list = ids.Distinct().ToList();
        if (list.Count == 0) return [];
        return (await db.SocialCommentReplies.AsNoTracking().Where(r => list.Contains(r.ReplyFacebookId)).ToListAsync(ct))
            .DistinctBy(r => r.ReplyFacebookId).ToDictionary(r => r.ReplyFacebookId);
    }

    private static readonly SocialCallError NetworkError = new(StatusCodes.Status502BadGateway, "Không gọi được Facebook, thử lại");

    /// <summary>
    /// Lỗi Facebook → lỗi cho người dùng: bài / bình luận không còn → 404 (bài thì đánh dấu đã xoá như TEST-211); 190 / 102 → đánh dấu token BM lỗi
    /// + 409; thiếu quyền → 409 kèm tên quyền; tham số sai (100) → 400; khác → 409.
    /// </summary>
    private async Task<SocialCallError> FailAsync(SocialPage page, SocialPagePost row, string? commentId, GraphException g, CancellationToken ct)
    {
        var e = g.Error;
        if (SocialRules.IsPostGone(e.HttpStatus, e.Code, e.Subcode))
        {
            if (commentId is not null) return new(StatusCodes.Status404NotFound, "Bình luận không còn trên Facebook");
            await social.MarkDeletedAsync(page, row, null, ct);
            return new(StatusCodes.Status404NotFound, "Bài viết không còn trên Facebook");
        }
        if (SocialRules.IsTokenError(e.Code))
        {
            var account = await db.SocialAccounts.FirstAsync(a => a.Id == page.AccountId, ct);
            await social.MarkTokenInvalidAsync(account, e.Message, ct);
            return new(StatusCodes.Status409Conflict, $"Token BM không còn dùng được ({e.Message}) — HR cần cập nhật token tại Tài sản → MXH");
        }
        return new(e.Code == 100 ? StatusCodes.Status400BadRequest : StatusCodes.Status409Conflict, SocialRules.CommentError(e.Code, e.Message));
    }
}
