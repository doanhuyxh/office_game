using OfficeHub.Modules.Chat.Domain;

namespace OfficeHub.Modules.Chat.Tests;

public class ChatBotRulesTests
{
    [Theory]
    [InlineData(ConversationType.Office, true)]
    [InlineData(ConversationType.Direct, true)]
    [InlineData(ConversationType.Room, true)]
    public void Bot_uses_office_direct_and_member_rooms(ConversationType type, bool expected) => Assert.Equal(expected, ChatRules.BotCanUse(type));

    [Fact]
    public void Quota_is_60_per_hour()
    {
        Assert.True(ChatRules.BotQuotaLeft(59));
        Assert.False(ChatRules.BotQuotaLeft(60));
        Assert.Equal(TimeSpan.FromHours(1), ChatRules.BotQuotaWindow);
    }

    [Fact]
    public void Upload_quota_is_30_per_hour()
    {
        Assert.True(ChatRules.BotUploadQuotaLeft(29));
        Assert.False(ChatRules.BotUploadQuotaLeft(30));
    }

    [Theory]
    [InlineData("image/png", true)]
    [InlineData("image/jpeg", true)]
    [InlineData("IMAGE/WEBP", true)]
    [InlineData("image/gif", false)]
    [InlineData("image/svg+xml", false)]
    [InlineData("application/pdf", false)]
    public void Screen_frames_are_png_jpeg_webp_only(string type, bool expected) => Assert.Equal(expected, ChatRules.IsScreenImage(type)); // TEST-154
}
