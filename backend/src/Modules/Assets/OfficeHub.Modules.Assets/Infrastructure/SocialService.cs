using System.Threading.Channels;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
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
            await db.SaveChangesAsync(ct);
            return null;
        }
        catch (Exception ex) when (ex is GraphException or HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            var msg = ex is GraphException g ? g.Error.Message : "Không kết nối được Facebook";
            // Lỗi mạng không làm token thành "lỗi" — chỉ lỗi Facebook trả về mới đánh dấu
            if (ex is GraphException) { a.TokenStatus = SocialTokenStatus.Invalid; a.TokenError = Trim(msg, 1000); }
            await db.SaveChangesAsync(ct);
            return msg;
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

    /// <summary>Nhận một đích (Chờ → Đang đăng, nguyên tử) rồi gửi lên Facebook. false = đích đã được xử lý nơi khác / bị huỷ.</summary>
    public async Task<bool> PublishTargetAsync(Guid targetId, CancellationToken ct)
    {
        var now = clock.Now;
        var claimed = await db.SocialTargets.Where(t => t.Id == targetId && t.Status == SocialTargetStatus.Pending)
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
            $"{error} Xem tại Đăng bài MXH.", email: false, link: "/social");
    }

    /// <summary>Token BM bị Facebook từ chối → đánh dấu lỗi + báo HR và người giữ (một lần mỗi lần chuyển sang lỗi).</summary>
    private async Task MarkTokenInvalidAsync(SocialAccount a, string error, CancellationToken ct)
    {
        var was = a.TokenStatus;
        a.TokenStatus = SocialTokenStatus.Invalid;
        a.TokenError = Trim(error, 1000);
        a.TokenCheckedAt = clock.Now;
        await db.SaveChangesAsync(ct);
        if (was == SocialTokenStatus.Invalid) return;
        var hr = await accounts.ListByRoleAsync(Roles.Hr, ct);
        if (hr.Count == 0) hr = await accounts.ListByRoleAsync(Roles.Admin, ct);
        var to = hr.Select(x => x.Id).ToList();
        if (a.HolderEmployeeId is { } h && (await access.EmployeesAsync(ct)).GetValueOrDefault(h) is { IsActive: true, UserId: { } u }) to.Add(u);
        await ops.NotifyUsersAsync(to, NotificationCategories.SocialPost, $"Token BM \"{a.Name}\" không còn dùng được",
            $"{error} HR cần tạo token System User mới và cập nhật tại Tài sản → MXH.", email: true, link: "/assets?tab=social");
    }

    private static string? Trim(string? s, int max) => string.IsNullOrWhiteSpace(s) ? null : s.Length <= max ? s.Trim() : s[..max];
}

/// <summary>
/// Gửi bài lên Facebook: chạy mỗi 30 giây hoặc ngay khi có bài "Đăng ngay" (<see cref="SocialPublishSignal"/>). Giả định một instance Api.
/// </summary>
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
