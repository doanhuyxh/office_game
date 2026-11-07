using OfficeHub.Modules.News.Domain;
using OfficeHub.Modules.News.Infrastructure;

namespace OfficeHub.Modules.News.Tests;

public class NewsRulesTests
{
    private static readonly Guid Author = Guid.NewGuid(), Viewer = Guid.NewGuid(), Dept = Guid.NewGuid(), Parent = Guid.NewGuid(), Other = Guid.NewGuid();

    [Fact]
    public void Author_always_sees_own_post_even_private() =>
        Assert.True(NewsRules.CanView(PostAudience.Private, Author, Author, new HashSet<Guid>(), []));

    [Fact]
    public void Private_hidden_from_others() =>
        Assert.False(NewsRules.CanView(PostAudience.Private, Author, Viewer, new HashSet<Guid> { Dept }, []));

    [Fact]
    public void Company_visible_to_everyone() =>
        Assert.True(NewsRules.CanView(PostAudience.Company, Author, Viewer, new HashSet<Guid>(), []));

    [Fact]
    public void Department_audience_matches_viewer_chain_including_parent()
    {
        var targets = new[] { (TargetKind.Department, Parent) };
        // Viewer ở phòng con: chuỗi gồm cả phòng cha → thấy bài gửi cho phòng cha
        var chain = NewsRules.DepartmentChain(Dept, new Dictionary<Guid, Guid?> { [Dept] = Parent, [Parent] = null });
        Assert.True(NewsRules.CanView(PostAudience.Departments, Author, Viewer, chain, targets));
        Assert.False(NewsRules.CanView(PostAudience.Departments, Author, Viewer, new HashSet<Guid> { Other }, targets));
        Assert.False(NewsRules.CanView(PostAudience.Departments, Author, Viewer, new HashSet<Guid>(), targets)); // admin chưa có phòng
    }

    [Fact]
    public void Custom_audience_only_listed_users()
    {
        var targets = new[] { (TargetKind.User, Viewer) };
        Assert.True(NewsRules.CanView(PostAudience.Custom, Author, Viewer, new HashSet<Guid>(), targets));
        Assert.False(NewsRules.CanView(PostAudience.Custom, Author, Other, new HashSet<Guid>(), targets));
        // Id phòng ban trùng id người không được coi là người
        Assert.False(NewsRules.CanView(PostAudience.Custom, Author, Other, new HashSet<Guid>(), new[] { (TargetKind.Department, Other) }));
    }

    [Fact]
    public void Department_chain_survives_cycles()
    {
        var a = Guid.NewGuid(); var b = Guid.NewGuid();
        var chain = NewsRules.DepartmentChain(a, new Dictionary<Guid, Guid?> { [a] = b, [b] = a });
        Assert.Equal(2, chain.Count);
    }

    [Fact]
    public void Plain_text_strips_tags_and_keeps_paragraphs()
    {
        var text = NewsRules.ToPlainText("<p>Xin&nbsp;chào <strong>cả nhà</strong> &amp; bạn</p><p>Dòng 2</p><ul><li>a</li><li>b</li></ul>");
        Assert.Equal("Xin chào cả nhà & bạn\nDòng 2\na\nb", text);
    }

    [Fact]
    public void Preview_truncates_with_ellipsis()
    {
        var p = NewsRules.Preview(new string('a', 400), 300);
        Assert.Equal(300, p.Length);
        Assert.EndsWith("…", p);
        Assert.Equal("a b", NewsRules.Preview("a\nb"));
    }

    [Fact]
    public void Mentions_from_html_and_comment_tokens_ignore_invalid_ids()
    {
        var id = Guid.NewGuid();
        Assert.Equal([id], NewsRules.ExtractMentions($"<p><span data-mention=\"{id}\">@A</span> <span data-mention=\"{id}\">@A</span></p>"));
        Assert.Equal([id], NewsRules.ExtractMentions($"Chào @[Nguyễn Văn A]({id}) nhé"));
        Assert.Empty(NewsRules.ExtractMentions("@[A](not-a-guid) <span data-mention=\"xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx\">"));
        Assert.Empty(NewsRules.ExtractMentions(null));
    }

    [Fact]
    public void Post_needs_content_or_media_and_valid_targets()
    {
        Assert.Contains(NewsRules.ValidatePost("", 0, 0, PostAudience.Company, 0), e => e.Field == "contentHtml");
        Assert.Empty(NewsRules.ValidatePost("", 0, 1, PostAudience.Company, 0));
        Assert.Contains(NewsRules.ValidatePost("x", 1, 0, PostAudience.Departments, 0), e => e.Field == "targets");
        Assert.Contains(NewsRules.ValidatePost("x", 1, 0, PostAudience.Custom, 0), e => e.Field == "targets");
        Assert.Contains(NewsRules.ValidatePost(new string('x', NewsRules.MaxPlainLength + 1), 10, 0, PostAudience.Company, 0), e => e.Field == "contentHtml");
        Assert.Contains(NewsRules.ValidatePost("x", 1, NewsRules.MaxMedia + 1, PostAudience.Company, 0), e => e.Field == "uploadIds");
    }

    [Fact]
    public void Comment_needs_text_or_image() 
    {
        Assert.NotEmpty(NewsRules.ValidateComment(null, false));
        Assert.Empty(NewsRules.ValidateComment(null, true));
        Assert.NotEmpty(NewsRules.ValidateComment(new string('x', NewsRules.MaxCommentLength + 1), false));
    }

    [Theory]
    [InlineData("a.jpg", "image/jpeg", 10L * 1024 * 1024, false, 0)]
    [InlineData("a.jpg", "image/jpeg", 10L * 1024 * 1024 + 1, false, 1)]
    [InlineData("v.mp4", "video/mp4", 200L * 1024 * 1024, false, 0)]
    [InlineData("v.mp4", "video/mp4", 200L * 1024 * 1024 + 1, false, 1)]
    [InlineData("d.pdf", "application/pdf", 25L * 1024 * 1024 + 1, false, 1)]
    [InlineData("x.exe", "application/octet-stream", 100, false, 1)]
    [InlineData("x.html", "text/html", 100, false, 1)]
    [InlineData("x.svg", "image/svg+xml", 100, false, 1)]
    [InlineData("v.mp4", "video/mp4", 100, true, 1)]   // bình luận chỉ nhận ảnh
    [InlineData("a.png", "image/png", 0, false, 1)]
    public void Upload_rules(string name, string type, long size, bool imageOnly, int errors) =>
        Assert.Equal(errors, NewsRules.ValidateUpload(name, type, size, imageOnly).Count);

    [Fact]
    public void File_key_lives_under_feed_folder_with_safe_name()
    {
        var key = NewsRules.FileKey(new DateTimeOffset(2026, 11, 7, 0, 0, 0, TimeSpan.Zero), Guid.Parse("00000000-0000-0000-0000-000000000001"), "Báo cáo Quý 3 (final).pdf");
        Assert.Equal("feed/2026/11/00000000000000000000000000000001/Bao-cao-Quy-3-final.pdf", key);
        Assert.StartsWith("feed/", key);
    }

    [Fact]
    public void Start_of_day_uses_office_timezone()
    {
        var tz = TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh");
        // 2026-11-07 20:00 UTC = 03:00 ngày 08/11 giờ VN → đầu ngày VN = 2026-11-07 17:00 UTC
        var start = NewsRules.StartOfDay(new DateTimeOffset(2026, 11, 7, 20, 0, 0, TimeSpan.Zero), tz);
        Assert.Equal(new DateTimeOffset(2026, 11, 7, 17, 0, 0, TimeSpan.Zero), start);
    }

    [Theory]
    [InlineData("image/jpeg", MediaKind.Image)]
    [InlineData("image/svg+xml", MediaKind.File)]
    [InlineData("video/mp4", MediaKind.Video)]
    [InlineData("video/x-matroska", MediaKind.File)]
    [InlineData("application/pdf", MediaKind.File)]
    public void Kind_by_content_type(string type, MediaKind kind) => Assert.Equal(kind, NewsRules.KindOf(type));
}

public class HtmlCleanerTests
{
    private static readonly HtmlCleaner Cleaner = new();

    [Theory]
    [InlineData("<p>hi</p><script>alert(1)</script>", "script")]
    [InlineData("<img src=x onerror=alert(1)>", "onerror")]
    [InlineData("<p onclick=\"x()\">a</p>", "onclick")]
    [InlineData("<a href=\"javascript:alert(1)\">x</a>", "javascript")]
    [InlineData("<iframe src=\"https://evil\"></iframe>", "iframe")]
    [InlineData("<p style=\"background:url(x)\">a</p>", "style")]
    [InlineData("<svg onload=alert(1)></svg>", "svg")]
    [InlineData("<a href=\"data:text/html,<script>alert(1)</script>\">x</a>", "data:")]
    public void Strips_dangerous_markup(string html, string forbidden) =>
        Assert.DoesNotContain(forbidden, Cleaner.Clean(html), StringComparison.OrdinalIgnoreCase);

    [Fact]
    public void Keeps_formatting_and_hardens_links()
    {
        var html = Cleaner.Clean("<h2>Tiêu đề</h2><p><strong>đậm</strong> <em>nghiêng</em> <u>gạch</u> <a href=\"https://a.vn\">link</a></p><ul><li>1</li></ul>");
        Assert.Contains("<h2>Tiêu đề</h2>", html);
        Assert.Contains("<strong>đậm</strong>", html);
        Assert.Contains("<u>gạch</u>", html);
        Assert.Contains("href=\"https://a.vn\"", html);
        Assert.Contains("target=\"_blank\"", html);
        Assert.Contains("noopener", html);
        Assert.Contains("<li>1</li>", html);
    }

    [Fact]
    public void Mention_attribute_only_accepts_guid()
    {
        var id = Guid.NewGuid();
        Assert.Contains($"data-mention=\"{id}\"", Cleaner.Clean($"<span data-mention=\"{id}\">@A</span>"));
        Assert.DoesNotContain("data-mention", Cleaner.Clean("<span data-mention=\"\\\"><b onmouseover=x>\">@A</span>"));
    }

    [Fact]
    public void Empty_or_blank_paragraphs_become_empty() 
    {
        Assert.Equal("", Cleaner.Clean(null));
        Assert.Equal("", Cleaner.Clean("   "));
        Assert.Equal("", Cleaner.Clean("<p></p>"));
        Assert.Equal("", Cleaner.Clean("<p><br></p>"));
    }
}
