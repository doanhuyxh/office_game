using OfficeHub.Modules.Identity.Infrastructure;

namespace OfficeHub.Modules.Identity.Tests;

/// <summary>TEST-20: chặn dò mật khẩu theo tài khoản + IP, không cho người khác khoá tài khoản của nạn nhân.</summary>
public class LoginThrottleTests
{
    private sealed class Clock(DateTimeOffset now) : TimeProvider
    {
        public DateTimeOffset Now = now;
        public override DateTimeOffset GetUtcNow() => Now;
    }

    private static readonly DateTimeOffset T0 = new(2026, 11, 12, 3, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task Five_failures_block_only_that_ip_for_that_account()
    {
        var t = new LoginThrottle(new MemoryAttemptStore(new Clock(T0)));
        for (var i = 0; i < LoginThrottle.PerSourceLimit; i++) await t.FailAsync("u1", "1.1.1.1");
        Assert.True(await t.IsBlockedAsync("u1", "1.1.1.1"));
        Assert.False(await t.IsBlockedAsync("u1", "2.2.2.2")); // nạn nhân ở IP khác vẫn đăng nhập được
        Assert.False(await t.IsBlockedAsync("u2", "1.1.1.1")); // tài khoản khác không bị ảnh hưởng
    }

    [Fact]
    public async Task Block_expires_after_window()
    {
        var clock = new Clock(T0);
        var t = new LoginThrottle(new MemoryAttemptStore(clock));
        for (var i = 0; i < LoginThrottle.PerSourceLimit; i++) await t.FailAsync("u1", "1.1.1.1");
        clock.Now = T0 + LoginThrottle.PerSourceWindow + TimeSpan.FromSeconds(1);
        Assert.False(await t.IsBlockedAsync("u1", "1.1.1.1"));
    }

    [Fact]
    public async Task Success_resets_source_counter()
    {
        var t = new LoginThrottle(new MemoryAttemptStore(new Clock(T0)));
        for (var i = 0; i < LoginThrottle.PerSourceLimit - 1; i++) await t.FailAsync("u1", "1.1.1.1");
        await t.SucceedAsync("u1", "1.1.1.1");
        await t.FailAsync("u1", "1.1.1.1");
        Assert.False(await t.IsBlockedAsync("u1", "1.1.1.1"));
    }

    [Fact]
    public async Task Distributed_attack_blocks_account_after_account_limit()
    {
        var t = new LoginThrottle(new MemoryAttemptStore(new Clock(T0)));
        for (var i = 0; i < LoginThrottle.PerAccountLimit; i++) await t.FailAsync("u1", $"10.0.{i / 250}.{i % 250}");
        Assert.True(await t.IsBlockedAsync("u1", "9.9.9.9"));
    }

    [Fact]
    public async Task Counter_window_starts_at_first_hit()
    {
        var clock = new Clock(T0);
        var c = new MemoryAttemptStore(clock);
        Assert.Equal(1, await c.HitAsync("k", TimeSpan.FromHours(1)));
        clock.Now = T0.AddMinutes(59);
        Assert.Equal(2, await c.HitAsync("k", TimeSpan.FromHours(1)));
        clock.Now = T0.AddMinutes(61);
        Assert.Equal(0, await c.CountAsync("k"));
        Assert.Equal(1, await c.HitAsync("k", TimeSpan.FromHours(1)));
    }
}
