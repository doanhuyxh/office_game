using System.Collections.Concurrent;
using System.Threading.Channels;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Hosting;
using OfficeHub.BuildingBlocks.Security;
using OfficeHub.BuildingBlocks.Storage;
using OfficeHub.Modules.Assets.Domain;
using OfficeHub.Modules.Identity.Contracts;
using OfficeHub.Modules.Notification.Contracts;

namespace OfficeHub.Modules.Assets.Infrastructure;

/// <summary>Đánh thức job đăng bài ngay (bài "Đăng ngay", đăng lại) thay vì chờ chu kỳ 30 giây.</summary>
internal sealed class SocialPublishSignal
{
    private readonly Channel<bool> _ch = Channel.CreateBounded<bool>(new BoundedChannelOptions(1) { FullMode = BoundedChannelFullMode.DropWrite });
    public void Poke() => _ch.Writer.TryWrite(true);
    public ValueTask<bool> WaitAsync(CancellationToken ct) => _ch.Reader.WaitToReadAsync(ct);
    public void Drain() { while (_ch.Reader.TryRead(out _)) { } }
}

/// <summary>Thao tác trên bài hiện có của Fanpage (TEST-211).</summary>
internal enum PagePostAction { Hide, Unhide, Delete }

/// <summary>Nghiệp vụ mạng xã hội dùng chung cho endpoint + job: kiểm tra token, đồng bộ trang, huỷ bài chờ, đăng một đích.</summary>
internal sealed class SocialService(AssetsDbContext db, IFacebookGraph graph, IFieldEncryptor enc, IFileStorage files, AssetClock clock, AssetOps ops,
    IAccountService accounts, AssetAccess access)
{
    /// <summary>Kiểm tra token với Facebook rồi đồng bộ danh sách trang. Lỗi → ghi trạng thái token, không ném. Đã SaveChanges.</summary>
    public async Task<string?> CheckAndSyncAsync(SocialAccount a, CancellationToken ct)
    {
        if (a.TokenEncrypted is null) return "Chưa nhập token";
        var token = enc.Decrypt(a.TokenEncrypted);
        var now = clock.Now;
        a.TokenCheckedAt = now;
        try
        {
            var me = await graph.MeAsync(token, ct);
            var pages = await graph.PagesAsync(token, ct);
            a.TokenStatus = SocialTokenStatus.Valid;
            a.TokenError = null;
            a.TokenOwnerName = Trim(me.Name, 200);
            a.PagesSyncedAt = now;
            var existing = await db.SocialPages.Where(p => p.AccountId == a.Id).ToListAsync(ct);
            foreach (var fp in pages)
            {
                var p = existing.FirstOrDefault(x => x.ExternalId == fp.Id);
                if (p is null)
                {
                    p = new SocialPage { AccountId = a.Id, ExternalId = Trim(fp.Id, 50)!, Name = "" };
                    db.SocialPages.Add(p);
                    existing.Add(p);
                }
                p.Name = Trim(fp.Name, 300) ?? fp.Id;
                p.Category = Trim(fp.Category, 200);
                p.Link = Trim(fp.Link, 500);
                p.PictureUrl = Trim(fp.PictureUrl, 2000);
                p.TokenEncrypted = string.IsNullOrEmpty(fp.AccessToken) ? null : enc.Encrypt(fp.AccessToken);
                p.IsActive = true;
                p.SyncedAt = now;
            }
            var seen = pages.Select(p => p.Id).ToHashSet();
            foreach (var p in existing.Where(p => !seen.Contains(p.ExternalId))) { p.IsActive = false; p.SyncedAt = now; }
            await SyncPermissionsAsync(a, token, ct);
            await db.SaveChangesAsync(ct);
            return null;
        }
        catch (Exception ex) when (ex is GraphException or HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            // Chỉ lỗi Facebook trả về (không tạm thời) mới làm token "lỗi"; lỗi mạng / Facebook quá tải giữ nguyên trạng thái
            if (ex is GraphException g && SocialRules.MarksTokenInvalid(g.Error.HttpStatus, g.Error.Code))
            {
                await MarkTokenInvalidAsync(a, g.Error.Message, ct);
                return g.Error.Message;
            }
            await db.SaveChangesAsync(ct);
            return ex is GraphException t ? t.Error.Message : "Không kết nối được Facebook";
        }
    }

    /// <summary>BM đang dùng có token → job kiểm tra định kỳ.</summary>
    public Task<List<Guid>> AccountsToCheckAsync(CancellationToken ct) =>
        db.SocialAccounts.Where(a => a.Status == SocialAccountStatus.Active && a.TokenEncrypted != null).OrderBy(a => a.Name).Select(a => a.Id).ToListAsync(ct);

    /// <summary>
    /// Job: kiểm tra token + đồng bộ trang + làm mới quyền một BM (bỏ qua BM đã ngừng dùng / không còn token). true = token kiểm tra thành công
    /// (job đồng bộ tiếp bài viết của các trang).
    /// </summary>
    public async Task<bool> CheckAccountAsync(Guid accountId, CancellationToken ct)
    {
        var a = await db.SocialAccounts.FirstOrDefaultAsync(x => x.Id == accountId, ct);
        if (a is null || a.Status != SocialAccountStatus.Active || a.TokenEncrypted is null) return false;
        return await CheckAndSyncAsync(a, ct) is null;
    }

    // ---------------- Bài viết hiện có của Fanpage (TEST-206) ----------------

    /// <summary>Trang đang đồng bộ bài (giả định một instance Api) — chặn bấm dồn / job chạy trùng.</summary>
    private static readonly ConcurrentDictionary<Guid, byte> SyncingPages = new();

    public static bool IsSyncingPosts(Guid pageId) => SyncingPages.ContainsKey(pageId);

    /// <summary>Trang của BM có page token (còn trong BM) → job đồng bộ bài.</summary>
    public Task<List<Guid>> PagesToSyncAsync(Guid accountId, CancellationToken ct) =>
        db.SocialPages.Where(p => p.AccountId == accountId && p.IsActive && p.TokenEncrypted != null).OrderBy(p => p.Name).Select(p => p.Id).ToListAsync(ct);

    public async Task SyncPagePostsAsync(Guid pageId, CancellationToken ct)
    {
        var page = await db.SocialPages.FirstOrDefaultAsync(p => p.Id == pageId, ct);
        if (page is not null) await SyncPagePostsAsync(page, ct);
    }

    /// <summary>
    /// Lấy <see cref="SocialRules.PagePostsLimit"/> bài mới nhất của trang rồi upsert (thêm bài mới, cập nhật nội dung + số tương tác bài cũ;
    /// không xoá bài ngoài khoảng). Lỗi → ghi <c>PostsSyncError</c>, không ném; lỗi token 190 / 102 → BM "Token lỗi" + báo (hàm chung).
    /// Đang đồng bộ ở nơi khác → bỏ qua. Đã SaveChanges.
    /// </summary>
    public async Task SyncPagePostsAsync(SocialPage page, CancellationToken ct)
    {
        if (!SyncingPages.TryAdd(page.Id, 0)) return;
        try
        {
            if (!page.IsActive || page.TokenEncrypted is null)
            {
                page.PostsSyncError = !page.IsActive ? "Trang không còn trong BM" : "Chưa có page token — kiểm tra quyền System User rồi đồng bộ lại BM";
                await db.SaveChangesAsync(ct);
                return;
            }
            try
            {
                var posts = await graph.PagePostsAsync(page.ExternalId, enc.Decrypt(page.TokenEncrypted), SocialRules.PagePostsLimit, ct);
                await UpsertPostsAsync(page, posts, ct);
                page.PostsSyncedAt = clock.Now;
                page.PostsSyncError = null;
                await db.SaveChangesAsync(ct);
            }
            catch (GraphException g)
            {
                page.PostsSyncError = Trim(g.Error.Message, 1000);
                var account = SocialRules.IsTokenError(g.Error.Code) ? await db.SocialAccounts.FirstOrDefaultAsync(a => a.Id == page.AccountId, ct) : null;
                if (account is not null) await MarkTokenInvalidAsync(account, g.Error.Message, ct); // đã SaveChanges (gồm lỗi của trang)
                else await db.SaveChangesAsync(ct);
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
            {
                page.PostsSyncError = "Không kết nối được Facebook";
                await db.SaveChangesAsync(ct);
            }
        }
        finally { SyncingPages.TryRemove(page.Id, out _); }
    }

    private async Task UpsertPostsAsync(SocialPage page, List<FbPagePost> posts, CancellationToken ct)
    {
        var now = clock.Now;
        var ids = posts.Select(p => p.Id).Distinct().ToList();
        var existing = await db.SocialPagePosts.Where(x => x.PageId == page.Id && ids.Contains(x.ExternalPostId)).ToDictionaryAsync(x => x.ExternalPostId, ct);
        // Bài đăng từ OfficeHub: đích trên trang này có cùng ExternalPostId
        var targets = (await db.SocialTargets.AsNoTracking().Where(t => t.PageId == page.Id && t.ExternalPostId != null && ids.Contains(t.ExternalPostId))
            .Select(t => new { t.Id, t.ExternalPostId }).ToListAsync(ct)).DistinctBy(t => t.ExternalPostId).ToDictionary(t => t.ExternalPostId!, t => t.Id);
        foreach (var fp in posts.DistinctBy(p => p.Id))
        {
            if (!existing.TryGetValue(fp.Id, out var row))
            {
                row = new SocialPagePost { PageId = page.Id, ExternalPostId = Trim(fp.Id, 100)! };
                db.SocialPagePosts.Add(row);
            }
            // Đã xoá từ OfficeHub (TEST-211): Facebook có thể còn trả bài trong chốc lát → giữ nguyên, không hiện lại
            else if (row.DeletedAt is not null) continue;
            // Trạng thái ẩn theo Facebook (nếu trả is_hidden): ẩn trên Facebook → không rõ ai ẩn; hiện lại → xoá dấu vết ẩn
            if (fp.IsHidden is { } hidden && hidden != row.IsHidden)
            {
                row.IsHidden = hidden;
                row.HiddenAt = null;
                row.HiddenByName = null;
            }
            row.Message = string.IsNullOrWhiteSpace(fp.Message) ? null : fp.Message;
            row.CreatedTime = fp.CreatedTime;
            row.Permalink = Trim(fp.Permalink, 1000);
            row.PictureUrl = Trim(fp.PictureUrl, 2000);
            row.StatusType = Trim(fp.StatusType, 50);
            row.ReactionCount = fp.Reactions;
            row.CommentCount = fp.Comments;
            row.ShareCount = fp.Shares;
            row.SyncedAt = now;
            if (targets.TryGetValue(fp.Id, out var tid)) row.PostTargetId = tid;
        }
    }

    // ---------------- Ẩn / hiện / xoá bài của Fanpage (TEST-211) ----------------

    /// <summary>
    /// Gửi lệnh ẩn / hiện lại / xoá một bài của trang lên Facebook (page token) rồi ghi lại. null = thành công; khác = lý do (API trả 409).
    /// Xoá chỉ đánh dấu <c>DeletedAt</c> (không xoá dòng); bài đã xoá rồi → coi như thành công. Facebook báo bài không còn → đánh dấu đã xoá.
    /// Lỗi token 190 / 102 → BM "Token lỗi" + báo (hàm chung). Quyền xem trang kiểm tra ở endpoint. Đã SaveChanges.
    /// </summary>
    public async Task<string?> ModeratePagePostAsync(SocialPage page, SocialPagePost row, PagePostAction action, string byName, CancellationToken ct)
    {
        if (action == PagePostAction.Delete && row.DeletedAt is not null) return null;
        if (SocialRules.CannotModeratePagePost(page.IsActive, page.TokenEncrypted is not null, row.DeletedAt is not null) is { } blocked) return blocked;
        var token = enc.Decrypt(page.TokenEncrypted!);
        try
        {
            if (action == PagePostAction.Delete) await graph.DeletePostAsync(row.ExternalPostId, token, ct);
            else await graph.SetPostHiddenAsync(row.ExternalPostId, token, action == PagePostAction.Hide, ct);
        }
        catch (GraphException g) when (SocialRules.IsPostGone(g.Error.HttpStatus, g.Error.Code, g.Error.Subcode))
        {
            // Bài đã bị xoá trên Facebook trước đó: xoá → coi như xong; ẩn / hiện → đánh dấu đã xoá rồi báo
            await MarkDeletedAsync(page, row, action == PagePostAction.Delete ? byName : null, ct);
            return action == PagePostAction.Delete ? null : "Bài đã bị xoá trên Facebook — đã bỏ khỏi danh sách";
        }
        catch (GraphException g)
        {
            if (!SocialRules.IsTokenError(g.Error.Code)) return SocialRules.ModerationError(g.Error.Code, g.Error.Message);
            var account = await db.SocialAccounts.FirstAsync(a => a.Id == page.AccountId, ct);
            await MarkTokenInvalidAsync(account, g.Error.Message, ct);
            return $"Token BM không còn dùng được ({g.Error.Message}) — HR cần cập nhật token tại Tài sản → MXH";
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            return "Không kết nối được Facebook — thử lại sau";
        }

        switch (action)
        {
            case PagePostAction.Hide:
                row.IsHidden = true;
                row.HiddenAt = clock.Now;
                row.HiddenByName = Trim(byName, 200);
                break;
            case PagePostAction.Unhide:
                row.IsHidden = false;
                row.HiddenAt = null;
                row.HiddenByName = null;
                break;
            default:
                await MarkDeletedAsync(page, row, byName, ct);
                return null;
        }
        await db.SaveChangesAsync(ct);
        return null;
    }

    /// <summary>Đánh dấu đã xoá + gắn đích OfficeHub cùng ID bài (bài gốc hiện "Đã xoá trên Facebook"). Đã SaveChanges.</summary>
    private async Task MarkDeletedAsync(SocialPage page, SocialPagePost row, string? byName, CancellationToken ct)
    {
        row.DeletedAt = clock.Now;
        row.DeletedByName = Trim(byName, 200);
        row.PostTargetId ??= await db.SocialTargets.AsNoTracking().Where(t => t.PageId == page.Id && t.ExternalPostId == row.ExternalPostId)
            .Select(t => (Guid?)t.Id).FirstOrDefaultAsync(ct);
        await db.SaveChangesAsync(ct);
    }

    /// <summary>
    /// Lấy quyền của token (sau khi /me + trang thành công). Lỗi → token vẫn hợp lệ, danh sách để trống kèm ghi chú. Chưa SaveChanges.
    /// </summary>
    private async Task SyncPermissionsAsync(SocialAccount a, string token, CancellationToken ct)
    {
        try
        {
            a.TokenPermissions = SocialRules.SerializePermissions(await graph.PermissionsAsync(token, ct));
            a.TokenPermissionsError = null;
        }
        catch (Exception ex) when (ex is GraphException or HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            a.TokenPermissions = null;
            a.TokenPermissionsError = Trim("Không lấy được danh sách quyền: " + (ex is GraphException g ? g.Error.Message : "không kết nối được Facebook"), 500);
        }
    }

    /// <summary>
    /// Huỷ các đích đang chờ trên trang của BM: <paramref name="authorEmployeeId"/> != null → chỉ bài của người đó (thu hồi BM);
    /// null → mọi bài (ngừng dùng BM). Chưa SaveChanges. Trả số đích đã huỷ.
    /// </summary>
    public async Task<int> CancelPendingAsync(Guid accountId, Guid? authorEmployeeId, string reason, string byName, CancellationToken ct)
    {
        var pageIds = await db.SocialPages.Where(p => p.AccountId == accountId).Select(p => p.Id).ToListAsync(ct);
        var q = from t in db.SocialTargets
                join p in db.SocialPosts on t.PostId equals p.Id
                where pageIds.Contains(t.PageId) && t.Status == SocialTargetStatus.Pending
                select new { t, p.AuthorEmployeeId };
        if (authorEmployeeId is { } e) q = q.Where(x => x.AuthorEmployeeId == e);
        var rows = await q.ToListAsync(ct);
        foreach (var r in rows)
        {
            r.t.Status = SocialTargetStatus.Cancelled;
            r.t.CancelledAt = clock.Now;
            r.t.CancelledByName = byName;
            r.t.Error = reason;
        }
        return rows.Count;
    }

    /// <summary>Đích kẹt ở "Đang đăng" (Api dừng giữa chừng) → Lỗi, không tự đăng lại (có thể đã lên trang).</summary>
    public Task<int> FailStuckAsync(CancellationToken ct)
    {
        var cutoff = clock.Now - SocialRules.StuckAfter;
        return db.SocialTargets.Where(t => t.Status == SocialTargetStatus.Publishing && t.StartedAt < cutoff)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.Status, SocialTargetStatus.Failed)
                .SetProperty(t => t.Error, "Không rõ kết quả (máy chủ dừng khi đang đăng) — kiểm tra trang trước khi đăng lại"), ct);
    }

    public Task<List<Guid>> DueTargetIdsAsync(int take, CancellationToken ct)
    {
        var now = clock.Now;
        return db.SocialTargets.Where(t => t.Status == SocialTargetStatus.Pending && t.DueAt <= now).OrderBy(t => t.DueAt).Select(t => t.Id)
            .Take(take).ToListAsync(ct);
    }

    /// <summary>
    /// Nhận một đích (Chờ → Đang đăng, nguyên tử) rồi gửi lên Facebook. false = đích đã được xử lý nơi khác / bị huỷ / bị dời giờ.
    /// Điều kiện nhận kiểm tra lại <c>DueAt</c>: sửa bài (TEST-208) giữ khoá dòng đích trong transaction — UPDATE này chờ commit rồi đánh giá lại
    /// trên dòng mới (đã dời giờ → không nhận; đã xoá → không nhận). Sau khi nhận, đích ở Đang đăng nên sửa bài bị chặn (409) → nội dung /
    /// ảnh đọc ở dưới luôn là bản cuối cùng.
    /// </summary>
    public async Task<bool> PublishTargetAsync(Guid targetId, CancellationToken ct)
    {
        var now = clock.Now;
        var claimed = await db.SocialTargets.Where(t => t.Id == targetId && t.Status == SocialTargetStatus.Pending && t.DueAt <= now)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.Status, SocialTargetStatus.Publishing).SetProperty(t => t.StartedAt, now)
                .SetProperty(t => t.Attempts, t => t.Attempts + 1), ct);
        if (claimed == 0) return false;

        var t = await db.SocialTargets.FirstAsync(x => x.Id == targetId, ct);
        var post = await db.SocialPosts.AsNoTracking().FirstAsync(p => p.Id == t.PostId, ct);
        var page = await db.SocialPages.AsNoTracking().FirstAsync(p => p.Id == t.PageId, ct);
        var account = await db.SocialAccounts.FirstAsync(a => a.Id == page.AccountId, ct);

        string? blocker = account.Status != SocialAccountStatus.Active ? "BM đã ngừng dùng"
            : !page.IsActive ? "Trang không còn trong BM (đồng bộ lại để kiểm tra)"
            : page.TokenEncrypted is null ? "Chưa có quyền đăng lên trang này — kiểm tra quyền của System User trong BM rồi đồng bộ lại"
            : null;
        if (blocker is not null)
        {
            await FailAsync(t, post, page, blocker, ct);
            return true;
        }

        try
        {
            var media = await db.SocialMedia.AsNoTracking().Where(m => m.PostId == post.Id && m.Ready).OrderBy(m => m.SortOrder).ToListAsync(ct);
            var refs = new List<FbMediaRef>();
            foreach (var m in media) refs.Add(new(m.Kind, await files.GetDownloadUrlAsync(m.FileKey, SocialRules.FetchUrlTtl)));
            var r = await graph.PublishAsync(page.ExternalId, enc.Decrypt(page.TokenEncrypted!), post.Message, post.Link, refs, ct);
            t.Status = SocialTargetStatus.Published;
            t.PublishedAt = clock.Now;
            t.ExternalPostId = Trim(r.Id, 100);
            t.Permalink = Trim(r.Permalink, 1000);
            t.Error = null;
            await db.SaveChangesAsync(ct);
        }
        catch (GraphException ex)
        {
            if (SocialRules.IsTransient(ex.Error.HttpStatus, ex.Error.Code) && t.Attempts < SocialRules.MaxAttempts)
                await RetryLaterAsync(t, ex.Error.Message, ct);
            else
            {
                if (SocialRules.IsTokenError(ex.Error.Code)) await MarkTokenInvalidAsync(account, ex.Error.Message, ct);
                await FailAsync(t, post, page, ex.Error.Message, ct);
            }
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested)
        {
            // Hết thời gian chờ: Facebook có thể đã nhận bài → không tự đăng lại
            await FailAsync(t, post, page, "Facebook phản hồi quá lâu, không rõ kết quả — kiểm tra trang trước khi đăng lại", ct);
        }
        catch (HttpRequestException)
        {
            if (t.Attempts < SocialRules.MaxAttempts) await RetryLaterAsync(t, "Không kết nối được Facebook", ct);
            else await FailAsync(t, post, page, "Không kết nối được Facebook", ct);
        }
        return true;
    }

    private async Task RetryLaterAsync(SocialPostTarget t, string error, CancellationToken ct)
    {
        t.Status = SocialTargetStatus.Pending;
        t.DueAt = clock.Now + SocialRules.Backoff(t.Attempts);
        t.Error = Trim($"Thử lại lần {t.Attempts + 1}: {error}", 1000);
        await db.SaveChangesAsync(ct);
    }

    private async Task FailAsync(SocialPostTarget t, SocialPost post, SocialPage page, string error, CancellationToken ct)
    {
        t.Status = SocialTargetStatus.Failed;
        t.Error = Trim(error, 1000);
        await db.SaveChangesAsync(ct);
        await ops.NotifyUsersAsync([post.AuthorUserId], NotificationCategories.SocialPost, $"Đăng bài lên \"{page.Name}\" thất bại",
            $"{error} Xem tại Đăng bài MXH.", email: false, link: SocialRules.FacebookPostsLink);
    }

    /// <summary>
    /// Hàm dùng chung cho mọi đường phát hiện token BM hỏng (job 5 giờ, đăng bài lỗi 190 / 102, HR đồng bộ / thay token): đánh dấu lỗi
    /// + báo người đang giữ + mọi HR + mọi Quản trị viên (chuông + email) — chỉ một lần mỗi lần chuyển sang lỗi.
    /// </summary>
    private async Task MarkTokenInvalidAsync(SocialAccount a, string error, CancellationToken ct)
    {
        var was = a.TokenStatus;
        a.TokenStatus = SocialTokenStatus.Invalid;
        a.TokenError = Trim(error, 1000);
        a.TokenCheckedAt = clock.Now;
        await db.SaveChangesAsync(ct);
        if (!SocialRules.ShouldAlertTokenInvalid(was)) return;
        var hr = await accounts.ListByRoleAsync(Roles.Hr, ct);
        var admins = await accounts.ListByRoleAsync(Roles.Admin, ct);
        Guid? holder = a.HolderEmployeeId is { } h && (await access.EmployeesAsync(ct)).GetValueOrDefault(h) is { IsActive: true, UserId: { } u } ? u : null;
        var to = SocialRules.TokenAlertRecipients(holder, hr.Select(x => x.Id), admins.Select(x => x.Id));
        await ops.NotifyUsersAsync(to, NotificationCategories.SocialPost, $"Token BM \"{a.Name}\" không còn dùng được",
            $"{error} HR cần tạo token System User mới và cập nhật tại Tài sản → MXH.", email: true, link: SocialRules.FacebookAccountsLink);
    }

    private static string? Trim(string? s, int max) => string.IsNullOrWhiteSpace(s) ? null : s.Length <= max ? s.Trim() : s[..max];
}

/// <summary>
/// Gửi bài lên Facebook: chạy mỗi 30 giây hoặc ngay khi có bài "Đăng ngay" (<see cref="SocialPublishSignal"/>). Giả định một instance Api.
/// </summary>
/// <summary>
/// Kiểm tra lại token System User của mọi BM đang dùng (TEST-205): <see cref="SocialRules.TokenCheckFirstDelay"/> sau khi Api khởi động,
/// sau đó mỗi <see cref="SocialRules.TokenCheckInterval"/> (5 giờ); token đúng → đồng bộ bài viết các trang (TEST-206). Mỗi BM / trang một scope — lỗi một BM không chặn BM khác. Giả định một instance Api.
/// <c>Facebook__TokenCheckInterval</c> (chỉ dùng khi test) rút chu kỳ + lần chạy đầu.
/// </summary>
internal sealed class SocialTokenCheckJob(IServiceScopeFactory scopes, IOptions<FacebookSettings> settings, ILogger<SocialTokenCheckJob> log,
    JobMonitor monitor) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        var testInterval = settings.Value.TokenCheckInterval is { } t && t > TimeSpan.Zero ? t : (TimeSpan?)null;
        var interval = testInterval ?? SocialRules.TokenCheckInterval;
        var job = monitor.Register("assets.social-token-check", "Tài sản: kiểm tra token Facebook BM", interval);
        await Task.Delay(testInterval ?? SocialRules.TokenCheckFirstDelay, stop);
        while (!stop.IsCancellationRequested)
        {
            try { await job.RunAsync(() => RunOnceAsync(stop)); }
            catch (Exception ex) when (!stop.IsCancellationRequested) { log.LogError(ex, "Lỗi khi kiểm tra token Facebook BM"); }
            await Task.Delay(interval, stop);
        }
    }

    internal async Task RunOnceAsync(CancellationToken ct)
    {
        List<Guid> ids;
        using (var scope = scopes.CreateScope())
            ids = await scope.ServiceProvider.GetRequiredService<SocialService>().AccountsToCheckAsync(ct);
        var failed = 0;
        foreach (var id in ids)
        {
            List<Guid> pages = [];
            using (var scope = scopes.CreateScope())
            {
                try
                {
                    var social = scope.ServiceProvider.GetRequiredService<SocialService>();
                    // Token kiểm tra thành công → đồng bộ bài viết từng trang (TEST-206)
                    if (await social.CheckAccountAsync(id, ct)) pages = await social.PagesToSyncAsync(id, ct);
                }
                catch (Exception ex) when (!ct.IsCancellationRequested) { failed++; log.LogError(ex, "Lỗi khi kiểm tra token BM {AccountId}", id); }
            }
            foreach (var pageId in pages)
            {
                // Mỗi trang một scope — lỗi một trang không chặn trang khác
                using var scope = scopes.CreateScope();
                try { await scope.ServiceProvider.GetRequiredService<SocialService>().SyncPagePostsAsync(pageId, ct); }
                catch (Exception ex) when (!ct.IsCancellationRequested) { failed++; log.LogError(ex, "Lỗi khi đồng bộ bài trang {PageId}", pageId); }
            }
        }
        if (failed > 0) throw new InvalidOperationException($"{failed} lỗi khi kiểm tra token BM / đồng bộ bài trang (xem log)");
    }
}

internal sealed class SocialPublishJob(IServiceScopeFactory scopes, SocialPublishSignal signal, ILogger<SocialPublishJob> log, JobMonitor monitor)
    : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(30);

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        var job = monitor.Register("assets.social-publish", "Tài sản: đăng bài mạng xã hội (Facebook)", Interval);
        await Task.Delay(TimeSpan.FromSeconds(10), stop);
        while (!stop.IsCancellationRequested)
        {
            try { await job.RunAsync(() => RunOnceAsync(stop)); }
            catch (Exception ex) when (!stop.IsCancellationRequested) { log.LogError(ex, "Lỗi khi đăng bài mạng xã hội"); }
            using var wait = CancellationTokenSource.CreateLinkedTokenSource(stop);
            wait.CancelAfter(Interval);
            try { await signal.WaitAsync(wait.Token); }
            catch (OperationCanceledException) when (!stop.IsCancellationRequested) { }
            signal.Drain();
        }
    }

    internal async Task RunOnceAsync(CancellationToken ct)
    {
        using (var scope = scopes.CreateScope())
            await scope.ServiceProvider.GetRequiredService<SocialService>().FailStuckAsync(ct);
        for (var round = 0; round < 10; round++)
        {
            List<Guid> due;
            using (var scope = scopes.CreateScope())
                due = await scope.ServiceProvider.GetRequiredService<SocialService>().DueTargetIdsAsync(20, ct);
            if (due.Count == 0) return;
            foreach (var id in due)
            {
                // Mỗi đích một scope (DbContext mới) — lỗi một đích không ảnh hưởng đích khác
                using var scope = scopes.CreateScope();
                try { await scope.ServiceProvider.GetRequiredService<SocialService>().PublishTargetAsync(id, ct); }
                catch (Exception ex) when (!ct.IsCancellationRequested) { log.LogError(ex, "Lỗi khi đăng đích {TargetId}", id); }
            }
        }
    }
}
