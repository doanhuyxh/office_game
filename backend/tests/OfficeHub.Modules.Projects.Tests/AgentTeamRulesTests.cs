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
    public void Limits()
    {
        Assert.True(AgentTeamRules.StreakAllows(9));
        Assert.False(AgentTeamRules.StreakAllows(10));
        Assert.True(AgentTeamRules.TaskQuotaLeft(19));
        Assert.False(AgentTeamRules.TaskQuotaLeft(20));
    }

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
