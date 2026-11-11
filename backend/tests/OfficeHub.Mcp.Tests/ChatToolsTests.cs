using ModelContextProtocol;
using OfficeHub.Mcp.Tools;

namespace OfficeHub.Mcp.Tests;

public class ChatToolsTests
{
    [Theory]
    [InlineData("office", "office")]
    [InlineData(" Office ", "office")]
    [InlineData("toàn văn phòng", "office")]
    [InlineData("0193A000-0000-7000-8000-000000000000", "0193a000-0000-7000-8000-000000000000")]
    public void Accepts_office_or_guid(string input, string expected) => Assert.Equal(expected, ChatTools.ConversationId(input));

    [Theory]
    [InlineData("room:meeting-large")]
    [InlineData("")]
    [InlineData(null)]
    [InlineData("00000000-0000-0000-0000-000000000000")]
    [InlineData("../auth/me")]
    public void Rejects_room_and_junk(string? input) => Assert.Throws<McpException>(() => ChatTools.ConversationId(input));
}
