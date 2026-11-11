using System.Text.Json;
using OfficeHub.Mcp.Infrastructure;

namespace OfficeHub.Mcp.Tests;

/// <summary>Dòng "bot đang làm gì" trong văn phòng 3D = tiêu đề tool + đối tượng.</summary>
public class BotPresenceReporterTests
{
    private static Dictionary<string, JsonElement> Args(string key, string value) =>
        new() { [key] = JsonDocument.Parse(JsonSerializer.Serialize(value)).RootElement };

    [Fact]
    public void Uses_tool_title_and_target_code()
    {
        Assert.Equal("Chuyển trạng thái việc · WEB-12", BotPresenceReporter.Describe("update_task_status", Args("task", "WEB-12")));
        Assert.Equal("Việc của tôi", BotPresenceReporter.Describe("list_my_tasks", null));
    }

    [Fact]
    public void Skips_guid_targets_and_unknown_tools_fall_back_to_name()
    {
        Assert.Equal("Chi tiết việc", BotPresenceReporter.Describe("get_task", Args("task", Guid.NewGuid().ToString())));
        Assert.Equal("some_tool", BotPresenceReporter.Describe("some_tool", null));
    }

    [Fact]
    public void Chat_message_becomes_speech_bubble()
    {
        Assert.Equal("💬 Xong việc WEB-12 rồi ạ", BotPresenceReporter.Describe("send_chat_message", Args("text", "  Xong việc WEB-12 rồi ạ ")));
        var longText = new string('a', 100);
        Assert.Equal("💬 " + new string('a', 80) + "…", BotPresenceReporter.Describe("send_chat_message", Args("text", longText)));
        Assert.Equal("Gửi tin nhắn", BotPresenceReporter.Describe("send_chat_message", Args("text", " ")));
        Assert.Equal("Danh sách tin nhắn", BotPresenceReporter.Describe("list_chats", null));
    }

    [Fact]
    public void Go_to_shows_short_walking_status() =>
        Assert.Equal("🚶 Phòng họp nhỏ", BotPresenceReporter.Describe("go_to", Args("place", " Phòng họp nhỏ ")));
}
