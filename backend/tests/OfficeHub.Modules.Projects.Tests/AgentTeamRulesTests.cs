using OfficeHub.Modules.Projects.Domain;

namespace OfficeHub.Modules.Projects.Tests;

public class AgentTeamRulesTests
{
    private static readonly DateTimeOffset T0 = new(2026, 11, 11, 3, 0, 0, TimeSpan.Zero);
    private static TaskEvent Bot(int min, bool counts = true) => new(T0.AddMinutes(min), true, counts);
    private static TaskEvent Human(int min) => new(T0.AddMinutes(min), false, false);

    [Fact]
    public void Streak_counts_bot_moves_since_last_human_event()
    {
        Assert.Equal(0, AgentTeamRules.BotStreak([]));
        Assert.Equal(3, AgentTeamRules.BotStreak([Bot(1), Bot(2), Bot(3)]));
        Assert.Equal(2, AgentTeamRules.BotStreak([Bot(1), Bot(2), Human(3), Bot(4), Bot(5)]));
        Assert.Equal(0, AgentTeamRules.BotStreak([Bot(1), Bot(2), Human(9)]));
    }

    [Fact]
    public void Uncounted_bot_events_do_not_break_streak()
    {
        Assert.Equal(2, AgentTeamRules.BotStreak([Bot(1), Bot(2, counts: false), Bot(3), Bot(4, counts: false)]));
    }

    [Fact]
    public void Order_of_input_does_not_matter() =>
        Assert.Equal(1, AgentTeamRules.BotStreak([Bot(5), Human(3), Bot(1)]));

    [Fact]
    public void Limits_use_the_configured_values()
    {
        Assert.True(AgentTeamRules.StreakAllows(9, 10));
        Assert.False(AgentTeamRules.StreakAllows(10, 10));
        Assert.False(AgentTeamRules.StreakAllows(3, 3));
        Assert.True(AgentTeamRules.TaskQuotaLeft(49, 50));
        Assert.False(AgentTeamRules.TaskQuotaLeft(50, 50));
        Assert.False(AgentTeamRules.TaskQuotaLeft(2, 2));
    }

    [Fact]
    public void Defaults_are_50_tasks_and_10_in_a_row() => Assert.Equal(new AgentLimits(50, 10), AgentLimits.Default);

    [Fact]
    public void Messages_show_the_real_limit()
    {
        Assert.Contains("Đã tạo 7 việc", AgentTeamRules.TaskQuotaMessage(7));
        Assert.Contains("3 lần liên tiếp", AgentTeamRules.StreakMessage(3));
    }

    [Theory]
    [InlineData(1, 1, 0)]
    [InlineData(500, 100, 0)]
    [InlineData(0, 10, 1)]
    [InlineData(501, 10, 1)]
    [InlineData(50, 0, 1)]
    [InlineData(50, 101, 1)]
    [InlineData(0, 0, 2)]
    public void Limit_ranges(int tasks, int streak, int errors) => Assert.Equal(errors, AgentTeamRules.LimitErrors(tasks, streak).Count);

    [Theory]
    [InlineData("@NV012 xem giúp", new[] { "NV012" })]
    [InlineData("Nhờ @nv012 và @BOT-01, cảm ơn @NV012.", new[] { "nv012", "BOT-01" })]
    [InlineData("liên hệ a@b.com", new string[0])]
    [InlineData("@x quá ngắn", new string[0])]
    [InlineData("(@Lan) xem", new[] { "Lan" })]
    [InlineData(null, new string[0])]
    public void Mentions(string? content, string[] expected) => Assert.Equal(expected, AgentTeamRules.MentionedCodes(content));

    [Fact]
    public void Mentions_are_capped()
    {
        var s = string.Join(" ", Enumerable.Range(10, 20).Select(i => $"@NV0{i}"));
        Assert.Equal(AgentTeamRules.MaxMentions, AgentTeamRules.MentionedCodes(s).Count);
    }
}
