using OfficeHub.Modules.Chat.Domain;

namespace OfficeHub.Modules.Chat.Tests;

/// <summary>@nhắc trong tin nhắn (TEST-70).</summary>
public class ChatMentionTests
{
    private static readonly Guid Me = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid Bot = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid Bob = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly (Guid, string)[] Members = [(Me, "NV001"), (Bot, "NV018"), (Bob, "NV012")];

    [Fact]
    public void Matches_member_codes_case_insensitive_in_order_without_duplicates()
    {
        var got = ChatRules.MentionTargets("@nv012 ơi, @NV018 đâu? @NV012.", Members, Me);
        Assert.Equal([Bob, Bot], got);
    }

    [Fact]
    public void Drops_sender_non_members_and_emails()
    {
        Assert.Equal([Bot], ChatRules.MentionTargets("@NV001 @NV999 a@NV012.vn @NV018", Members, Me));
        Assert.Empty(ChatRules.MentionTargets("không nhắc ai", Members, Me));
        Assert.Empty(ChatRules.MentionTargets(null, Members, Me));
    }

    [Fact]
    public void Caps_at_max_mentions()
    {
        var many = Enumerable.Range(1, 15).Select(i => (Guid.NewGuid(), $"NV{i:000}")).ToList();
        var text = string.Join(' ', many.Select(m => "@" + m.Item2));
        Assert.Equal(ChatRules.MaxMentions, ChatRules.MentionTargets(text, many, Me).Count);
    }

    [Theory]
    [InlineData(ConversationType.Office, true)]
    [InlineData(ConversationType.Room, true)]
    [InlineData(ConversationType.Group, true)]
    [InlineData(ConversationType.Direct, false)]
    public void Direct_has_no_mentions(ConversationType type, bool expected) => Assert.Equal(expected, ChatRules.CanMention(type));

    [Fact]
    public void Push_title_names_sender_and_place() =>
        Assert.Equal("An nhắc bạn · Phòng họp nhỏ", ChatRules.MentionPushTitle("An", "Phòng họp nhỏ"));
}
