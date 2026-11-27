using System.Reflection;
using System.Text.Json.Nodes;
using ModelContextProtocol.Server;
using OfficeHub.Mcp.Infrastructure;
using OfficeHub.Mcp.Tools;

namespace OfficeHub.Mcp.Tests;

/// <summary>TEST-143: hồ sơ tool theo loại phiên agent (/mcp?profile=…) + cắt gọn kết quả get_task / read_chat.</summary>
public class ToolProfilesTests
{
    /// <summary>Mọi tool trong assembly Mcp (tên + ReadOnly) — đọc từ attribute như WithToolsFromAssembly.</summary>
    private static readonly (string Name, bool ReadOnly)[] All = typeof(ChatTools).Assembly.GetTypes()
        .Where(t => t.GetCustomAttribute<McpServerToolTypeAttribute>() is not null)
        .SelectMany(t => t.GetMethods(BindingFlags.Public | BindingFlags.Static))
        .Select(m => m.GetCustomAttribute<McpServerToolAttribute>())
        .Where(a => a is not null)
        .Select(a => (a!.Name!, a.ReadOnly))
        .ToArray();

    private static string[] Of(string? profile) => All.Where(t => ToolProfiles.Allows(profile, t.Name, t.ReadOnly)).Select(t => t.Name).Order().ToArray();

    [Fact]
    public void Every_listed_name_is_a_real_tool()
    {
        var names = All.Select(t => t.Name).ToHashSet();
        Assert.Equal(112, names.Count);
        // Tên sai trong hồ sơ = tool lặng lẽ biến mất khỏi phiên agent
        foreach (var n in ToolProfiles.ChatWrites.Concat(ToolProfiles.MeetingWrites).Concat(ToolProfiles.TaskExcluded))
            Assert.Contains(n, names);
        // Danh sách ghi của chat / họp chỉ chứa tool GHI (tool đọc đã có sẵn)
        foreach (var n in ToolProfiles.ChatWrites.Concat(ToolProfiles.MeetingWrites))
            Assert.False(All.Single(t => t.Name == n).ReadOnly, n);
    }

    [Fact]
    public void No_or_unknown_profile_lists_everything()
    {
        Assert.Equal(112, Of(null).Length);
        Assert.Null(ToolProfiles.Parse("abc"));
        Assert.Null(ToolProfiles.Parse(""));
        Assert.Equal(ToolProfiles.Meeting, ToolProfiles.Parse(" Meeting "));
    }

    [Fact]
    public void Chat_profile()
    {
        var chat = Of(ToolProfiles.Chat);
        foreach (var n in new[] { "read_chat", "view_attachment", "send_chat_message", "mark_chat_read", "get_my_role", "list_opportunities", "create_task", "go_to" })
            Assert.Contains(n, chat);
        foreach (var n in new[] { "approve_request", "reject_request", "check_in_out", "speak_in_meeting", "create_department", "submit_document", "present_screen", "create_upload" })
            Assert.DoesNotContain(n, chat);
    }

    [Fact]
    public void Meeting_profile()
    {
        var meeting = Of(ToolProfiles.Meeting);
        foreach (var n in new[] { "get_my_meeting", "read_chat", "view_attachment", "speak_in_meeting", "pass_turn", "assign_turn", "create_task", "present_markdown", "get_finance_overview" })
            Assert.Contains(n, meeting);
        foreach (var n in new[] { "send_chat_message", "approve_request", "update_task_status", "go_to", "submit_leave_request", "book_meeting_room", "create_upload" })
            Assert.DoesNotContain(n, meeting);
    }

    [Fact]
    public void Task_profile()
    {
        var task = Of(ToolProfiles.Task);
        foreach (var n in new[] { "get_task", "update_task_status", "comment_task", "create_document", "present_screen", "go_to", "create_upload", "view_attachment" })
            Assert.Contains(n, task);
        foreach (var n in ToolProfiles.TaskExcluded) Assert.DoesNotContain(n, task);
        Assert.Equal(112 - ToolProfiles.TaskExcluded.Count, task.Length);
    }

    [Fact]
    public void Compact_removes_null_properties_recursively()
    {
        var o = JsonNode.Parse("""{"a":null,"b":1,"c":{"d":null,"e":[{"f":null,"g":2},null]}}""");
        Assert.Equal("""{"b":1,"c":{"e":[{"g":2},null]}}""", ToolHelpers.Compact(o)!.ToJsonString());
    }

    [Fact]
    public void Get_task_keeps_newest_comments_and_history()
    {
        JsonArray Items(string prefix, int n) => new(Enumerable.Range(1, n).Select(i => (JsonNode?)new JsonObject { ["id"] = $"{prefix}{i}", ["note"] = null }).ToArray());
        var detail = new JsonObject { ["task"] = new JsonObject { ["code"] = "T-1", ["dueOn"] = null }, ["comments"] = Items("c", 25), ["activities"] = Items("a", 3) };
        var r = ProjectTools.TrimTask(detail, comments: 20, history: 20);
        var c = r["comments"]!.AsArray();
        Assert.Equal(20, c.Count);
        Assert.Equal("c6", c[0]!["id"]!.GetValue<string>()); // cũ → mới, giữ 20 cái cuối
        Assert.Equal("c25", c[19]!["id"]!.GetValue<string>());
        Assert.Equal(25, r["commentsTotal"]!.GetValue<int>());
        Assert.Equal(3, r["activities"]!.AsArray().Count);
        Assert.Null(r["activitiesTotal"]); // không bị cắt → không ghi tổng
        Assert.False(r["task"]!.AsObject().ContainsKey("dueOn")); // bỏ trường null
        Assert.False(c[0]!.AsObject().ContainsKey("note"));
        // 0 = không lấy; vượt trần 200 bị kẹp
        var none = ProjectTools.TrimTask(new JsonObject { ["comments"] = Items("c", 5) }, comments: 0, history: 999);
        Assert.Empty(none["comments"]!.AsArray());
        Assert.Equal(5, none["commentsTotal"]!.GetValue<int>());
    }

    [Fact]
    public void Column_guides_are_stripped_but_has_guide_kept()
    {
        // TEST-186: get_project / get_task không trả nội dung hướng dẫn của các cột — chỉ hasGuide; columnGuide (cột hiện tại) giữ nguyên
        var detail = new JsonObject
        {
            ["columnGuide"] = "Review theo checklist",
            ["columns"] = new JsonArray(
                new JsonObject { ["name"] = "Chờ review", ["hasGuide"] = true, ["guide"] = "Review theo checklist" },
                new JsonObject { ["name"] = "Deploy", ["hasGuide"] = false, ["guide"] = "nội dung cũ khi tắt đánh thức" }),
        };
        ProjectTools.StripColumnGuides(detail["columns"] as JsonArray);
        var r = ProjectTools.TrimTask(detail, comments: 20, history: 20);
        foreach (var c in r["columns"]!.AsArray()) Assert.False(c!.AsObject().ContainsKey("guide"));
        Assert.True(r["columns"]![0]!["hasGuide"]!.GetValue<bool>());
        Assert.Equal("Review theo checklist", r["columnGuide"]!.GetValue<string>());
        ProjectTools.StripColumnGuides(null); // không có columns → không lỗi
    }
}
