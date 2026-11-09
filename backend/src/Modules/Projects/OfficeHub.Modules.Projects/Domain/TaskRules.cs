namespace OfficeHub.Modules.Projects.Domain;

/// <summary>Nội dung công việc: mô tả Markdown + danh sách link ảnh / video. Hàm thuần, test: tests/OfficeHub.Modules.Projects.Tests/TaskRulesTests.cs.</summary>
public static class TaskRules
{
    public const int MaxDescription = 20000;
    public const int MaxMediaLinks = 20;
    public const int MaxLinkLength = 1000;

    /// <summary>Bỏ khoảng trắng, dòng rỗng, link trùng (giữ thứ tự nhập).</summary>
    public static List<string> NormalizeLinks(IEnumerable<string?>? links) =>
        (links ?? []).Select(l => l?.Trim() ?? "").Where(l => l.Length > 0).Distinct(StringComparer.Ordinal).ToList();

    /// <summary>Lỗi đầu tiên (null = hợp lệ). Chỉ nhận URL tuyệt đối http/https — chặn javascript:, data:… vì FE nhúng thẳng vào img / video / iframe.</summary>
    public static string? MediaLinksError(IReadOnlyList<string> links)
    {
        if (links.Count > MaxMediaLinks) return $"Tối đa {MaxMediaLinks} link ảnh / video";
        foreach (var l in links)
        {
            if (l.Length > MaxLinkLength) return $"Link dài quá {MaxLinkLength} ký tự";
            if (!Uri.TryCreate(l, UriKind.Absolute, out var u) || (u.Scheme != Uri.UriSchemeHttp && u.Scheme != Uri.UriSchemeHttps))
                return $"Link không hợp lệ (phải bắt đầu bằng http:// hoặc https://): {(l.Length > 60 ? l[..60] + "…" : l)}";
        }
        return null;
    }
}
