using OfficeHub.Modules.Meetings.Domain;

namespace OfficeHub.Modules.Meetings.Tests;

/// <summary>Chia lượt nói trong họp agent (TEST-75).</summary>
public class AgentMeetingTurnRulesTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 13, 2, 0, 0, TimeSpan.Zero);
    private static readonly Guid Chair = Guid.CreateVersion7(), B = Guid.CreateVersion7(), C = Guid.CreateVersion7(), D = Guid.CreateVersion7();
    private static readonly Guid Outsider = Guid.CreateVersion7();

    private static AgentMeeting Meeting(int maxTurns = 30, int maxMinutes = 30)
    {
        var m = new AgentMeeting
        {
            RoomId = "meeting-a", Topic = "Kế hoạch Q1", OpenedByName = "Người mở", ChairEmployeeId = Chair, MaxTurns = maxTurns, MaxMinutes = maxMinutes,
            StartedAt = Now,
            Bots = [Bot(Chair, "Chủ trì"), Bot(B, "Bot B"), Bot(C, "Bot C"), Bot(D, "Bot D")],
        };
        AgentMeetingTurnRules.Start(m, Now);
        return m;
    }

    private static AgentMeetingBot Bot(Guid id, string name) => new() { EmployeeId = id, UserId = Guid.CreateVersion7(), Name = name };

    [Fact]
    public void Opening_gives_first_turn_to_chair()
    {
        var m = Meeting();
        Assert.Equal(Chair, m.CurrentSpeakerEmployeeId);
        Assert.Equal(Now, m.TurnStartedAt);
        Assert.Equal(0, m.TurnsUsed);
        Assert.Null(AgentMeetingTurnRules.CanAct(m, Chair));
        Assert.NotNull(AgentMeetingTurnRules.CanAct(m, B));
    }

    [Fact]
    public void Mentioned_bot_speaks_next()
    {
        var m = Meeting();
        var r = AgentMeetingTurnRules.Spoke(m, Chair, [B], Now.AddSeconds(10));
        Assert.Equal(B, r.Next);
        Assert.Equal(B, m.CurrentSpeakerEmployeeId);
        Assert.Equal(1, m.TurnsUsed);
        Assert.Equal(Now.AddSeconds(10), m.TurnStartedAt);
    }

    [Fact]
    public void Several_mentions_take_turns_in_order_then_back_to_chair()
    {
        var m = Meeting();
        Assert.Equal(C, AgentMeetingTurnRules.Spoke(m, Chair, [C, B], Now).Next);
        Assert.Equal([B], m.QueuedSpeakerIds);
        Assert.Equal(B, AgentMeetingTurnRules.Spoke(m, C, [], Now).Next);
        Assert.Equal(Chair, AgentMeetingTurnRules.Spoke(m, B, [], Now).Next);
        Assert.Equal(3, m.TurnsUsed);
    }

    [Fact]
    public void New_mentions_go_before_older_queue()
    {
        var m = Meeting();
        AgentMeetingTurnRules.Spoke(m, Chair, [B, C], Now);     // B nói, C chờ
        Assert.Equal(D, AgentMeetingTurnRules.Spoke(m, B, [D], Now).Next);
        Assert.Equal([C], m.QueuedSpeakerIds);
    }

    [Fact]
    public void No_mention_returns_turn_to_chair()
    {
        var m = Meeting();
        AgentMeetingTurnRules.Spoke(m, Chair, [B], Now);
        Assert.Equal(Chair, AgentMeetingTurnRules.Spoke(m, B, [], Now).Next);
    }

    [Fact]
    public void Chair_speaking_without_mention_keeps_turn()
    {
        var m = Meeting();
        Assert.Equal(Chair, AgentMeetingTurnRules.Spoke(m, Chair, [], Now).Next);
        Assert.Equal(1, m.TurnsUsed);
    }

    [Fact]
    public void Mentions_of_non_attendees_and_self_are_ignored()
    {
        var m = Meeting();
        Assert.Equal(Chair, AgentMeetingTurnRules.Spoke(m, Chair, [Outsider, Chair], Now).Next);
        Assert.Empty(m.QueuedSpeakerIds);
    }

    [Fact]
    public void Bot_not_holding_turn_cannot_speak_and_nothing_changes()
    {
        var m = Meeting();
        Assert.Contains("Chủ trì", AgentMeetingTurnRules.CanAct(m, B));
        Assert.Equal(TurnChange.None, AgentMeetingTurnRules.Spoke(m, B, [C], Now));
        Assert.Equal(0, m.TurnsUsed);
        Assert.Equal(Chair, m.CurrentSpeakerEmployeeId);
    }

    [Fact]
    public void Bot_passing_hands_turn_to_queue_then_chair()
    {
        var m = Meeting();
        AgentMeetingTurnRules.Spoke(m, Chair, [B, C], Now);
        Assert.Equal(C, AgentMeetingTurnRules.Passed(m, B, Now).Next);
        Assert.Equal(Chair, AgentMeetingTurnRules.Passed(m, C, Now).Next);
        Assert.Equal(3, m.TurnsUsed);
        Assert.Equal(AgentMeetingStatus.Active, m.Status);
    }

    [Fact]
    public void Chair_passing_without_anyone_waiting_ends_meeting()
    {
        var m = Meeting();
        var r = AgentMeetingTurnRules.Passed(m, Chair, Now);
        Assert.Equal(new TurnChange(null, AgentMeetingEndReason.AllPassed), r);
        Assert.Equal(AgentMeetingStatus.Ended, m.Status);
        Assert.Null(m.CurrentSpeakerEmployeeId);
        Assert.Contains("không còn ai phát biểu", AgentMeetingTurnRules.EndNotice(m));
    }

    [Fact]
    public void Chair_passing_with_queue_gives_turn_to_queue()
    {
        var m = Meeting();
        AgentMeetingTurnRules.HumanSpoke(m, [Chair, B], Now); // người thật nhắc chủ trì rồi B
        Assert.Equal(B, AgentMeetingTurnRules.Passed(m, Chair, Now).Next);
    }

    [Fact]
    public void Chair_assigns_by_api()
    {
        var m = Meeting();
        Assert.Null(AgentMeetingTurnRules.CanAssign(m, Chair, C));
        Assert.Equal(C, AgentMeetingTurnRules.Assigned(m, C, Now).Next);
        Assert.Equal(1, m.TurnsUsed);
    }

    [Fact]
    public void Assign_rules()
    {
        var m = Meeting();
        Assert.NotNull(AgentMeetingTurnRules.CanAssign(m, B, C));         // không phải chủ trì
        Assert.NotNull(AgentMeetingTurnRules.CanAssign(m, Chair, Chair)); // tự chỉ định
        Assert.NotNull(AgentMeetingTurnRules.CanAssign(m, Chair, Outsider));
        AgentMeetingTurnRules.Spoke(m, Chair, [B], Now);
        Assert.NotNull(AgentMeetingTurnRules.CanAssign(m, Chair, C));     // chủ trì không giữ lượt
    }

    [Fact]
    public void Human_mention_gives_turn_immediately_without_counting()
    {
        var m = Meeting();
        AgentMeetingTurnRules.Spoke(m, Chair, [B, C], Now); // B đang giữ, C chờ
        var r = AgentMeetingTurnRules.HumanSpoke(m, [D, Outsider], Now.AddMinutes(1));
        Assert.Equal(D, r.Next);
        Assert.Equal(1, m.TurnsUsed);
        Assert.Equal([B, C], m.QueuedSpeakerIds); // B bị ngắt lượt → xếp lại trước hàng cũ
        Assert.Equal(Now.AddMinutes(1), m.TurnStartedAt);
    }

    [Fact]
    public void Human_message_without_bot_mention_changes_nothing()
    {
        var m = Meeting();
        Assert.Equal(TurnChange.None, AgentMeetingTurnRules.HumanSpoke(m, [Outsider], Now));
        Assert.Equal(Chair, m.CurrentSpeakerEmployeeId);
    }

    [Fact]
    public void Turn_cap_ends_meeting_after_last_turn()
    {
        var m = Meeting(maxTurns: 3);
        AgentMeetingTurnRules.Spoke(m, Chair, [B], Now);
        AgentMeetingTurnRules.Spoke(m, B, [C], Now);
        var r = AgentMeetingTurnRules.Spoke(m, C, [], Now);
        Assert.Equal(new TurnChange(null, AgentMeetingEndReason.TurnLimit), r);
        Assert.Equal(AgentMeetingStatus.Ended, m.Status);
        Assert.Equal(3, m.TurnsUsed);
        Assert.Contains("3 lượt", AgentMeetingTurnRules.EndNotice(m));
    }

    [Fact]
    public void Ping_pong_of_assign_and_pass_hits_cap()
    {
        var m = Meeting(maxTurns: 4);
        AgentMeetingTurnRules.Assigned(m, B, Now);
        AgentMeetingTurnRules.Passed(m, B, Now);
        AgentMeetingTurnRules.Assigned(m, B, Now);
        Assert.Equal(AgentMeetingEndReason.TurnLimit, AgentMeetingTurnRules.Passed(m, B, Now).Ended);
    }

    [Fact]
    public void Time_cap_ends_meeting_on_next_turn()
    {
        var m = Meeting(maxMinutes: 5);
        Assert.Equal(AgentMeetingEndReason.TimeLimit, AgentMeetingTurnRules.Spoke(m, Chair, [B], Now.AddMinutes(5)).Ended);
    }

    [Fact]
    public void Turn_times_out_after_three_minutes()
    {
        var m = Meeting();
        Assert.False(AgentMeetingTurnRules.TimedOut(m, Now.AddMinutes(2)));
        Assert.True(AgentMeetingTurnRules.TimedOut(m, Now + AgentMeetingTurnRules.TurnTimeout));
        Assert.Equal(Now + AgentMeetingTurnRules.TurnTimeout, m.TurnDeadline);
        m.End(AgentMeetingEndReason.Stopped, Now, "Người mở");
        Assert.False(AgentMeetingTurnRules.TimedOut(m, Now.AddHours(1)));
        Assert.Null(m.TurnDeadline);
    }

    [Fact]
    public void Ended_meeting_rejects_everything()
    {
        var m = Meeting();
        m.End(AgentMeetingEndReason.Stopped, Now, "Người mở");
        Assert.Equal("Cuộc họp đã kết thúc", AgentMeetingTurnRules.CanAct(m, Chair));
        Assert.Equal(TurnChange.None, AgentMeetingTurnRules.HumanSpoke(m, [B], Now));
        Assert.Contains("Người mở dừng", AgentMeetingTurnRules.EndNotice(m));
    }
}
