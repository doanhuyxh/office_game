using System.Text.Json.Nodes;
using ModelContextProtocol;
using OfficeHub.Mcp.Tools;

namespace OfficeHub.Mcp.Tests;

/// <summary>TEST-216: tool Sổ tay dự án — mục lục theo cây, tìm trang theo tiêu đề, kết quả ghi không kèm lại nội dung, lỗi sửa đồng thời.</summary>
public class ProjectWikiToolsTests
{
    private static readonly Guid A = Guid.Parse("00000000-0000-0000-0000-00000000000a"), B = Guid.Parse("00000000-0000-0000-0000-00000000000b"),
        C = Guid.Parse("00000000-0000-0000-0000-00000000000c"), D = Guid.Parse("00000000-0000-0000-0000-00000000000d"),
        X = Guid.Parse("00000000-0000-0000-0000-0000000000ff");

    private static JsonObject Page(Guid id, Guid? parent, string title, int position) =>
        new() { ["id"] = id.ToString(), ["parentId"] = parent?.ToString(), ["title"] = title, ["position"] = position, ["contentLength"] = 10 };

    [Fact]
    public void Outline_is_depth_first_with_depth_and_no_position()
    {
        // Api trả theo (ParentId, Position): con có thể đứng trước cha; trang D có cha không còn (mồ côi) → coi như gốc
        var pages = new JsonArray(Page(C, A, "Con 2", 1), Page(D, X, "Mồ côi", 1), Page(B, A, "Con 1", 0), Page(A, null, "Gốc", 0));
        var r = ProjectWikiTools.Outline(pages).OfType<JsonObject>().ToList();
        Assert.Equal(["Gốc", "Con 1", "Con 2", "Mồ côi"], r.Select(p => (string)p["title"]!).ToArray());
        Assert.Equal([1, 2, 2, 1], r.Select(p => p["depth"]!.GetValue<int>()).ToArray());
        Assert.All(r, p => Assert.False(p.ContainsKey("position")));
        Assert.Equal(4, pages.Count); // không sửa mảng gốc
    }

    [Fact]
    public void Match_page_by_title_case_insensitive()
    {
        var pages = new List<JsonObject> { Page(A, null, "Quy ước", 0), Page(B, A, "Deploy", 0), Page(C, null, "deploy", 1) };
        Assert.Equal(A, ProjectWikiTools.MatchPage(pages, "quy ƯỚC"));
        Assert.Contains("dùng id", Assert.Throws<McpException>(() => ProjectWikiTools.MatchPage(pages, "Deploy")).Message);
        Assert.Contains("list_wiki_pages", Assert.Throws<McpException>(() => ProjectWikiTools.MatchPage(pages, "Không có")).Message);
    }

    [Fact]
    public void Saved_drops_content_and_nulls()
    {
        var dto = new JsonObject { ["id"] = A.ToString(), ["projectId"] = X.ToString(), ["content"] = "abcdef", ["version"] = 3, ["lockedByName"] = null };
        var r = (JsonObject)ProjectWikiTools.Saved(dto)!;
        Assert.False(r.ContainsKey("content"));
        Assert.False(r.ContainsKey("projectId"));
        Assert.False(r.ContainsKey("lockedByName"));
        Assert.Equal(6, r["contentLength"]!.GetValue<int>());
        Assert.Equal(3, r["version"]!.GetValue<int>());
    }

    [Theory]
    [InlineData(null, null)]
    [InlineData("  ", null)]
    [InlineData("none", "")]
    [InlineData(" Không ", "")]
    [InlineData(" Một dòng ", "Một dòng")]
    public void Summary_value(string? input, string? expected) => Assert.Equal(expected, ProjectWikiTools.SummaryValue(input));

    [Fact]
    public void Conflict_message_asks_to_reread_and_merge()
    {
        var m = ProjectWikiTools.ConflictMessage("Trang đã được Lan sửa (phiên bản 5)", 4, 5);
        Assert.Contains("get_wiki_page", m);
        Assert.Contains("baseVersion = 5", m);
        Assert.Contains("KHÔNG", m);
    }
}
