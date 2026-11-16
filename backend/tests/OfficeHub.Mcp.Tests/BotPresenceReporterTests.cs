using System.Text.Json;
using OfficeHub.BuildingBlocks.Office;
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
        Assert.Equal("💬 Doanh thu tháng 11 đạt 80%", BotPresenceReporter.Describe("speak_in_meeting", Args("text", "Doanh thu tháng 11 đạt 80%")));
    }

    [Fact]
    public void Go_to_shows_short_walking_status() =>
        Assert.Equal("🚶 Phòng họp nhỏ", BotPresenceReporter.Describe("go_to", Args("place", " Phòng họp nhỏ ")));

    [Fact]
    public void Present_screen_status_does_not_echo_image() =>
        Assert.Equal("🖥 Đang chiếu màn hình", BotPresenceReporter.Describe("present_screen", Args("image", new string('A', 5000))));

    [Fact]
    public void Present_markdown_status_does_not_echo_content() =>
        Assert.Equal("📝 Đang trình bày", BotPresenceReporter.Describe("present_markdown", Args("content", "# Bí mật dài")));

    [Fact]
    public void Task_label_is_code_and_title()
    {
        var t = System.Text.Json.Nodes.JsonNode.Parse("""{ "code": "WEB-12", "title": "Sửa form đăng nhập", "columnName": "Lưu trữ" }""")!.AsObject();
        Assert.Equal("WEB-12 · Sửa form đăng nhập", BotPresenceReporter.LabelOf(t));
        Assert.Equal("WEB-3", BotPresenceReporter.LabelOf(System.Text.Json.Nodes.JsonNode.Parse("""{ "code": "WEB-3" }""")!.AsObject()));
        Assert.Null(BotPresenceReporter.LabelOf(null));
    }

    [Theory]
    [InlineData("working", true)]
    [InlineData("idle", true)]
    [InlineData("error", true)]
    [InlineData("ERROR", false)]
    [InlineData("crashed", false)]
    [InlineData(null, false)]
    public void Presence_state_accepts_working_idle_error_only(string? state, bool ok) =>
        Assert.Equal(ok, BotPresenceReporter.IsPresenceState(state)); // false → endpoint trả 400

    [Fact]
    public void Error_report_is_not_busy_and_carries_one_line_clipped_error()
    {
        var taskId = Guid.NewGuid();
        var projectId = Guid.NewGuid();
        var (busy, task, activity, error) = BotPresenceReporter.Presence(new BotPresenceReport(BotWork.Error,
            Task: "WEB-12 · Sửa form đăng nhập", Activity: "bỏ qua", Error: "Hết hạn\r\n token\u001b[31m " + new string('x', 60), TaskId: taskId, ProjectId: projectId));
        Assert.False(busy);
        Assert.Null(task);
        Assert.NotNull(error);
        Assert.DoesNotContain(error.Text, c => char.IsControl(c));
        Assert.Equal(BotWork.MaxError + 1, error.Text.Length); // 40 ký tự + "…"
        Assert.StartsWith("Hết hạn token [31m x", error.Text);
        Assert.EndsWith("…", error.Text);
        Assert.Equal("WEB-12 · Sửa form đăng nhập", error.Task);
        Assert.Equal(taskId, error.TaskId);
        Assert.Equal(projectId, error.ProjectId);
        Assert.StartsWith("⚠ WEB-12 · Hết hạn token", activity);
        Assert.True(activity.Length <= BotWork.MaxActivity + 1);
    }

    [Fact]
    public void Error_report_without_task_or_text_falls_back()
    {
        var (busy, task, activity, error) = BotPresenceReporter.Presence(new BotPresenceReport(BotWork.Error, Error: "  \n "));
        Assert.False(busy);
        Assert.Null(task);
        Assert.Equal("⚠ Lỗi", activity);
        Assert.Equal(new BotError("Lỗi", null, null, null), error);
    }

    [Fact]
    public void Working_or_idle_clears_error()
    {
        var working = BotPresenceReporter.Presence(new BotPresenceReport(BotWork.Working, Task: "WEB-12 · Sửa form", Error: "cũ"));
        Assert.True(working.Busy);
        Assert.Equal("WEB-12 · Sửa form", working.Task);
        Assert.Equal("WEB-12 · Sửa form", working.Activity);
        Assert.Null(working.Error);

        var idle = BotPresenceReporter.Presence(new BotPresenceReport(BotWork.Idle, Error: "cũ"));
        Assert.False(idle.Busy);
        Assert.Equal(BotWork.IdleBubble, idle.Activity);
        Assert.Null(idle.Error);
    }
}
