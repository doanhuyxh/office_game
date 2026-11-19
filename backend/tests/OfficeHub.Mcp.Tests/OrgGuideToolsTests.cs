using System.Text.Json.Nodes;
using ModelContextProtocol;
using OfficeHub.Mcp.Tools;

namespace OfficeHub.Mcp.Tests;

/// <summary>update_department_guide / update_position_guide: ghép nội dung (null = giữ, "none" = xoá), giới hạn độ dài, tìm chức vụ.</summary>
public class OrgGuideToolsTests
{
    [Fact]
    public void Merge_keeps_replaces_and_clears()
    {
        Assert.Equal(("Mô tả cũ", "## Mới"), OrgGuideTools.Merge("Mô tả cũ", "## Cũ", null, "## Mới"));
        Assert.Equal(("Mô tả mới", "## Cũ"), OrgGuideTools.Merge("Mô tả cũ", "## Cũ", "Mô tả mới", null));
        Assert.Equal(((string?)null, (string?)null), OrgGuideTools.Merge("a", "b", "none", " Không "));
    }

    [Fact]
    public void Merge_enforces_limits()
    {
        Assert.Equal(2_000, OrgGuideTools.Merge(null, null, new string('a', 2_000), new string('b', 40_000)).Description!.Length);
        Assert.Throws<McpException>(() => OrgGuideTools.Merge(null, null, new string('a', 2_001), null));
        Assert.Throws<McpException>(() => OrgGuideTools.Merge(null, null, null, new string('b', 40_001)));
    }

    [Fact]
    public void Guide_note_depends_on_bot_account() // TEST-179: bot làm theo hướng dẫn vai trò, người thật giữ ghi chú "tham khảo"
    {
        Assert.Equal(DirectoryTools.GuideNote, (string?)DirectoryTools.WithNote(new JsonObject(), isBot: false)!["_note"]);
        var bot = (string?)DirectoryTools.WithNote(new JsonObject(), isBot: true)!["_note"];
        Assert.Equal(DirectoryTools.BotGuideNote, bot);
        Assert.Contains("QUY TRÌNH LÀM VIỆC", bot);
        Assert.Contains("không duyệt", bot);
        Assert.Null(DirectoryTools.WithNote(null, isBot: true));
    }

    [Fact]
    public void Limits_pinned() // Mcp không tham chiếu module Organization: OrgGuideTests khoá OrgGuide ở cùng giá trị
        => Assert.Equal((2_000, 40_000), (OrgGuideTools.DescriptionMax, OrgGuideTools.GuideMax));

    [Fact]
    public void Position_resolves_by_exact_name_or_id()
    {
        List<JsonObject> all =
        [
            new() { ["id"] = "0193a000-0000-7000-8000-000000000001", ["name"] = "Trưởng phòng" },
            new() { ["id"] = "0193a000-0000-7000-8000-000000000002", ["name"] = "Trưởng nhóm" },
        ];
        Assert.Equal(Guid.Parse("0193a000-0000-7000-8000-000000000002"), OrgGuideTools.ResolvePosition(all, "trưởng nhóm"));
        Assert.Equal(Guid.Parse("0193a000-0000-7000-8000-000000000001"), OrgGuideTools.ResolvePosition(all, "0193A000-0000-7000-8000-000000000001"));
        Assert.Throws<McpException>(() => OrgGuideTools.ResolvePosition(all, "Trưởng"));
    }
}
