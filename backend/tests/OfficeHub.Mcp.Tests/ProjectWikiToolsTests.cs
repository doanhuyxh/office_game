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
    public void Outline_compact_by_default_keeps_only_reading_fields()
    {
        var a = Page(A, null, "Gốc", 0);
        a["summary"] = "Tóm tắt"; a["version"] = 2; a["locked"] = false; a["updatedByName"] = "Lan"; a["updatedAt"] = "2026-11-27T00:00:00Z";
        var b = Page(B, A, "Con", 0);
        b["locked"] = true;
        var r = ProjectWikiTools.Outline(new JsonArray(a, b), detail: false).OfType<JsonObject>().ToList();
        Assert.Equal(["depth", "id", "summary", "title", "version"], r[0].Select(kv => kv.Key).Order().ToArray());
        Assert.True(r[1]["locked"]!.GetValue<bool>());
        Assert.False(r[1].ContainsKey("parentId"));
        Assert.False(r[1].ContainsKey("contentLength"));
    }

    [Fact]
    public void Outline_subtree_and_max_depth()
    {
        // A ─ B ─ D ; A ─ C ; X (gốc khác)
        var pages = new JsonArray(Page(A, null, "Gốc", 0), Page(B, A, "B", 0), Page(C, A, "C", 1), Page(D, B, "D", 0), Page(X, null, "Khác", 1));
        var sub = ProjectWikiTools.Outline(pages, root: A).OfType<JsonObject>().ToList();
        Assert.Equal(["B", "D", "C"], sub.Select(p => (string)p["title"]!).ToArray());
        Assert.Equal([1, 2, 1], sub.Select(p => p["depth"]!.GetValue<int>()).ToArray());
        var top = ProjectWikiTools.Outline(pages, maxDepth: 1).OfType<JsonObject>().ToList();
        Assert.Equal(["Gốc", "Khác"], top.Select(p => (string)p["title"]!).ToArray());
        Assert.Equal(["B", "C"], ProjectWikiTools.Outline(pages, root: A, maxDepth: 1).OfType<JsonObject>().Select(p => (string)p["title"]!).ToArray());
    }

    [Fact]
    public void Match_page_or_id_checks_id_exists()
    {
        var pages = new List<JsonObject> { Page(A, null, "Gốc", 0) };
        Assert.Equal(A, ProjectWikiTools.MatchPageOrId(pages, A.ToString()));
        Assert.Equal(A, ProjectWikiTools.MatchPageOrId(pages, "gốc"));
        Assert.Throws<McpException>(() => ProjectWikiTools.MatchPageOrId(pages, X.ToString()));
    }

    [Fact]
    public void Apply_edit_replaces_unique_match()
    {
        var (c, n) = ProjectWikiTools.ApplyEdit("# A\n\nDòng 1\nDòng 2\n", "Dòng 2", "Dòng hai", false);
        Assert.Equal("# A\n\nDòng 1\nDòng hai\n", c);
        Assert.Equal(1, n);
    }

    [Fact]
    public void Apply_edit_normalizes_crlf_and_can_delete()
    {
        var (c, _) = ProjectWikiTools.ApplyEdit("a\nb\nc", "a\r\nb\r\n", "", false);
        Assert.Equal("c", c);
    }

    [Fact]
    public void Apply_edit_rejects_missing_or_ambiguous_unless_replace_all()
    {
        Assert.Contains("get_wiki_page", Assert.Throws<McpException>(() => ProjectWikiTools.ApplyEdit("abc", "x", "y", false)).Message);
        Assert.Contains("khớp 2 chỗ", Assert.Throws<McpException>(() => ProjectWikiTools.ApplyEdit("ab ab", "ab", "cd", false)).Message);
        Assert.Contains("phân biệt", ProjectWikiTools.ApplyEdit("phân biệt", "phân", "phân", false).Content);
        Assert.Throws<McpException>(() => ProjectWikiTools.ApplyEdit("Ab", "ab", "x", false)); // phân biệt hoa thường
        var (c, n) = ProjectWikiTools.ApplyEdit("ab ab", "ab", "cd", true);
        Assert.Equal(("cd cd", 2), (c, n));
    }

    [Fact]
    public void Position_after_sibling()
    {
        // A: con B (0), C (1), D (2); X gốc khác
        var pages = new List<JsonObject> { Page(A, null, "Gốc", 0), Page(B, A, "B", 0), Page(C, A, "C", 1), Page(D, A, "D", 2), Page(X, null, "Khác", 1) };
        Assert.Null(ProjectWikiTools.PositionAfter(pages, A, null, null));
        Assert.Equal(0, ProjectWikiTools.PositionAfter(pages, A, null, "first"));
        Assert.Equal(2, ProjectWikiTools.PositionAfter(pages, A, null, "C"));            // tạo mới sau C
        Assert.Equal(1, ProjectWikiTools.PositionAfter(pages, A, D, B.ToString()));     // chuyển D lên sau B (bỏ D khỏi danh sách)
        Assert.Equal(1, ProjectWikiTools.PositionAfter(pages, null, null, "Gốc"));      // cấp gốc
        Assert.Contains("cùng trang cha", Assert.Throws<McpException>(() => ProjectWikiTools.PositionAfter(pages, A, null, "Khác")).Message);
        Assert.Throws<McpException>(() => ProjectWikiTools.PositionAfter(pages, A, C, "C"));
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
