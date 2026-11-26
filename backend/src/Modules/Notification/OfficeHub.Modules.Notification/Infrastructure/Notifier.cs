using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using OfficeHub.Modules.Identity.Contracts;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Notification.Domain;
using OfficeHub.Modules.Notification.Features;

namespace OfficeHub.Modules.Notification.Infrastructure;

/// <summary>Lưu một dòng thông báo cho mỗi tài khoản nhận; email (nếu có) để <see cref="EmailDispatcher"/> gửi nền.</summary>
internal sealed class Notifier(NotificationDbContext db, IAccountService accounts, IPushSender push, TimeProvider clock,
    Microsoft.Extensions.Options.IOptions<OfficeHub.BuildingBlocks.Configuration.AppSettings> app,
    ILogger<Notifier> log) : INotifier
{
    public async Task NotifyAsync(NotificationRequest r, CancellationToken ct = default)
    {
        var ids = r.RecipientUserIds.Distinct().ToList();
        if (ids.Count == 0) return;
        var people = await accounts.GetManyAsync(ids, ct);
        var now = clock.GetUtcNow();
        // Người đã tắt email ở /profile (không có dòng = vẫn nhận).
        var emailOff = r.SendEmail
            ? (await db.Preferences.AsNoTracking().Where(p => ids.Contains(p.UserId) && !p.EmailEnabled).Select(p => p.UserId).ToListAsync(ct)).ToHashSet()
            : [];
        var target = Target(r);
        var link = NotificationLinkBuilder.Build(target);
        if (!NotificationCatalog.AllowsTarget(r.Category, target.Type))
            log.LogWarning("Thông báo {Category} gửi target {Type} ngoài danh mục NotificationCatalog", r.Category, target.Type);
        var paramsJson = NotificationTargets.ParamsJson(target);
        var notified = new List<Guid>();
        var rows = new Dictionary<Guid, Domain.Notification>();
        foreach (var id in ids)
        {
            if (!people.TryGetValue(id, out var acc) || !acc.IsActive) continue; // tài khoản đã khoá: không thông báo
            var wantsEmail = EmailPolicy.ShouldEmail(r.SendEmail, !emailOff.Contains(id), r.Category) && !string.IsNullOrWhiteSpace(acc.Email);
            var status = !wantsEmail ? EmailStatus.None : EmailPolicy.IsDeliverable(acc.Email) ? EmailStatus.Pending : EmailStatus.Skipped;
            var row = new Domain.Notification
            {
                UserId = id, Category = r.Category, Title = Cut(r.Title, 300), Body = Cut(r.Body, 2000), Link = link, TargetType = target.Type, TargetId = target.Id, TargetParams = paramsJson,
                CreatedAt = now,
                EmailTo = wantsEmail ? acc.Email : null, EmailToName = wantsEmail ? (string.IsNullOrWhiteSpace(acc.FullName) ? acc.UserName : acc.FullName) : null,
                EmailStatus = status, EmailNextAttemptAt = status == EmailStatus.Pending ? now : null,
            };
            db.Notifications.Add(row);
            rows[id] = row;
            notified.Add(id);
        }
        // Webhook cá nhân (đánh thức agent): cùng lần lưu với thông báo — có chuông thì có webhook.
        var baseUrl = app.Value.BaseUrl.TrimEnd('/');
        await WebhookJson.EnqueueAsync(db, notified, WebhookEvents.Notification, uid => new
        {
            notificationId = rows[uid].Id, category = r.Category, title = rows[uid].Title, body = rows[uid].Body,
            target = new { type = target.Type, id = target.Id, @params = target.Params }, link,
            url = link is null ? null : baseUrl + link,
        }, now, ct);
        await db.SaveChangesAsync(ct);
        await push.PushAsync(notified, r.Title, r.Body, target, ct);
    }

    /// <summary>Target của yêu cầu; người gọi cũ chỉ có Link (obsolete) → tách link như backfill.</summary>
    private static NotificationTarget Target(NotificationRequest r)
    {
#pragma warning disable CS0618 // G1: còn đọc Link cho người gọi chưa chuyển (bỏ ở TEST-238)
        return r.Target ?? NotificationTargets.FromLink(r.Link);
#pragma warning restore CS0618
    }

    private static string Cut(string s, int max) => s.Length <= max ? s : s[..(max - 1)] + "…";
}
