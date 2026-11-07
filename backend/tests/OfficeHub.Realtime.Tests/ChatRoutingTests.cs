using OfficeHub.Realtime.Chat;

namespace OfficeHub.Realtime.Tests;

/// <summary>Chọn người nhận tin chat và đổi tin sang dòng chat của văn phòng 3D.</summary>
public class ChatRoutingTests
{
    private static readonly Guid Alice = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid Bob = Guid.Parse("22222222-2222-2222-2222-222222222222");

    [Fact]
    public void Office_message_goes_to_everyone()
    {
        Assert.Null(ChatRouting.Groups(null, Alice.ToString()));
    }

    [Fact]
    public void Direct_message_goes_to_both_people_and_sender_is_always_included()
    {
        var groups = ChatRouting.Groups([Bob], Alice.ToString())!;
        Assert.Equal(2, groups.Count);
        Assert.Contains($"u:{Alice}", groups);
        Assert.Contains($"u:{Bob}", groups);
    }

    [Fact]
    public void Sender_is_added_even_when_missing_from_recipients_and_duplicates_are_dropped()
    {
        var groups = ChatRouting.Groups([Bob, Bob, Alice], Alice.ToString().ToUpperInvariant())!;
        Assert.Equal(2, groups.Count);
    }

    private static ChatMessageDto Msg(string type = "Office", string? text = "xin chào", bool deleted = false, params ChatAttachmentDto[] files) =>
        new("m1", 1, "c1", type, type == "Room" ? "meeting-large" : null, type == "Room" ? "Phòng họp lớn" : null,
            Alice.ToString(), "An", text, "2026-11-07T03:00:00Z", deleted, files, null);

    [Fact]
    public void Office_message_becomes_office_line()
    {
        var line = ChatRouting.ToOfficeChat(Msg())!;
        Assert.Equal("office", line.Channel);
        Assert.Equal(Alice.ToString(), line.Id);
        Assert.Equal("An", line.Name);
        Assert.Equal("xin chào", line.Text);
        Assert.Null(line.RoomId);
    }

    [Fact]
    public void Room_message_keeps_room_info()
    {
        var line = ChatRouting.ToOfficeChat(Msg("Room"))!;
        Assert.Equal("room", line.Channel);
        Assert.Equal("meeting-large", line.RoomId);
        Assert.Equal("Phòng họp lớn", line.RoomName);
    }

    [Fact]
    public void Direct_and_recalled_messages_never_reach_the_3d_hud()
    {
        Assert.Null(ChatRouting.ToOfficeChat(Msg("Direct")));
        Assert.Null(ChatRouting.ToOfficeChat(Msg(deleted: true)));
    }

    [Fact]
    public void Attachment_only_message_gets_placeholder_text()
    {
        var image = new ChatAttachmentDto("a1", "anh.png", "image/png", 10, true, "u");
        var file = new ChatAttachmentDto("a2", "bao-cao.pdf", "application/pdf", 10, false, "u");
        Assert.Equal("[Ảnh] anh.png, [Tệp] bao-cao.pdf", ChatRouting.ToOfficeChat(Msg(text: "  ", files: [image, file]))!.Text);
        Assert.Equal("xin chào", ChatRouting.ToOfficeChat(Msg(files: [image]))!.Text); // có chữ thì giữ chữ
        Assert.Null(ChatRouting.ToOfficeChat(Msg(text: null))); // không chữ, không tệp
    }

    [Fact]
    public void Hub_message_maps_api_result_and_normalizes_time()
    {
        var api = new ApiMessageDto(Guid.Parse("33333333-3333-3333-3333-333333333333"), 7, Guid.Parse("44444444-4444-4444-4444-444444444444"),
            Alice, "An", "hi", "2026-11-07T10:00:00+07:00", false,
            [new ApiAttachmentDto(Bob, "a.png", "image/png", 5, true, "https://s3/x")], "cid");
        var dto = ChatRouting.ToHubMessage(new SendResultDto(api, "Room", "kt", "Phòng Kế toán", [Bob]));
        Assert.Equal("2026-11-07T03:00:00Z", dto.CreatedAt);
        Assert.Equal("Room", dto.ConversationType);
        Assert.Equal("kt", dto.RoomId);
        Assert.Equal("cid", dto.ClientId);
        Assert.Equal(7, dto.Seq);
        Assert.Equal(Bob.ToString(), Assert.Single(dto.Attachments).Id);
    }
}
