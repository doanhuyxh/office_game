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
    public void Five_failures_block_only_that_ip_for_that_account()
    {
        var t = new LoginThrottle(new Clock(T0));
        for (var i = 0; i < LoginThrottle.PerSourceLimit; i++) t.Fail("u1", "1.1.1.1");
        Assert.True(t.IsBlocked("u1", "1.1.1.1"));
        Assert.False(t.IsBlocked("u1", "2.2.2.2")); // nạn nhân ở IP khác vẫn đăng nhập được
        Assert.False(t.IsBlocked("u2", "1.1.1.1")); // tài khoản khác không bị ảnh hưởng
    }

    [Fact]
    public void Block_expires_after_window()
    {
        var clock = new Clock(T0);
        var t = new LoginThrottle(clock);
        for (var i = 0; i < LoginThrottle.PerSourceLimit; i++) t.Fail("u1", "1.1.1.1");
        clock.Now = T0 + LoginThrottle.PerSourceWindow + TimeSpan.FromSeconds(1);
        Assert.False(t.IsBlocked("u1", "1.1.1.1"));
    }

    [Fact]
    public void Success_resets_source_counter()
    {
        var t = new LoginThrottle(new Clock(T0));
        for (var i = 0; i < LoginThrottle.PerSourceLimit - 1; i++) t.Fail("u1", "1.1.1.1");
        t.Succeed("u1", "1.1.1.1");
        t.Fail("u1", "1.1.1.1");
        Assert.False(t.IsBlocked("u1", "1.1.1.1"));
    }

    [Fact]
    public void Distributed_attack_blocks_account_after_account_limit()
    {
        var t = new LoginThrottle(new Clock(T0));
        for (var i = 0; i < LoginThrottle.PerAccountLimit; i++) t.Fail("u1", $"10.0.{i / 250}.{i % 250}");
        Assert.True(t.IsBlocked("u1", "9.9.9.9"));
    }

    [Fact]
    public void Counter_window_starts_at_first_hit()
    {
        var clock = new Clock(T0);
        var c = new AttemptCounter(clock);
        Assert.Equal(1, c.Hit("k", TimeSpan.FromHours(1)));
        clock.Now = T0.AddMinutes(59);
        Assert.Equal(2, c.Hit("k", TimeSpan.FromHours(1)));
        clock.Now = T0.AddMinutes(61);
        Assert.Equal(0, c.Count("k"));
        Assert.Equal(1, c.Hit("k", TimeSpan.FromHours(1)));
    }
}
