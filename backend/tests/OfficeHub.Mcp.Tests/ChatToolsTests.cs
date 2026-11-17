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

    [Fact]
    public void Upload_ids_are_normalized_and_deduplicated()
    {
        var ids = ChatTools.UploadIds([" 0193A000-0000-7000-8000-000000000001 ", "0193a000-0000-7000-8000-000000000001", "", "0193a000-0000-7000-8000-000000000002"]);
        Assert.Equal(["0193a000-0000-7000-8000-000000000001", "0193a000-0000-7000-8000-000000000002"], ids);
        Assert.Empty(ChatTools.UploadIds(null));
    }

    [Theory]
    [InlineData("abc")]
    [InlineData("00000000-0000-0000-0000-000000000000")]
    public void Upload_ids_reject_junk(string id) => Assert.Throws<McpException>(() => ChatTools.UploadIds([id]));

    [Fact]
    public void Upload_ids_max_five()
    {
        var six = Enumerable.Range(1, 6).Select(i => $"0193a000-0000-7000-8000-00000000000{i}").ToArray();
        Assert.Throws<McpException>(() => ChatTools.UploadIds(six));
    }

    [Fact]
    public void Curl_put_keeps_content_type_and_quotes_url()
    {
        var cmd = ChatTools.CurlPut("https://s3.example/b/k?X-Amz-Signature=abc&x='y", "image/png");
        Assert.Contains("-H 'Content-Type: image/png'", cmd);
        Assert.Contains("--upload-file '<đường-dẫn-file>'", cmd);
        Assert.EndsWith("'https://s3.example/b/k?X-Amz-Signature=abc&x=%27y'", cmd);
    }
}
