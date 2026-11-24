using OfficeHub.Modules.Projects.Domain;

namespace OfficeHub.Modules.Projects.Tests;

/// <summary>TEST-215: sổ tay dự án — quyền (thành viên / quản lý / token AI / trang khoá / dự án đóng), giới hạn, cây, đoạn trích tìm kiếm.</summary>
public class WikiRulesTests
{
    // ---- Quyền sửa ----
    [Fact]
    public void Non_member_cannot_edit() => Assert.Equal(403, WikiRules.EditDenial(canWork: false, canManage: false, active: true, byToken: false)!.Status);

    [Theory]
    [InlineData(false, false)]
    [InlineData(false, true)]  // token AI của thành viên: được tạo / sửa / nối thêm
    [InlineData(true, false)]
    [InlineData(true, true)]
    public void Members_and_bots_edit_open_pages_in_active_project(bool canManage, bool byToken) =>
        Assert.Null(WikiRules.EditDenial(canWork: true, canManage, active: true, byToken));

    [Fact]
    public void Locked_page_member_403() =>
        Assert.Equal(new WikiDenial(403, WikiRules.LockedPage), WikiRules.EditDenial(true, false, true, false, locked: true));

    [Fact]
    public void Locked_page_token_403_even_for_manager() => Assert.Equal(403, WikiRules.EditDenial(true, true, true, byToken: true, locked: true)!.Status);

    [Fact]
    public void Locked_page_manager_on_web_ok() => Assert.Null(WikiRules.EditDenial(true, true, true, false, locked: true));

    [Fact]
    public void Closed_project_member_409() =>
        Assert.Equal(new WikiDenial(409, ClosedProjectRules.MemberOnlyComment), WikiRules.EditDenial(true, false, active: false, byToken: false));

    [Fact]
    public void Closed_project_token_409() => Assert.Equal(409, WikiRules.EditDenial(true, true, active: false, byToken: true)!.Status);

    [Fact]
    public void Closed_project_manager_on_web_ok() => Assert.Null(WikiRules.EditDenial(true, true, active: false, byToken: false));

    // ---- Quyền quản lý (xoá, khoá, khôi phục) ----
    [Fact]
    public void Manage_manager_on_web_ok_even_when_closed()
    {
        Assert.Null(WikiRules.ManageDenial(canManage: true, active: true, byToken: false));
        Assert.Null(WikiRules.ManageDenial(canManage: true, active: false, byToken: false));
    }

    [Fact]
    public void Manage_member_403() => Assert.Equal(new WikiDenial(403, WikiRules.ManagerOnly), WikiRules.ManageDenial(false, true, false));

    [Fact]
    public void Manage_token_403_even_for_manager() => Assert.Equal(new WikiDenial(403, WikiRules.NoAgent), WikiRules.ManageDenial(true, true, byToken: true));

    [Fact]
    public void Flags_follow_denials()
    {
        Assert.Equal((true, false), WikiRules.Flags(canWork: true, canManage: false, active: true, byToken: false, locked: false));
        Assert.Equal((false, false), WikiRules.Flags(true, false, true, false, locked: true));
        Assert.Equal((true, true), WikiRules.Flags(true, true, true, false, locked: true));
        Assert.Equal((false, false), WikiRules.Flags(false, false, true, false, false)); // người xem nhờ phòng ban: chỉ đọc
    }

    // ---- Chuẩn hoá + giới hạn ----
    [Fact]
    public void Title_and_summary_are_one_line()
    {
        Assert.Equal("Quy trình  deploy", WikiRules.NormalizeTitle("  Quy trình\r\ndeploy "));
        Assert.Null(WikiRules.NormalizeSummary("   "));
        Assert.Equal("a b", WikiRules.NormalizeSummary("a\nb"));
    }

    [Fact]
    public void Content_crlf_to_lf() => Assert.Equal("a\nb", WikiRules.NormalizeContent("a\r\nb"));

    [Fact]
    public void Limits()
    {
        Assert.Empty(WikiRules.Errors("T", null, new string('x', WikiRules.MaxContent)));
        var e = WikiRules.Errors("", new string('s', 301), new string('x', WikiRules.MaxContent + 1), new string('n', 301));
        Assert.Equal(["title", "summary", "content", "note"], e.Keys.ToArray());
        Assert.Equal("Nội dung tối đa 50.000 ký tự / trang", e["content"]);
        Assert.Contains("title", WikiRules.Errors(new string('t', 201), null, "").Keys);
    }

    [Fact]
    public void Unchanged_save_detected()
    {
        Assert.True(WikiRules.IsUnchanged("A", null, "x", "A", null, "x"));
        Assert.True(WikiRules.IsUnchanged("A", "", "x", "A", null, "x"));
        Assert.False(WikiRules.IsUnchanged("A", null, "x", "A", "s", "x"));
        Assert.False(WikiRules.IsUnchanged("A", null, "x", "B", null, "x"));
        Assert.False(WikiRules.IsUnchanged("A", null, "x", "A", null, "y"));
    }

    [Fact]
    public void Same_title_ignores_case() => Assert.True(WikiRules.SameTitle("Quy Trình", " quy trình "));

    [Theory]
    [InlineData("", "mới", "mới")]
    [InlineData("cũ", "mới", "cũ\n\nmới")]
    [InlineData("cũ\n\n\n", "\nmới\n", "cũ\n\nmới")]
    public void Append_separates_paragraphs(string content, string text, string expected) => Assert.Equal(expected, WikiRules.Append(content, text));

    // ---- Cây ----
    private static readonly Guid A = Guid.NewGuid(), B = Guid.NewGuid(), C = Guid.NewGuid(), D = Guid.NewGuid(), E = Guid.NewGuid();
    // A > B > C > D (4 cấp), E gốc
    private static readonly List<WikiNode> Tree = [new(A, null), new(B, A), new(C, B), new(D, C), new(E, null)];

    [Fact]
    public void Create_under_level_3_ok_level_4_too_deep()
    {
        Assert.Null(WikiRules.PlacementError(null, null, Tree));
        Assert.Null(WikiRules.PlacementError(null, C, Tree));
        Assert.Equal("Sổ tay sâu tối đa 4 cấp", WikiRules.PlacementError(null, D, Tree));
    }

    [Fact]
    public void Unknown_parent() => Assert.NotNull(WikiRules.PlacementError(null, Guid.NewGuid(), Tree));

    [Fact]
    public void Cannot_move_under_self_or_descendant()
    {
        Assert.Equal("Không đặt trang làm con của chính nó hoặc trang con của nó", WikiRules.PlacementError(A, A, Tree));
        Assert.Equal("Không đặt trang làm con của chính nó hoặc trang con của nó", WikiRules.PlacementError(B, D, Tree));
    }

    [Fact]
    public void Move_counts_subtree_height()
    {
        Assert.Null(WikiRules.PlacementError(B, null, Tree));       // B > C > D lên gốc: 3 cấp
        Assert.Null(WikiRules.PlacementError(B, E, Tree));          // E > B > C > D: đúng 4 cấp
        Assert.NotNull(WikiRules.PlacementError(B, C, Tree));       // dưới con của chính nó
    }

    [Fact]
    public void Move_subtree_depth_boundary()
    {
        Assert.Null(WikiRules.PlacementError(C, E, Tree));          // E > C > D: 3 cấp
        Assert.NotNull(WikiRules.PlacementError(A, E, Tree));       // E > A > B > C > D: 5 cấp
    }

    [Fact]
    public void Reorder_inserts_and_clamps()
    {
        Guid x = Guid.NewGuid(), y = Guid.NewGuid(), z = Guid.NewGuid();
        Assert.Equal([y, x, z], WikiRules.Reorder([x, y, z], y, 0));
        Assert.Equal([x, z, y], WikiRules.Reorder([x, y, z], y, 99));
        Assert.Equal([z, x, y], WikiRules.Reorder([x, y], z, -5));
    }

    // ---- Đoạn trích tìm kiếm ----
    [Fact]
    public void Snippet_around_match_with_ellipsis()
    {
        var text = new string('a', 200) + " Triển khai bằng Docker " + new string('b', 200);
        var s = WikiRules.Snippet(text, "docker");
        Assert.StartsWith("…", s);
        Assert.EndsWith("…", s);
        Assert.Contains("Docker", s);
        Assert.True(s.Length <= 2 * WikiRules.SnippetRadius + "docker".Length + 2);
    }

    [Fact]
    public void Snippet_collapses_whitespace() => Assert.Equal("dòng 1 dòng 2", WikiRules.Snippet("dòng 1\n\n  dòng 2", "dòng 2"));

    [Fact]
    public void Snippet_without_match_takes_start()
    {
        var s = WikiRules.Snippet(new string('x', 500), "zzz");
        Assert.Equal(2 * WikiRules.SnippetRadius + 1, s.Length);
        Assert.EndsWith("…", s);
        Assert.Equal("", WikiRules.Snippet("", "x"));
    }

    // ---- Tuỳ chọn giao diện (vị trí mục lục) ----
    [Theory]
    [InlineData("left", true)]
    [InlineData("right", true)]
    [InlineData("Left", false)]
    [InlineData("top", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void Toc_side_accepts_only_left_or_right(string? side, bool ok) => Assert.Equal(ok, WikiTocSides.IsValid(side));

    [Fact]
    public void Toc_side_defaults_to_right() => Assert.Equal(WikiTocSides.Right, new WikiViewPref().TocSide);
}
