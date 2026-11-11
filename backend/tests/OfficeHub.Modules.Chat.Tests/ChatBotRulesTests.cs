using OfficeHub.Modules.Chat.Domain;

namespace OfficeHub.Modules.Chat.Tests;

public class ChatBotRulesTests
{
    [Theory]
    [InlineData(ConversationType.Office, true)]
    [InlineData(ConversationType.Direct, true)]
    [InlineData(ConversationType.Room, false)]
    public void Bot_uses_office_and_direct_only(ConversationType type, bool expected) => Assert.Equal(expected, ChatRules.BotCanUse(type));

    [Fact]
    public void Quota_is_60_per_hour()
    {
        Assert.True(ChatRules.BotQuotaLeft(59));
        Assert.False(ChatRules.BotQuotaLeft(60));
        Assert.Equal(TimeSpan.FromHours(1), ChatRules.BotQuotaWindow);
    }
}
