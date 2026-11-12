using OfficeHub.Modules.Chat.Domain;

namespace OfficeHub.Modules.Chat.Tests;

/// <summary>TEST-54: sửa tin (24 giờ), cảm xúc emoji tự do, tạo nhóm, mẫu tìm kiếm.</summary>
public class ChatEditReactGroupTests
{
    private static readonly DateTimeOffset Sent = new(2026, 11, 12, 3, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Edit_allowed_within_24_hours_only()
    {
        Assert.True(ChatRules.CanEdit(Sent, Sent.AddMinutes(1)));
        Assert.True(ChatRules.CanEdit(Sent, Sent.AddHours(24)));
        Assert.False(ChatRules.CanEdit(Sent, Sent.AddHours(24).AddSeconds(1)));
    }

    [Theory]
    [InlineData("👍", "👍")]
    [InlineData(" ❤️ ", "❤️")]
    [InlineData("👍🏽", "👍🏽")]
    [InlineData("👨‍👩‍👧", "👨‍👩‍👧")]
    [InlineData("🇻🇳", "🇻🇳")]
    [InlineData("😂", "😂")]
    public void Free_emoji_accepted(string input, string expected) => Assert.Equal(expected, ChatRules.NormalizeEmoji(input));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("a")]
    [InlineData("ok")]
    [InlineData("1")]
    [InlineData("👍👍")]
    [InlineData("👍 a")]
    [InlineData("\u0007")]
    public void Not_a_single_emoji_rejected(string? input) => Assert.Null(ChatRules.NormalizeEmoji(input));

    [Fact]
    public void Group_needs_title_and_members()
    {
        Assert.Empty(ChatRules.ValidateGroup("Dự án A", 2));
        Assert.Contains(ChatRules.ValidateGroup(" ", 2), e => e.Field == "title");
        Assert.Contains(ChatRules.ValidateGroup(new string('x', ChatRules.MaxGroupTitleLength + 1), 2), e => e.Field == "title");
        Assert.Contains(ChatRules.ValidateGroup("A", 0), e => e.Field == "userIds");
        Assert.Contains(ChatRules.ValidateGroup("A", ChatRules.MaxGroupMembers), e => e.Field == "userIds"); // + người tạo = vượt
        Assert.Empty(ChatRules.ValidateGroup("A", ChatRules.MaxGroupMembers - 1));
    }

    [Fact]
    public void Like_pattern_escapes_wildcards()
    {
        Assert.Equal("%hello%", ChatRules.LikeContains("hello"));
        Assert.Equal(@"%50\%\_off\\%", ChatRules.LikeContains(@"50%_off\"));
    }
}
