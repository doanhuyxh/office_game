using System.Collections.Concurrent;

namespace OfficeHub.Modules.Identity.Infrastructure;

/// <summary>
/// Đếm số lần trong cửa sổ cố định theo khoá, trong RAM (Api chạy một instance — xem pitfalls). Mất khi khởi động lại: chấp nhận.
/// Tự dọn khoá hết hạn khi số khoá lớn để kẻ tấn công không làm phình bộ nhớ bằng tên đăng nhập ngẫu nhiên.
/// </summary>
public sealed class AttemptCounter(TimeProvider clock)
{
    private const int PruneAbove = 10_000;
    private readonly ConcurrentDictionary<string, (int Count, DateTimeOffset Until)> _hits = new();

    public int Count(string key)
    {
        var now = clock.GetUtcNow();
        return _hits.TryGetValue(key, out var h) && h.Until > now ? h.Count : 0;
    }

    /// <summary>Tăng đếm; cửa sổ bắt đầu từ lần đầu tiên. Trả số lần hiện tại.</summary>
    public int Hit(string key, TimeSpan window)
    {
        var now = clock.GetUtcNow();
        if (_hits.Count > PruneAbove)
            foreach (var (k, v) in _hits)
                if (v.Until <= now) _hits.TryRemove(k, out _);
        return _hits.AddOrUpdate(key, _ => (1, now + window), (_, h) => h.Until > now ? (h.Count + 1, h.Until) : (1, now + window)).Count;
    }

    public void Reset(string key) => _hits.TryRemove(key, out _);
}

/// <summary>
/// Chặn dò mật khẩu mà KHÔNG cho người khác khoá tài khoản của nạn nhân (TEST-20):
/// sai 5 lần / 15 phút từ một IP → chỉ IP đó bị chặn với tài khoản đó; sai tổng 30 lần / giờ từ mọi IP → chặn tài khoản (tấn công phân tán).
/// Đăng nhập không dùng lockout của Identity nữa (ai biết tên đăng nhập cũng khoá được người khác 15 phút).
/// </summary>
public sealed class LoginThrottle(TimeProvider clock)
{
    public const int PerSourceLimit = 5;
    public static readonly TimeSpan PerSourceWindow = TimeSpan.FromMinutes(15);
    public const int PerAccountLimit = 30;
    public static readonly TimeSpan PerAccountWindow = TimeSpan.FromHours(1);

    private readonly AttemptCounter _counter = new(clock);

    private static string Source(string account, string ip) => $"s|{account}|{ip}";
    private static string Account(string account) => $"a|{account}";

    public bool IsBlocked(string account, string ip) =>
        _counter.Count(Source(account, ip)) >= PerSourceLimit || _counter.Count(Account(account)) >= PerAccountLimit;

    public void Fail(string account, string ip)
    {
        _counter.Hit(Source(account, ip), PerSourceWindow);
        _counter.Hit(Account(account), PerAccountWindow);
    }

    /// <summary>Đúng mật khẩu → xoá đếm của IP này (đếm toàn tài khoản giữ nguyên tới hết cửa sổ).</summary>
    public void Succeed(string account, string ip) => _counter.Reset(Source(account, ip));
}
