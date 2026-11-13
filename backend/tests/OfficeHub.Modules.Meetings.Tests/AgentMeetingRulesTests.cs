using OfficeHub.Modules.Meetings.Domain;

namespace OfficeHub.Modules.Meetings.Tests;

public class AgentMeetingRulesTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 13, 2, 0, 0, TimeSpan.Zero);
    private static readonly Guid A = Guid.CreateVersion7(), B = Guid.CreateVersion7(), Human = Guid.CreateVersion7(), Gone = Guid.CreateVersion7();

    private static Dictionary<Guid, BotCandidate> Lookup() => new()
    {
        [A] = new(A, "Bot Kinh doanh", Guid.NewGuid(), IsActive: true, IsBot: true),
        [B] = new(B, "Bot Tài chính", Guid.NewGuid(), IsActive: true, IsBot: true),
        [Human] = new(Human, "Người thật", Guid.NewGuid(), IsActive: true, IsBot: false),
        [Gone] = new(Gone, "Bot nghỉ", Guid.NewGuid(), IsActive: false, IsBot: true),
    };

    private static List<(string Field, string Message)> Open(string? topic, Guid chair, params Guid[] bots) =>
        AgentMeetingRules.ValidateOpen(topic, chair, bots, Lookup());

    [Fact]
    public void Valid_session_has_no_errors() => Assert.Empty(Open("Kế hoạch Q1", A, A, B));

    [Theory]
    [InlineData(null)]
    [InlineData("   ")]
    public void Topic_required(string? topic) => Assert.Contains(Open(topic, A, A, B), e => e.Field == "topic");

    [Fact]
    public void Topic_too_long() => Assert.Contains(Open(new string('x', AgentMeetingRules.TopicMaxLength + 1), A, A, B), e => e.Field == "topic");

    [Fact]
    public void Needs_at_least_two_bots() => Assert.Contains(Open("Họp", A, A), e => e.Field == "botIds");

    [Fact]
    public void At_most_eight_bots()
    {
        var ids = Enumerable.Range(0, AgentMeetingRules.MaxBots + 1).Select(_ => Guid.CreateVersion7()).ToArray();
        Assert.Contains(AgentMeetingRules.ValidateOpen("Họp", ids[0], ids, Lookup()), e => e.Field == "botIds" && e.Message.Contains("Tối đa"));
    }

    [Fact]
    public void Human_account_cannot_attend_as_bot() =>
        Assert.Contains(Open("Họp", A, A, Human), e => e.Field == "botIds" && e.Message.Contains("không phải tài khoản bot"));

    [Fact]
    public void Inactive_bot_rejected() => Assert.Contains(Open("Họp", A, A, Gone), e => e.Field == "botIds");

    [Fact]
    public void Unknown_employee_rejected() => Assert.Contains(Open("Họp", A, A, Guid.CreateVersion7()), e => e.Field == "botIds");

    [Fact]
    public void Chair_must_attend() => Assert.Contains(Open("Họp", Guid.CreateVersion7(), A, B), e => e.Field == "chairEmployeeId");

    [Theory]
    [InlineData(30, 30, true)]
    [InlineData(2, 5, true)]
    [InlineData(200, 240, true)]
    [InlineData(1, 30, false)]
    [InlineData(30, 4, false)]
    [InlineData(201, 30, false)]
    [InlineData(30, 241, false)]
    public void Admin_limits_range(int turns, int minutes, bool ok) =>
        Assert.Equal(ok, AgentMeetingRules.ValidateLimits(turns, minutes).Count == 0);

    private static AgentMeeting Session(int turnsUsed = 0, int startedMinutesAgo = 0) => new()
    {
        RoomId = "meeting-small", Topic = "Họp", OpenedByName = "Chủ dự án", ChairEmployeeId = A,
        MaxTurns = AgentMeetingRules.DefaultMaxTurns, MaxMinutes = AgentMeetingRules.DefaultMaxMinutes,
        TurnsUsed = turnsUsed, StartedAt = Now.AddMinutes(-startedMinutesAgo),
    };

    [Fact]
    public void Within_limits_keeps_running() => Assert.Null(AgentMeetingRules.LimitReached(Session(29, 29), Now));

    [Fact]
    public void Turn_limit_includes_chair_turns() =>
        Assert.Equal(AgentMeetingEndReason.TurnLimit, AgentMeetingRules.LimitReached(Session(turnsUsed: 30), Now));

    [Fact]
    public void Time_limit_after_max_minutes() =>
        Assert.Equal(AgentMeetingEndReason.TimeLimit, AgentMeetingRules.LimitReached(Session(startedMinutesAgo: 30), Now));

    [Fact]
    public void Ended_session_never_reaches_limit()
    {
        var m = Session(turnsUsed: 99, startedMinutesAgo: 99);
        m.End(AgentMeetingEndReason.Stopped, Now, "HR");
        Assert.Null(AgentMeetingRules.LimitReached(m, Now));
        Assert.Equal(AgentMeetingStatus.Ended, m.Status);
        Assert.Equal(Now, m.EndedAt);
    }
}
