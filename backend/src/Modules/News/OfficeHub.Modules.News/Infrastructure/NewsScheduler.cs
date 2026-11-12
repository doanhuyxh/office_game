using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using OfficeHub.BuildingBlocks.Hosting;
using OfficeHub.Modules.News.Domain;
using OfficeHub.Modules.News.Features;

namespace OfficeHub.Modules.News.Infrastructure;

/// <summary>
/// Mỗi 30 giây đăng các bài hẹn giờ đã tới giờ (TEST-54). Đăng = Seq mới (bài nổi lên đầu feed + tính "bài mới"), CreatedAt = lúc đăng,
/// rồi gửi email (nếu chọn) và chuông @nhắc như lúc đăng ngay. Chỉ chạy ở host Api, giả định một instance.
/// </summary>
internal sealed class NewsScheduler(IServiceScopeFactory scopes, ILogger<NewsScheduler> log, JobMonitor monitor) : BackgroundService
{
    public static readonly TimeSpan Interval = TimeSpan.FromSeconds(30);

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        var job = monitor.Register("news.scheduler", "Bảng tin: đăng bài hẹn giờ", Interval);
        await Task.Delay(TimeSpan.FromSeconds(20), stop); // đợi migrate
        using var timer = new PeriodicTimer(Interval);
        do
        {
            try { await job.RunAsync(() => RunOnceAsync(stop)); }
            catch (Exception ex) when (!stop.IsCancellationRequested) { log.LogError(ex, "Lỗi khi đăng bài hẹn giờ"); }
        } while (await timer.WaitForNextTickAsync(stop));
    }

    internal async Task RunOnceAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var sp = scope.ServiceProvider;
        var db = sp.GetRequiredService<NewsDbContext>();
        var now = sp.GetRequiredService<TimeProvider>().GetUtcNow();
        var due = await db.Posts.Where(p => p.PublishAt != null && p.PublishAt <= now && p.DeletedAt == null)
            .OrderBy(p => p.PublishAt).Select(p => p.Id).Take(20).ToListAsync(ct);
        foreach (var id in due)
            if (await PublishAsync(db, sp.GetRequiredService<NewsStore>(), id, now, ct))
                log.LogInformation("Đã đăng bài hẹn giờ {Post}", id);
    }

    /// <summary>
    /// Đăng một bài hẹn giờ (job hoặc tác giả bấm "Đăng ngay"). Seq là identity ALWAYS → <c>SET "Seq" = DEFAULT</c> lấy số mới.
    /// Điều kiện <c>PublishAt IS NOT NULL</c> chặn đăng hai lần (job + tác giả cùng lúc). False = bài đã đăng / không còn.
    /// </summary>
    internal static async Task<bool> PublishAsync(NewsDbContext db, NewsStore store, Guid postId, DateTimeOffset now, CancellationToken ct)
    {
        var n = await db.Database.ExecuteSqlInterpolatedAsync(
            $"""UPDATE news.posts SET "Seq" = DEFAULT, "PublishAt" = NULL, "CreatedAt" = {now} WHERE "Id" = {postId} AND "PublishAt" IS NOT NULL AND "DeletedAt" IS NULL""", ct);
        if (n == 0) return false;
        var post = await db.Posts.AsNoTracking().Include(p => p.Targets).FirstAsync(p => p.Id == postId, ct);
        var mentions = NewsRules.ExtractMentions(post.ContentHtml).Where(u => u != post.AuthorUserId).Take(20).ToList();
        await PostEndpoints.NotifyNewPostAsync(post, mentions, store, ct);
        return true;
    }
}
