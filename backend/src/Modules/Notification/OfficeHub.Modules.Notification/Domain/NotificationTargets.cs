using System.Text.Json;
using System.Text.RegularExpressions;
using OfficeHub.Modules.Notification.Contracts;

namespace OfficeHub.Modules.Notification.Domain;

/// <summary>TEST-237: lưu / đọc tham số target (jsonb) và tách link cũ thành target (backfill). Link sinh từ target: <see cref="NotificationLinkBuilder"/>.</summary>
internal static partial class NotificationTargets
{
    /// <summary>Params → JSON lưu cột TargetParams (jsonb); null khi không có.</summary>
    public static string? ParamsJson(NotificationTarget? t) => t?.Params is { Count: > 0 } p ? JsonSerializer.Serialize(p) : null;

    public static IReadOnlyDictionary<string, string>? ParseParams(string? json) =>
        string.IsNullOrWhiteSpace(json) ? null : JsonSerializer.Deserialize<Dictionary<string, string>>(json);

    /// <summary>Target đã lưu của một dòng thông báo (dựng URL nút email — TEST-238).</summary>
    public static NotificationTarget ToTarget(Notification n) => new(n.TargetType, n.TargetId, ParseParams(n.TargetParams));

    /// <summary>
    /// Backfill thông báo cũ (chỉ có link): tách link theo các mẫu đã biết → target có id; không khớp mẫu nào → <c>page</c> + key lấy từ path
    /// (+ tham số truy vấn). Link null → trang chủ (key rỗng). Luôn trả target (không dòng nào còn TargetType rỗng).
    /// </summary>
    public static NotificationTarget FromLink(string? link)
    {
        if (string.IsNullOrWhiteSpace(link)) return NotificationTarget.Page("");
        var q = link.IndexOf('?');
        var path = (q < 0 ? link : link[..q]).TrimEnd('/');
        var query = new List<(string Name, string Value)>();
        if (q >= 0)
            foreach (var part in link[(q + 1)..].Split('&', StringSplitOptions.RemoveEmptyEntries))
            {
                var eq = part.IndexOf('=');
                var (n, v) = eq < 0 ? (part, "") : (part[..eq], part[(eq + 1)..]);
                query.Add((Uri.UnescapeDataString(n), Uri.UnescapeDataString(v)));
            }
        string? Q(string n) => query.FirstOrDefault(x => x.Name == n).Value;
        static Guid? G(string? s) => Guid.TryParse(s, out var g) ? g : null;

        if (ProjectPath().Match(path) is { Success: true } pm && G(pm.Groups[1].Value) is { } projectId)
        {
            if (G(Q("task")) is { } task) return NotificationTarget.ProjectTask(projectId, task, G(Q("comment")));
            if (Q("tab") == "wiki" && G(Q("page")) is { } page)
                return new(NotificationTargetTypes.Project, projectId, new Dictionary<string, string> { ["tab"] = "wiki", ["page"] = page.ToString() });
            return NotificationTarget.Project(projectId, string.IsNullOrEmpty(Q("tab")) ? null : Q("tab"));
        }
        if (path == "/chat" && G(Q("c")) is { } conv) return NotificationTarget.ChatConversation(conv);
        if (NewsPath().Match(path) is { Success: true } nm && G(nm.Groups[1].Value) is { } post) return NotificationTarget.NewsPost(post, G(Q("comment")));
        if (path == "/documents" && G(Q("asset")) is { } asset) return NotificationTarget.DocumentAsset(asset);
        if (path == "/sales" && G(Q("customer")) is { } customer) return NotificationTarget.SalesCustomer(customer);

        var key = path.TrimStart('/').ToLowerInvariant();
        return NotificationTarget.Page(NotificationLinkBuilder.IsPageKey(key) ? key : "", [.. query]);
    }

    [GeneratedRegex("^/projects/([0-9a-fA-F-]{36})$")]
    private static partial Regex ProjectPath();

    [GeneratedRegex("^/news/([0-9a-fA-F-]{36})$")]
    private static partial Regex NewsPath();
}
