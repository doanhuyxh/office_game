using OfficeHub.Modules.Identity.Contracts;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Notification.Domain;

namespace OfficeHub.Modules.Notification.Infrastructure;

/// <summary>Lưu một dòng thông báo cho mỗi tài khoản nhận; email (nếu có) để <see cref="EmailDispatcher"/> gửi nền.</summary>
internal sealed class Notifier(NotificationDbContext db, IAccountService accounts, TimeProvider clock) : INotifier
{
    public async Task NotifyAsync(NotificationRequest r, CancellationToken ct = default)
    {
        var ids = r.RecipientUserIds.Distinct().ToList();
        if (ids.Count == 0) return;
        var people = await accounts.GetManyAsync(ids, ct);
        var now = clock.GetUtcNow();
        foreach (var id in ids)
        {
            if (!people.TryGetValue(id, out var acc) || !acc.IsActive) continue; // tài khoản đã khoá: không thông báo
            var wantsEmail = r.SendEmail && !string.IsNullOrWhiteSpace(acc.Email);
            var status = !wantsEmail ? EmailStatus.None : EmailPolicy.IsDeliverable(acc.Email) ? EmailStatus.Pending : EmailStatus.Skipped;
            db.Notifications.Add(new Domain.Notification
            {
                UserId = id, Category = r.Category, Title = Cut(r.Title, 300), Body = Cut(r.Body, 2000), Link = r.Link, CreatedAt = now,
                EmailTo = wantsEmail ? acc.Email : null, EmailToName = wantsEmail ? (string.IsNullOrWhiteSpace(acc.FullName) ? acc.UserName : acc.FullName) : null,
                EmailStatus = status, EmailNextAttemptAt = status == EmailStatus.Pending ? now : null,
            });
        }
        await db.SaveChangesAsync(ct);
    }

    private static string Cut(string s, int max) => s.Length <= max ? s : s[..(max - 1)] + "…";
}
