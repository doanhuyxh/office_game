using OfficeHub.Modules.Projects.Domain;

namespace OfficeHub.Modules.Projects.Tests;

/// <summary>TEST-166: đánh thức task_done cho bot theo dõi khi người thật chuyển việc sang Xong.</summary>
public class TaskDoneRulesTests
{
    private static readonly Guid Bot1 = Guid.NewGuid(), Bot2 = Guid.NewGuid(), Human = Guid.NewGuid(), Locked = Guid.NewGuid();

    [Fact]
    public void Human_moving_not_done_to_done_wakes() => Assert.True(TaskDoneRules.ShouldWake(wasDone: false, isDone: true, byAccessToken: false));

    [Fact]
    public void Token_moving_to_done_does_not_wake() => Assert.False(TaskDoneRules.ShouldWake(wasDone: false, isDone: true, byAccessToken: true));

    [Fact]
    public void Already_done_moving_to_another_done_column_does_not_wake_again() =>
        Assert.False(TaskDoneRules.ShouldWake(wasDone: true, isDone: true, byAccessToken: false));

    [Fact]
    public void Reopening_or_moving_between_open_columns_does_not_wake()
    {
        Assert.False(TaskDoneRules.ShouldWake(wasDone: true, isDone: false, byAccessToken: false));
        Assert.False(TaskDoneRules.ShouldWake(wasDone: false, isDone: false, byAccessToken: false));
    }

    [Fact]
    public void One_target_per_active_bot_follower()
    {
        var followers = new[]
        {
            new TaskDoneRules.Follower(Bot1, IsBot: true, IsActive: true), new TaskDoneRules.Follower(Bot2, IsBot: true, IsActive: true),
            new TaskDoneRules.Follower(Human, IsBot: false, IsActive: true), new TaskDoneRules.Follower(Locked, IsBot: true, IsActive: false),
            new TaskDoneRules.Follower(null, IsBot: false, IsActive: false), new TaskDoneRules.Follower(Bot1, IsBot: true, IsActive: true),
        };
        Assert.Equal([Bot1, Bot2], TaskDoneRules.BotTargets(followers, actorUserId: Human));
    }

    [Fact]
    public void Actor_is_never_a_target() =>
        Assert.Empty(TaskDoneRules.BotTargets([new TaskDoneRules.Follower(Bot1, IsBot: true, IsActive: true)], actorUserId: Bot1));
}
