using System.Net;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Email;
using OfficeHub.Modules.Notification.Domain;

namespace OfficeHub.Modules.Notification.Infrastructure;

/// <summary>
/// Gửi email thông báo nền: mỗi 5 giây lấy các dòng EmailStatus = Pending đã tới hạn, gửi từng thư.
/// Lỗi SMTP → thử lại theo <see cref="EmailPolicy.NextAttempt"/>, hết lượt → Failed. Hàng đợi nằm trong DB nên khởi động lại không mất thư.
/// Chỉ chạy trong host Api (Realtime không nạp module) và giả định một instance Api (VPS đơn).
/// </summary>
internal sealed class EmailDispatcher(IServiceScopeFactory scopes, IOptions<AppSettings> app, TimeProvider clock, ILogger<EmailDispatcher> log)
    : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(5);

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        using var timer = new PeriodicTimer(Interval);
        do
        {
            try { await SendDueAsync(stop); }
            catch (Exception ex) when (!stop.IsCancellationRequested) { log.LogError(ex, "Lỗi khi quét hàng đợi email thông báo"); }
        } while (await timer.WaitForNextTickAsync(stop));
    }

    private async Task SendDueAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NotificationDbContext>();
        var email = scope.ServiceProvider.GetRequiredService<IEmailSender>();
        var now = clock.GetUtcNow();
        var due = await db.Notifications.Where(n => n.EmailStatus == EmailStatus.Pending && n.EmailNextAttemptAt <= now)
            .OrderBy(n => n.EmailNextAttemptAt).Take(20).ToListAsync(ct);
        foreach (var n in due)
        {
            n.EmailAttempts++;
            try
            {
                await email.SendAsync(n.EmailTo!, n.EmailToName ?? n.EmailTo!, n.Title, Html(n), ct);
                n.EmailStatus = EmailStatus.Sent;
                n.EmailSentAt = clock.GetUtcNow();
                n.EmailNextAttemptAt = null;
                n.EmailError = null;
            }
            catch (Exception ex) when (!ct.IsCancellationRequested)
            {
                var next = EmailPolicy.NextAttempt(n.EmailAttempts, clock.GetUtcNow());
                n.EmailStatus = next is null ? EmailStatus.Failed : EmailStatus.Pending;
                n.EmailNextAttemptAt = next;
                n.EmailError = ex.Message.Length > 1000 ? ex.Message[..1000] : ex.Message;
                log.LogWarning(ex, "Gửi email thông báo {Id} tới {Email} lỗi (lần {Attempt})", n.Id, n.EmailTo, n.EmailAttempts);
            }
            await db.SaveChangesAsync(ct); // lưu từng thư: lỗi giữa chừng không gửi lại thư đã gửi
        }
    }

    private string Html(Domain.Notification n)
    {
        static string e(string? s) => WebUtility.HtmlEncode(s ?? "");
        var url = $"{app.Value.BaseUrl.TrimEnd('/')}{n.Link ?? "/"}";
        return $"""
            <div style="font-family:Arial,sans-serif;max-width:560px;color:#0f172a">
              <p>Chào {e(n.EmailToName ?? "")},</p>
              <h2 style="font-size:18px;margin:16px 0 8px">{e(n.Title)}</h2>
              <p style="white-space:pre-line;color:#334155">{e(n.Body)}</p>
              <p style="margin:24px 0"><a href="{e(url)}" style="background:#0f172a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Mở {e(app.Value.Name)}</a></p>
              <p style="font-size:12px;color:#64748b">Email tự động từ {e(app.Value.Name)}, vui lòng không trả lời.</p>
            </div>
            """;
    }
}
