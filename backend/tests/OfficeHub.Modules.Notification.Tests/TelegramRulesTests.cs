using System.Text.Json;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Notification.Domain;

namespace OfficeHub.Modules.Notification.Tests;

public class TelegramRulesTests
{
    [Theory]
    [InlineData("@agent_dev01_bot", "@agent_dev01_bot")]
    [InlineData("Agent_Dev01_Bot", "@agent_dev01_bot")]
    [InlineData("  @abcbot ", "@abcbot")]
    public void Username_normalized(string input, string expected)
    {
        Assert.Equal(expected, TelegramRules.NormalizeBotUsername(input, out var err));
        Assert.Null(err);
    }

    [Theory]
    [InlineData("@agent_dev01")]      // không kết thúc bằng bot
    [InlineData("@1agentbot")]        // bắt đầu bằng số
    [InlineData("@abot")]             // < 5 ký tự
    [InlineData("@agent-dev_bot")]    // ký tự '-'
    [InlineData("@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaabot")] // 33 ký tự
    public void Username_invalid(string input)
    {
        Assert.Null(TelegramRules.NormalizeBotUsername(input, out var err));
        Assert.NotNull(err);
    }

    [Fact]
    public void Blank_username_clears() => Assert.Null(TelegramRules.NormalizeBotUsername("  ", out var err) ?? err);

    [Fact]
    public void Wake_message_mentions_bot_and_has_exactly_four_fields()
    {
        var p = Guid.NewGuid(); var t = Guid.NewGuid();
        var text = TelegramRules.WakeMessage("@agent_dev01_bot", "NV012", p, t, "TEST-35");
        var lines = text.Split('\n');
        Assert.Equal(2, lines.Length);
        Assert.Equal("@agent_dev01_bot", lines[0]);
        using var doc = JsonDocument.Parse(lines[1]);
        var names = doc.RootElement.EnumerateObject().Select(x => x.Name).ToArray();
        Assert.Equal(["employee_code", "project_id", "task_id", "task_code"], names);
        Assert.Equal("NV012", doc.RootElement.GetProperty("employee_code").GetString());
        Assert.Equal(t.ToString(), doc.RootElement.GetProperty("task_id").GetString());
        Assert.Equal("TEST-35", doc.RootElement.GetProperty("task_code").GetString());
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
