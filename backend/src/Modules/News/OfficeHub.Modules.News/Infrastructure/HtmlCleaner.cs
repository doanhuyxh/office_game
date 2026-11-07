using System.Text.RegularExpressions;
using Ganss.Xss;

namespace OfficeHub.Modules.News.Infrastructure;

/// <summary>
/// Lọc HTML của trình soạn thảo trước khi lưu (không tin client): chỉ giữ thẻ định dạng cơ bản; link chỉ http(s) / mailto / tel và luôn
/// mở tab mới + rel an toàn; <c>span[data-mention]</c> chỉ nhận Guid. Không cho ảnh / style / script / sự kiện — ảnh đi theo tệp đính kèm.
/// </summary>
public sealed partial class HtmlCleaner
{
    private readonly HtmlSanitizer _s;

    public HtmlCleaner()
    {
        _s = new HtmlSanitizer();
        _s.AllowedTags.Clear();
        foreach (var t in new[] { "p", "br", "strong", "b", "em", "i", "u", "s", "h2", "h3", "ul", "ol", "li", "blockquote", "a", "span", "code", "pre", "hr" })
            _s.AllowedTags.Add(t);
        _s.AllowedAttributes.Clear();
        foreach (var a in new[] { "href", "target", "rel", "data-mention" }) _s.AllowedAttributes.Add(a);
        _s.AllowedClasses.Clear();
        _s.AllowedSchemes.Clear();
        foreach (var sc in new[] { "http", "https", "mailto", "tel" }) _s.AllowedSchemes.Add(sc);
        _s.AllowedCssProperties.Clear();
        _s.PostProcessNode += (_, e) =>
        {
            if (e.Node is AngleSharp.Html.Dom.IHtmlAnchorElement a)
            {
                a.SetAttribute("target", "_blank");
                a.SetAttribute("rel", "noopener noreferrer nofollow");
            }
        };
        _s.PostProcessNode += (_, e) =>
        {
            if (e.Node is AngleSharp.Dom.IElement el && el.HasAttribute("data-mention") && !Guid.TryParse(el.GetAttribute("data-mention") ?? "", out Guid _))
                el.RemoveAttribute("data-mention");
        };
    }

    /// <summary>HTML an toàn; rỗng / chỉ khoảng trắng → "".</summary>
    public string Clean(string? html)
    {
        if (string.IsNullOrWhiteSpace(html)) return "";
        var clean = _s.Sanitize(html).Trim();
        return EmptyParagraphs().Replace(clean, "").Trim();
    }

    [GeneratedRegex(@"^(<p>\s*(<br\s*/?>)?\s*</p>\s*)+$|(<p>\s*(<br\s*/?>)?\s*</p>\s*)+$", RegexOptions.IgnoreCase)]
    private static partial Regex EmptyParagraphs();
}
