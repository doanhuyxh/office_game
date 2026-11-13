using System.Text.Json;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Notification.Domain;

namespace OfficeHub.Modules.Notification.Tests;

public class TelegramRulesTests
{
    [Fact]
    public void Wake_message_is_single_json_line_with_event()
    {
        var p = Guid.NewGuid(); var t = Guid.NewGuid();
        var text = TelegramRules.WakeMessage("NV012", p, t, "TEST-35", TelegramRules.Assigned);
        Assert.DoesNotContain('\n', text);
        Assert.DoesNotContain("@", text);
        using var doc = JsonDocument.Parse(text);
        var names = doc.RootElement.EnumerateObject().Select(x => x.Name).ToArray();
        Assert.Equal(["employee_code", "project_id", "task_id", "task_code", "event"], names);
        Assert.Equal("NV012", doc.RootElement.GetProperty("employee_code").GetString());
        Assert.Equal(t.ToString(), doc.RootElement.GetProperty("task_id").GetString());
        Assert.Equal("TEST-35", doc.RootElement.GetProperty("task_code").GetString());
        Assert.Equal("assigned", doc.RootElement.GetProperty("event").GetString());
    }

    [Fact]
    public void Ready_wake_message_has_same_fields_as_assigned()
    {
        var p = Guid.NewGuid(); var t = Guid.NewGuid();
        var text = TelegramRules.WakeMessage("NV018", p, t, "TEST-75", TelegramRules.Ready);
        Assert.DoesNotContain('\n', text);
        using var doc = JsonDocument.Parse(text);
        Assert.Equal(["employee_code", "project_id", "task_id", "task_code", "event"], doc.RootElement.EnumerateObject().Select(x => x.Name).ToArray());
        Assert.Equal(p.ToString(), doc.RootElement.GetProperty("project_id").GetString());
        Assert.Equal(t.ToString(), doc.RootElement.GetProperty("task_id").GetString());
        Assert.Equal("TEST-75", doc.RootElement.GetProperty("task_code").GetString());
        Assert.Equal("ready", doc.RootElement.GetProperty("event").GetString());
    }

    [Fact]
    public void Mention_wake_message_carries_comment_id()
    {
        var c = Guid.NewGuid();
        var text = TelegramRules.WakeMessage("NV018", Guid.NewGuid(), Guid.NewGuid(), "TEST-63", TelegramRules.Mentioned, c);
        using var doc = JsonDocument.Parse(text);
        Assert.Equal(["employee_code", "project_id", "task_id", "task_code", "event", "comment_id"], doc.RootElement.EnumerateObject().Select(x => x.Name).ToArray());
        Assert.Equal("mentioned", doc.RootElement.GetProperty("event").GetString());
        Assert.Equal(c.ToString(), doc.RootElement.GetProperty("comment_id").GetString());
        Assert.Equal("returned", TelegramRules.Returned);
    }

    [Fact]
    public void Chat_mention_wake_message_has_conversation_and_message_but_no_task()
    {
        var c = Guid.NewGuid(); var m = Guid.NewGuid();
        var text = TelegramRules.ChatWakeMessage("NV018", c, m);
        Assert.DoesNotContain('\n', text);
        using var doc = JsonDocument.Parse(text);
        Assert.Equal(["employee_code", "event", "conversation_id", "message_id"], doc.RootElement.EnumerateObject().Select(x => x.Name).ToArray());
        Assert.Equal("chat_mention", doc.RootElement.GetProperty("event").GetString());
        Assert.Equal(c.ToString(), doc.RootElement.GetProperty("conversation_id").GetString());
        Assert.Equal(m.ToString(), doc.RootElement.GetProperty("message_id").GetString());
    }

    [Fact]
    public void Meeting_turn_wake_message_has_session_and_conversation_only()
    {
        var sid = Guid.NewGuid(); var c = Guid.NewGuid();
        var text = TelegramRules.MeetingWakeMessage("NV018", sid, c);
        Assert.DoesNotContain('\n', text);
        using var doc = JsonDocument.Parse(text);
        Assert.Equal(["employee_code", "event", "session_id", "conversation_id"], doc.RootElement.EnumerateObject().Select(x => x.Name).ToArray());
        Assert.Equal("meeting_turn", doc.RootElement.GetProperty("event").GetString());
        Assert.Equal(sid.ToString(), doc.RootElement.GetProperty("session_id").GetString());
        Assert.Equal(c.ToString(), doc.RootElement.GetProperty("conversation_id").GetString());
    }

    [Theory]
    [InlineData("-1001234567890", true)]
    [InlineData("123456", true)]
    [InlineData("@my_channel", true)]
    [InlineData("abc", false)]
    [InlineData("-100abc", false)]
    public void Chat_id(string v, bool ok) => Assert.Equal(ok, TelegramRules.ChatId().IsMatch(v));

    [Fact]
    public void Bot_token_format()
    {
        Assert.Matches(TelegramRules.BotToken(), "123456789:AAH-abcdefghijklmnopqrstuvwxyz012345");
        Assert.DoesNotMatch(TelegramRules.BotToken(), "abc:def");
    }

    [Fact]
    public void Retry_policy()
    {
        Assert.True(TelegramQueueRules.Retryable(null));
        Assert.True(TelegramQueueRules.Retryable(429));
        Assert.True(TelegramQueueRules.Retryable(502));
        Assert.False(TelegramQueueRules.Retryable(401));
        Assert.False(TelegramQueueRules.Retryable(400));
        var now = DateTimeOffset.UnixEpoch;
        Assert.Equal(now.AddSeconds(30), TelegramQueueRules.NextAttempt(1, now));
        Assert.Equal(now.AddSeconds(7), TelegramQueueRules.NextAttempt(2, now, retryAfterSeconds: 7));
        Assert.Null(TelegramQueueRules.NextAttempt(TelegramQueueRules.MaxAttempts, now));
    }
}
