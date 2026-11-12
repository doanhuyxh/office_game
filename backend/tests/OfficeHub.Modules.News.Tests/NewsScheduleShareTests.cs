using OfficeHub.Modules.News.Domain;

namespace OfficeHub.Modules.News.Tests;

/// <summary>TEST-54: hẹn giờ đăng, chia sẻ trỏ bài gốc.</summary>
public class NewsScheduleShareTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 12, 3, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Schedule_between_one_minute_and_sixty_days()
    {
        Assert.NotNull(NewsRules.ValidateSchedule(Now, Now));
        Assert.NotNull(NewsRules.ValidateSchedule(Now.AddSeconds(30), Now));
        Assert.Null(NewsRules.ValidateSchedule(Now.AddMinutes(1), Now));
        Assert.Null(NewsRules.ValidateSchedule(Now.AddDays(60), Now));
        Assert.NotNull(NewsRules.ValidateSchedule(Now.AddDays(60).AddMinutes(1), Now));
        Assert.NotNull(NewsRules.ValidateSchedule(Now.AddDays(-1), Now));
    }

    [Fact]
    public void Share_points_to_the_original_post()
    {
        var a = Guid.NewGuid();
        var root = Guid.NewGuid();
        Assert.Equal(a, NewsRules.ShareRoot(a, null));
        Assert.Equal(root, NewsRules.ShareRoot(a, root));
    }
}
