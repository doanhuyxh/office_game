using System.Collections.Concurrent;
using System.ComponentModel;
using System.Diagnostics;
using Microsoft.Extensions.Caching.Hybrid;

namespace OfficeHub.BuildingBlocks.Caching;

/// <summary>Ảnh chụp danh mục kèm mốc đọc DB (<see cref="Stopwatch.GetTimestamp"/> lấy TRƯỚC khi đọc).</summary>
/// <remarks>Sealed + <see cref="ImmutableObjectAttribute"/> → HybridCache giữ nguyên đối tượng trong RAM, không serialize mỗi lần đọc.
/// Giá trị bên trong cũng phải bất biến (record, mảng / FrozenDictionary chỉ đọc) — nơi gọi không được sửa.</remarks>
[ImmutableObject(true)]
public sealed record CatalogSnapshot<T>(T Value, long LoadedAt) where T : class;

/// <summary>
/// Cache danh mục ít đổi trong RAM (TEST-245, bước B2b): mỗi module cache "ảnh chụp cả danh mục nhỏ" của CHÍNH nó (cây quản lý,
/// phòng ban, chức vụ, ca / lịch / ngày lễ…) sau interface <c>*.Contracts</c> / service của module — module khác không biết có cache.
/// <para>Độ tươi: mọi lệnh ghi vào bảng nguồn xoá tag ngay (<see cref="CatalogCacheInvalidation{TContext}"/> — SaveChanges,
/// ExecuteUpdate / ExecuteDelete / SQL thô, và lần nữa khi transaction commit). Ngoài <c>RemoveByTagAsync</c> còn ghi mốc xoá theo tag:
/// ảnh chụp đọc từ DB không muộn hơn mốc đó (factory chạy song song với lệnh ghi, ghi dữ liệu cũ vào cache sau khi đã xoá) bị bỏ và đọc lại.
/// TTL (<see cref="Ttl"/>) chỉ là lưới an toàn.</para>
/// ⚠ Chỉ đúng khi chạy MỘT bản Api: lệnh xoá không tới tiến trình khác (≥ 2 bản → B3: Redis + phát lệnh xoá).
/// </summary>
public sealed class CatalogCache(HybridCache cache)
{
    /// <summary>Lưới an toàn: ảnh chụp sống tối đa 5 phút kể cả khi lỡ một chỗ ghi không qua EF của module.</summary>
    public static readonly TimeSpan Ttl = TimeSpan.FromMinutes(5);
    private const int MaxAttempts = 3;
    private static readonly long PruneAfter = (long)(Ttl.TotalSeconds * 2 * Stopwatch.Frequency);
    private const int PruneThreshold = 4096;

    private readonly ConcurrentDictionary<string, long> _invalidatedAt = new();

    public static long Now() => Stopwatch.GetTimestamp();

    /// <summary>
    /// Đọc ảnh chụp theo <paramref name="key"/> (tiền tố = tên module, vd <c>org:employees</c>), gắn <paramref name="tag"/>.
    /// <paramref name="load"/> chạy trong scope của request gọi (dùng DbContext của nó); nhiều request cùng lúc chỉ đọc DB một lần.
    /// </summary>
    public async ValueTask<T> GetAsync<T>(string key, string tag, Func<CancellationToken, Task<T>> load, CancellationToken ct = default)
        where T : class
    {
        var options = new HybridCacheEntryOptions
        {
            Expiration = Ttl,
            LocalCacheExpiration = Ttl,
            Flags = HybridCacheEntryFlags.DisableDistributedCache,
        };
        for (var i = 0; i < MaxAttempts; i++)
        {
            var snap = await cache.GetOrCreateAsync(key, load, static async (l, c) =>
            {
                var at = Now(); // mốc TRƯỚC khi đọc DB
                return new CatalogSnapshot<T>(await l(c), at);
            }, options, [tag], ct);
            if (!IsStale(snap.LoadedAt, tag)) return snap.Value;
            await cache.RemoveAsync(key, CancellationToken.None);
        }
        return await load(ct); // bị xoá liên tục → đọc thẳng DB, không cache
    }

    /// <summary>Xoá mọi ảnh chụp mang một trong các tag. Không nhận ct của request: đã ghi DB thì phải xoá dù client ngắt kết nối.</summary>
    public async ValueTask InvalidateAsync(IReadOnlyCollection<string> tags)
    {
        if (tags.Count == 0) return;
        var now = Now();
        foreach (var tag in tags) _invalidatedAt[tag] = now;
        if (_invalidatedAt.Count > PruneThreshold) Prune(now);
        await cache.RemoveByTagAsync(tags, CancellationToken.None);
    }

    private bool IsStale(long loadedAt, string tag) => _invalidatedAt.TryGetValue(tag, out var at) && loadedAt <= at;

    private void Prune(long now)
    {
        foreach (var (tag, at) in _invalidatedAt)
            if (now - at > PruneAfter) _invalidatedAt.TryRemove(new KeyValuePair<string, long>(tag, at));
    }
}
