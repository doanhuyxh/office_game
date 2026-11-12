using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;

namespace OfficeHub.Modules.Identity.Infrastructure;

/// <summary>Đếm số lần trong cửa sổ cố định theo khoá (cửa sổ bắt đầu từ lần đầu tiên).</summary>
public interface IAttemptStore
{
    Task<int> CountAsync(string key, CancellationToken ct = default);
    /// <summary>Tăng đếm (nguyên tử); trả số lần hiện tại.</summary>
    Task<int> HitAsync(string key, TimeSpan window, CancellationToken ct = default);
    Task ResetAsync(string key, CancellationToken ct = default);
}

/// <summary>
/// Bản lưu DB (TEST-27): bảng <c>identity.attempt_counters</c>, tăng đếm bằng MỘT câu upsert (<c>INSERT … ON CONFLICT DO UPDATE … RETURNING</c>)
/// → đúng khi nhiều request / nhiều instance Api cùng lúc, giữ qua khởi động lại. Thỉnh thoảng dọn dòng hết hạn.
/// </summary>
public sealed class DbAttemptStore(OfficeIdentityDbContext db, TimeProvider clock) : IAttemptStore
{
    public async Task<int> CountAsync(string key, CancellationToken ct = default)
    {
        var now = clock.GetUtcNow();
        return await db.AttemptCounters.AsNoTracking().Where(x => x.Key == key && x.Until > now).Select(x => x.Count).FirstOrDefaultAsync(ct);
    }

    public async Task<int> HitAsync(string key, TimeSpan window, CancellationToken ct = default)
    {
        var now = clock.GetUtcNow();
        var until = now + window;
        if (Random.Shared.Next(200) == 0) // ~0,5 % lần ghi: dọn dòng hết hạn (bảng nhỏ, có index Until)
            await db.AttemptCounters.Where(x => x.Until <= now).ExecuteDeleteAsync(ct);
        // ToListAsync (không SingleAsync): EF không bọc câu lệnh trong subquery — Postgres không cho INSERT … RETURNING trong FROM
        return (await db.Database.SqlQuery<int>($"""
            INSERT INTO identity.attempt_counters ("Key", "Count", "Until") VALUES ({key}, 1, {until})
            ON CONFLICT ("Key") DO UPDATE SET
              "Count" = CASE WHEN attempt_counters."Until" > {now} THEN attempt_counters."Count" + 1 ELSE 1 END,
              "Until" = CASE WHEN attempt_counters."Until" > {now} THEN attempt_counters."Until" ELSE {until} END
            RETURNING "Count" AS "Value"
            """).ToListAsync(ct)).Single();
    }

    public Task ResetAsync(string key, CancellationToken ct = default) => db.AttemptCounters.Where(x => x.Key == key).ExecuteDeleteAsync(ct);
}

/// <summary>Bản RAM (unit test). Không dùng ở Api — mất khi khởi động lại, không chia sẻ giữa các instance.</summary>
public sealed class MemoryAttemptStore(TimeProvider clock) : IAttemptStore
{
    private readonly ConcurrentDictionary<string, (int Count, DateTimeOffset Until)> _hits = new();

    public Task<int> CountAsync(string key, CancellationToken ct = default)
    {
        var now = clock.GetUtcNow();
        return Task.FromResult(_hits.TryGetValue(key, out var h) && h.Until > now ? h.Count : 0);
    }

    public Task<int> HitAsync(string key, TimeSpan window, CancellationToken ct = default)
    {
        var now = clock.GetUtcNow();
        return Task.FromResult(_hits.AddOrUpdate(key, _ => (1, now + window), (_, h) => h.Until > now ? (h.Count + 1, h.Until) : (1, now + window)).Count);
    }

    public Task ResetAsync(string key, CancellationToken ct = default) { _hits.TryRemove(key, out _); return Task.CompletedTask; }
}

/// <summary>
/// Chặn dò mật khẩu mà KHÔNG cho người khác khoá tài khoản của nạn nhân (TEST-20):
/// sai 5 lần / 15 phút từ một IP → chỉ IP đó bị chặn với tài khoản đó; sai tổng 30 lần / giờ từ mọi IP → chặn tài khoản (tấn công phân tán).
/// Đăng nhập không dùng lockout của Identity (ai biết tên đăng nhập cũng khoá được người khác 15 phút). Bộ đếm lưu DB (TEST-27).
/// </summary>
public sealed class LoginThrottle(IAttemptStore store)
{
    public const int PerSourceLimit = 5;
    public static readonly TimeSpan PerSourceWindow = TimeSpan.FromMinutes(15);
    public const int PerAccountLimit = 30;
    public static readonly TimeSpan PerAccountWindow = TimeSpan.FromHours(1);

    private static string Source(string account, string ip) => $"s|{account}|{ip}";
    private static string Account(string account) => $"a|{account}";

    public async Task<bool> IsBlockedAsync(string account, string ip, CancellationToken ct = default) =>
        await store.CountAsync(Source(account, ip), ct) >= PerSourceLimit || await store.CountAsync(Account(account), ct) >= PerAccountLimit;

    public async Task FailAsync(string account, string ip, CancellationToken ct = default)
    {
        await store.HitAsync(Source(account, ip), PerSourceWindow, ct);
        await store.HitAsync(Account(account), PerAccountWindow, ct);
    }

    /// <summary>Đúng mật khẩu → xoá đếm của IP này (đếm toàn tài khoản giữ nguyên tới hết cửa sổ).</summary>
    public Task SucceedAsync(string account, string ip, CancellationToken ct = default) => store.ResetAsync(Source(account, ip), ct);
}
