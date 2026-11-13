using System.Text.Json.Nodes;
using ModelContextProtocol;
using OfficeHub.Mcp.Tools;

namespace OfficeHub.Mcp.Tests;

/// <summary>Tool họp agent (TEST-82): chọn bot dự họp theo mã / tên, báo rõ ai đang giữ lượt.</summary>
public sealed class MeetingSessionToolsTests
{
    private static readonly List<JsonObject> Bots =
    [
        new() { ["employeeId"] = "0193a000-0000-7000-8000-000000000001", ["code"] = "NV020", ["name"] = "Bot Kinh doanh", ["isSpeaking"] = true },
        new() { ["employeeId"] = "0193a000-0000-7000-8000-000000000002", ["code"] = "NV021", ["name"] = "Bot Tài chính", ["isSpeaking"] = false },
    ];

    [Theory]
    [InlineData("NV021")]
    [InlineData("nv021")]
    [InlineData(" @NV021 ")]
    [InlineData("bot tài chính")]
    public void Attendee_by_code_or_name(string who) =>
        Assert.Equal("NV021", (string?)MeetingSessionTools.Attendee(Bots, who)["code"]);

    [Fact]
    public void Attendee_not_in_meeting_lists_attendees()
    {
        var e = Assert.Throws<McpException>(() => MeetingSessionTools.Attendee(Bots, "NV099"));
        Assert.Contains("Bot Kinh doanh (NV020)", e.Message);
    }

    [Fact]
    public void Not_my_turn_names_holder()
    {
        var e = Assert.Throws<McpException>(() => MeetingSessionTools.RequireTurn(new JsonObject { ["isMyTurn"] = false }, Bots));
        Assert.Contains("Bot Kinh doanh (NV020)", e.Message);
        MeetingSessionTools.RequireTurn(new JsonObject { ["isMyTurn"] = true }, Bots);
    }
}
