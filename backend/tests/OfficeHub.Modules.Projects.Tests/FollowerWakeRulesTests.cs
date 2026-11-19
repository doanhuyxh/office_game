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

    // TEST-184: cột chọn bot được đánh thức (Id nhân viên).
    private static readonly Guid EmpA = Guid.NewGuid(), EmpB = Guid.NewGuid(), EmpC = Guid.NewGuid();
    private static readonly FollowerWakeRules.Follower[] TwoBots =
    [
        new(Bot1, IsBot: true, IsActive: true, EmployeeId: EmpA), new(Bot2, IsBot: true, IsActive: true, EmployeeId: EmpB),
    ];

    [Fact]
    public void Empty_choice_wakes_all_following_bots()
    {
        Assert.Equal([Bot1, Bot2], FollowerWakeRules.BotTargets(TwoBots, Human, []));
        Assert.Equal([Bot1, Bot2], FollowerWakeRules.BotTargets(TwoBots, Human, null));
    }

    [Fact]
    public void Choice_wakes_only_chosen_following_bots() => Assert.Equal([Bot1], FollowerWakeRules.BotTargets(TwoBots, Human, [EmpA]));

    [Fact]
    public void Chosen_bot_not_following_wakes_nobody() => Assert.Empty(FollowerWakeRules.BotTargets(TwoBots, Human, [EmpC]));

    [Fact]
    public void Chosen_but_locked_or_actor_wakes_nobody()
    {
        FollowerWakeRules.Follower[] followers = [new(Bot1, IsBot: true, IsActive: false, EmployeeId: EmpA), new(Bot2, IsBot: true, IsActive: true, EmployeeId: EmpB)];
        Assert.Empty(FollowerWakeRules.BotTargets(followers, Human, [EmpA]));
        Assert.Empty(FollowerWakeRules.BotTargets(followers, Bot2, [EmpB]));
    }

    [Fact]
    public void Normalize_dedups_and_clears_when_untick()
    {
        Assert.Equal([EmpA, EmpB], FollowerWakeRules.NormalizeBotIds([EmpA, Guid.Empty, EmpB, EmpA], wakeFollowers: true));
        Assert.Empty(FollowerWakeRules.NormalizeBotIds([EmpA], wakeFollowers: false));
        Assert.Empty(FollowerWakeRules.NormalizeBotIds(null, wakeFollowers: true));
    }

    [Fact]
    public void Bot_ids_must_be_member_bots()
    {
        var memberBots = new HashSet<Guid> { EmpA, EmpB };
        Assert.Null(FollowerWakeRules.BotIdsError([EmpA, EmpB], memberBots));
        Assert.Null(FollowerWakeRules.BotIdsError([], memberBots));
        Assert.NotNull(FollowerWakeRules.BotIdsError([EmpA, EmpC], memberBots));
    }

    [Fact]
    public void Default_columns_wake_followers_only_in_review()
    {
        var defaults = TaskColumnRules.Defaults(Guid.NewGuid());
        Assert.Equal(["Chờ review"], defaults.Where(c => c.WakeFollowers).Select(c => c.Name));
    }
}
