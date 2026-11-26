using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using OfficeHub.Modules.Notification.Domain;

namespace OfficeHub.Modules.Notification.Infrastructure;

/// <summary>Chạy migration schema "notifications" khi khởi động (nếu Database__MigrateOnStartup=true), rồi backfill target cho thông báo cũ (TEST-237).</summary>
internal sealed class NotificationMigrator(IServiceProvider sp, IConfiguration config) : IHostedService
{
    public async Task StartAsync(CancellationToken ct)
    {
        if (!config.GetValue("Database:MigrateOnStartup", true)) return;
        using var scope = sp.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NotificationDbContext>();
        await db.Database.MigrateAsync(ct);
        await BackfillTargetsAsync(db, ct);
    }

    /// <summary>
    /// Dòng cũ chưa có TargetType: tách link bằng <see cref="NotificationTargets.FromLink"/> (mẫu đã biết → đối tượng có id, còn lại → page + key).
    /// Idempotent, theo lô 1000 dòng; xong thì không còn dòng nào TargetType rỗng. Không đổi cột Link (client cũ thấy y như trước).
    /// </summary>
    internal static async Task<int> BackfillTargetsAsync(NotificationDbContext db, CancellationToken ct)
    {
        var total = 0;
        while (true)
        {
            var batch = await db.Notifications.Where(n => n.TargetType == null).OrderBy(n => n.Id).Take(1000).ToListAsync(ct);
            if (batch.Count == 0) return total;
            foreach (var n in batch)
            {
                var t = NotificationTargets.FromLink(n.Link);
                (n.TargetType, n.TargetId, n.TargetParams) = (t.Type, t.Id, NotificationTargets.ParamsJson(t));
            }
            await db.SaveChangesAsync(ct);
            db.ChangeTracker.Clear();
            total += batch.Count;
        }
    }

    public Task StopAsync(CancellationToken ct) => Task.CompletedTask;
}
