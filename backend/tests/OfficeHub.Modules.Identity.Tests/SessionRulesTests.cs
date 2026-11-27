using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.Modules.Identity.Domain;

namespace OfficeHub.Modules.Identity.Tests;

public class SessionRulesTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 27, 3, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Default_keeps_seven_day_idle_and_no_max() =>
        Assert.Equal(SessionRules.Verdict.Ok, SessionRules.Check(Now.AddDays(-6), Now.AddDays(-400), Now, new SessionSettings()));

    [Fact]
    public void Idle_too_long_expires() =>
        Assert.Equal(SessionRules.Verdict.Idle, SessionRules.Check(Now.AddHours(-9), Now.AddHours(-9), Now, new SessionSettings { IdleHours = 8 }));

    [Fact]
    public void Max_age_forces_login_even_when_active() =>
        Assert.Equal(SessionRules.Verdict.TooOld, SessionRules.Check(Now.AddMinutes(-1), Now.AddDays(-31), Now, new SessionSettings { MaxDays = 30 }));

    [Fact]
    public void Missing_login_time_skips_max_age() =>
        Assert.Equal(SessionRules.Verdict.Ok, SessionRules.Check(Now.AddMinutes(-1), null, Now, new SessionSettings { MaxDays = 1 }));

    [Fact]
    public void Login_time_round_trips_through_items()
    {
        var items = new Dictionary<string, string?>();
        SessionRules.WriteLoginAt(items, Now.ToOffset(TimeSpan.FromHours(7)));
        Assert.Equal(Now, SessionRules.ReadLoginAt(items));
        Assert.Null(SessionRules.ReadLoginAt(new Dictionary<string, string?> { [SessionRules.LoginAtKey] = "rác" }));
    }
}
