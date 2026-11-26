using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Npgsql;
using NpgsqlTypes;
using OfficeHub.Modules.Notification.Domain;

namespace OfficeHub.Modules.Notification.Infrastructure;

/// <summary>
/// Chạy migration schema "notifications" khi khởi động (nếu Database__MigrateOnStartup=true).
/// TEST-238: migration <see cref="DropLinkMigration"/> xoá cột Link → nếu nó còn chờ chạy thì migrate tới <see cref="TargetsMigration"/> (G1),
/// backfill nốt target cho dòng cũ (đọc Link bằng SQL thô) rồi mới migrate tiếp. Migration xoá cột tự dừng nếu vẫn còn dòng TargetType rỗng.
/// </summary>
internal sealed class NotificationMigrator(IServiceProvider sp, IConfiguration config) : IHostedService
{
    /// <summary>G1 (TEST-237): thêm TargetType / TargetId / TargetParams.</summary>
    internal const string TargetsMigration = "20261126024810_NotificationTargets";
    /// <summary>G2 (TEST-238): TargetType NOT NULL + xoá cột Link.</summary>
    internal const string DropLinkMigration = "20261126031105_NotificationDropLink";

    public async Task StartAsync(CancellationToken ct)
    {
        if (!config.GetValue("Database:MigrateOnStartup", true)) return;
        using var scope = sp.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NotificationDbContext>();
        await MigrateAsync(db, ct);
    }

    internal static async Task MigrateAsync(NotificationDbContext db, CancellationToken ct)
    {
        var pending = (await db.Database.GetPendingMigrationsAsync(ct)).ToList();
        if (pending.Contains(DropLinkMigration))
        {
            // Còn cột Link: lên tới G1 (no-op nếu đã ở đó), backfill dòng thiếu target trước khi xoá cột.
            await db.GetService<IMigrator>().MigrateAsync(TargetsMigration, cancellationToken: ct);
            await BackfillTargetsAsync(db, ct);
        }
        await db.Database.MigrateAsync(ct);
    }

    private sealed record LegacyRow(Guid Id, string? Link);

    /// <summary>
    /// Dòng cũ chưa có TargetType: tách link bằng <see cref="NotificationTargets.FromLink"/> (mẫu đã biết → đối tượng có id, còn lại → page + key).
    /// Chỉ chạy khi cột Link còn (trước migration <see cref="DropLinkMigration"/>). Idempotent, theo lô 1000 dòng; xong thì không còn dòng nào TargetType rỗng.
    /// </summary>
    internal static async Task<int> BackfillTargetsAsync(NotificationDbContext db, CancellationToken ct)
    {
        var total = 0;
        while (true)
        {
            var batch = await db.Database.SqlQueryRaw<LegacyRow>(
                """SELECT "Id", "Link" FROM notifications.notifications WHERE "TargetType" IS NULL ORDER BY "Id" LIMIT 1000""").ToListAsync(ct);
            if (batch.Count == 0) return total;
            foreach (var n in batch)
            {
                var t = NotificationTargets.FromLink(n.Link);
                await db.Database.ExecuteSqlRawAsync(
                    """UPDATE notifications.notifications SET "TargetType" = @type, "TargetId" = @id, "TargetParams" = @params WHERE "Id" = @row""",
                    [
                        new NpgsqlParameter("type", NpgsqlDbType.Varchar) { Value = t.Type },
                        new NpgsqlParameter("id", NpgsqlDbType.Uuid) { Value = (object?)t.Id ?? DBNull.Value },
                        new NpgsqlParameter("params", NpgsqlDbType.Jsonb) { Value = (object?)NotificationTargets.ParamsJson(t) ?? DBNull.Value },
                        new NpgsqlParameter("row", NpgsqlDbType.Uuid) { Value = n.Id },
                    ], ct);
            }
            total += batch.Count;
        }
    }

    public Task StopAsync(CancellationToken ct) => Task.CompletedTask;
}
