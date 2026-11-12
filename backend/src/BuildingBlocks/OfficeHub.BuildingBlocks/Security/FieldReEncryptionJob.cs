using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using OfficeHub.BuildingBlocks.Hosting;

namespace OfficeHub.BuildingBlocks.Security;

/// <summary>Một cột mã hoá cần theo dõi khi xoay khoá — module khai báo qua <see cref="FieldEncryptionExtensions.AddEncryptedColumns{TContext, TEntity}"/>.</summary>
public sealed record EncryptedColumn(Type ContextType, Type EntityType, string Property);

/// <summary>
/// Xoay <c>Encryption__Key</c> (TEST-17): định kỳ tìm giá trị CHƯA mã hoá bằng khoá hiện hành (v1 cũ / v2 khoá cũ) ở mọi cột đã khai báo,
/// giải mã bằng keyring rồi mã hoá lại. Ghi bằng <c>ExecuteUpdate … WHERE cột = giá trị cũ</c>: không qua change tracker (không sinh lịch sử sửa giả)
/// và an toàn khi người dùng sửa cùng lúc (giá trị đã đổi thì bỏ qua). Giá trị không giải mã được (thiếu khoá cũ) → log lỗi, giữ nguyên.
/// </summary>
public sealed class FieldReEncryptionJob(IServiceScopeFactory scopes, IEnumerable<EncryptedColumn> columns, IFieldEncryptor enc, JobMonitor monitor,
    ILogger<FieldReEncryptionJob> log) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromHours(6);
    private const int Batch = 200;

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        var cols = columns.ToList();
        if (cols.Count == 0) return; // host không có module dùng mã hoá (Realtime / Mcp)
        var job = monitor.Register("security.reencrypt", "Mã hoá lại dữ liệu sang khoá hiện hành", Interval);
        await Task.Delay(TimeSpan.FromSeconds(60), stop); // đợi migration xong
        using var timer = new PeriodicTimer(Interval);
        do
        {
            try { await job.RunAsync(() => RunOnceAsync(stop)); }
            catch (Exception ex) when (!stop.IsCancellationRequested) { log.LogError(ex, "Lỗi khi mã hoá lại dữ liệu"); }
        } while (await timer.WaitForNextTickAsync(stop));
    }

    /// <summary>Một lượt qua mọi cột. Trả (đã mã hoá lại, không giải mã được).</summary>
    public async Task<(int Updated, int Failed)> RunOnceAsync(CancellationToken ct)
    {
        int updated = 0, failed = 0;
        foreach (var c in columns)
        {
            using var scope = scopes.CreateScope();
            var db = (DbContext)scope.ServiceProvider.GetRequiredService(c.ContextType);
            var (u, f) = await (Task<(int, int)>)typeof(FieldReEncryptionJob).GetMethod(nameof(ColumnAsync), System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)!
                .MakeGenericMethod(c.EntityType).Invoke(this, [db, c.Property, ct])!;
            updated += u; failed += f;
        }
        if (updated > 0 || failed > 0)
            log.LogWarning("Mã hoá lại sang khoá hiện hành: {Updated} giá trị, {Failed} không giải mã được (thiếu khoá cũ trong Encryption__PreviousKeys?)", updated, failed);
        return (updated, failed);
    }

    private async Task<(int, int)> ColumnAsync<TEntity>(DbContext db, string prop, CancellationToken ct) where TEntity : class
    {
        var prefix = enc.CurrentPrefix;
        var bad = new HashSet<string>();
        int updated = 0;
        while (true)
        {
            var tokens = await db.Set<TEntity>().AsNoTracking()
                .Where(e => EF.Property<string?>(e, prop) != null && EF.Property<string?>(e, prop) != "" && !EF.Property<string>(e, prop).StartsWith(prefix))
                .Select(e => EF.Property<string>(e, prop)).Distinct().Take(Batch + bad.Count).ToListAsync(ct);
            var todo = tokens.Where(t => !bad.Contains(t)).ToList();
            if (todo.Count == 0) break;
            foreach (var old in todo)
            {
                string fresh;
                try { fresh = enc.Encrypt(enc.Decrypt(old)); }
                catch (Exception ex) when (ex is CryptographicException or FormatException)
                {
                    bad.Add(old);
                    log.LogError("Không giải mã được một giá trị {Entity}.{Property}: {Error}", typeof(TEntity).Name, prop, ex.Message);
                    continue;
                }
                updated += await db.Set<TEntity>().Where(e => EF.Property<string>(e, prop) == old)
                    .ExecuteUpdateAsync(s => s.SetProperty(e => EF.Property<string>(e, prop), fresh), ct);
            }
        }
        return (updated, bad.Count);
    }
}
