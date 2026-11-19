using OfficeHub.Modules.Projects.Domain;

namespace OfficeHub.Modules.Projects.Tests;

/// <summary>TEST-178: đánh thức bot theo dõi khi việc vào cột "Đánh thức bot theo dõi" (thay review_requested + task_done).</summary>
public class FollowerWakeRulesTests
{
    private static readonly Guid Todo = Guid.NewGuid(), Doing = Guid.NewGuid(), Review = Guid.NewGuid(), Deploy = Guid.NewGuid(), Done = Guid.NewGuid();
    private static readonly Guid Bot1 = Guid.NewGuid(), Bot2 = Guid.NewGuid(), Human = Guid.NewGuid(), Locked = Guid.NewGuid();

    private static readonly List<ColumnInfo> Cols =
    [
        new(Todo, "Cần làm", 0, false, false), new(Doing, "Đang làm", 1, false, false), new(Review, "Chờ review", 2, false, false, WakeFollowers: true),
        new(Deploy, "Deploy", 3, false, false, WakeFollowers: true), new(Done, "Xong", 4, true, true),
    ];

    [Fact]
    public void Moving_into_ticked_column_wakes() => Assert.True(FollowerWakeRules.ShouldWake(Cols, Doing, Review));

    [Fact]
    public void Moving_between_two_ticked_columns_wakes() => Assert.True(FollowerWakeRules.ShouldWake(Cols, Review, Deploy));

    [Fact]
    public void Moving_back_then_in_again_wakes_again()
    {
        Assert.False(FollowerWakeRules.ShouldWake(Cols, Review, Doing));
        Assert.True(FollowerWakeRules.ShouldWake(Cols, Doing, Review));
    }

    [Fact]
    public void Untick_or_same_column_does_not_wake()
    {
        Assert.False(FollowerWakeRules.ShouldWake(Cols, Todo, Doing));
        Assert.False(FollowerWakeRules.ShouldWake(Cols, Deploy, Done));
        Assert.False(FollowerWakeRules.ShouldWake(Cols, Review, Review));
        Assert.False(FollowerWakeRules.ShouldWake(Cols, Doing, Guid.NewGuid()));
    }

    [Fact]
    public void Targets_are_active_bots_once_each()
    {
        var followers = new[]
        {
            new FollowerWakeRules.Follower(Bot1, IsBot: true, IsActive: true), new FollowerWakeRules.Follower(Bot2, IsBot: true, IsActive: true),
            new FollowerWakeRules.Follower(Human, IsBot: false, IsActive: true), new FollowerWakeRules.Follower(Locked, IsBot: true, IsActive: false),
            new FollowerWakeRules.Follower(null, IsBot: false, IsActive: false), new FollowerWakeRules.Follower(Bot1, IsBot: true, IsActive: true),
        };
        Assert.Equal([Bot1, Bot2], FollowerWakeRules.BotTargets(followers, actorUserId: Human));
    }

    [Fact]
    public void Actor_is_skipped() =>
        Assert.Equal([Bot2], FollowerWakeRules.BotTargets(
            [new FollowerWakeRules.Follower(Bot1, IsBot: true, IsActive: true), new FollowerWakeRules.Follower(Bot2, IsBot: true, IsActive: true)], actorUserId: Bot1));

    [Fact]
    public void Default_columns_wake_followers_only_in_review()
    {
        var defaults = TaskColumnRules.Defaults(Guid.NewGuid());
        Assert.Equal(["Chờ review"], defaults.Where(c => c.WakeFollowers).Select(c => c.Name));
    }
}
