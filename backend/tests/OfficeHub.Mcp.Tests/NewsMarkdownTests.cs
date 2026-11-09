using OfficeHub.Mcp.Tools;

namespace OfficeHub.Mcp.Tests;

/// <summary>create_news_post: Markdown tối giản → HTML trong danh sách thẻ Bảng tin cho phép (Api còn lọc lại bằng HtmlCleaner).</summary>
public class NewsMarkdownTests
{
    [Fact]
    public void Paragraphs_and_line_breaks() =>
        Assert.Equal("<p>Dòng 1<br>Dòng 2</p><p>Đoạn 2</p>", NewsTools.MarkdownToHtml("Dòng 1\nDòng 2\n\n\nĐoạn 2"));

    [Fact]
    public void Headings_lists_quote_rule()
    {
        var html = NewsTools.MarkdownToHtml("# Thông báo\n### Chi tiết\n- a\n- b\n1. một\n2. hai\n> trích\n---\nhết");
        Assert.Equal("<h2>Thông báo</h2><h3>Chi tiết</h3><ul><li>a</li><li>b</li></ul><ol><li>một</li><li>hai</li></ol>" +
                     "<blockquote><p>trích</p></blockquote><hr><p>hết</p>", html);
    }

    [Fact]
    public void Inline_formatting_and_links() =>
        Assert.Equal("<p><strong>Nghỉ lễ</strong> từ <em>30/4</em>, xem <a href=\"https://a.vn/x?y=1&amp;z=2\">lịch</a> và <code>NV01</code></p>",
            NewsTools.MarkdownToHtml("**Nghỉ lễ** từ *30/4*, xem [lịch](https://a.vn/x?y=1&z=2) và `NV01`"));

    [Theory]
    [InlineData("<script>alert(1)</script>", "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>")]
    [InlineData("[x](javascript:alert(1))", "<p>[x](javascript:alert(1))</p>")]
    [InlineData("2 * 3 * 4", "<p>2 * 3 * 4</p>")]
    public void Escapes_html_and_unsafe_links(string md, string expected) => Assert.Equal(expected, NewsTools.MarkdownToHtml(md));

    [Fact]
    public void Blank_content_is_empty() => Assert.Equal("", NewsTools.MarkdownToHtml("  \n \n"));
}
