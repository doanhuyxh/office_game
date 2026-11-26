using System.Text.RegularExpressions;

namespace OfficeHub.Modules.Notification.Contracts;

/// <summary>
/// TEST-237 (G1): <see cref="NotificationTarget"/> → đường dẫn web — MỘT chỗ duy nhất cho chuông (cột link), email, push, webhook.
/// Đường dẫn giữ đúng như trước khi có target (client cũ chỉ đọc link vẫn chạy). Màn hình web chưa mở được theo id (phê duyệt, lịch họp,
/// hợp đồng, phiếu lương, tài sản, đề nghị chi…) vẫn trỏ trang danh sách; app mobile / agent dùng target có id.
/// </summary>
public static partial class NotificationLinkBuilder
{
    /// <summary>Đường dẫn web của target; null = loại chưa biết (NotificationCatalogTests bắt buộc mọi loại phải có).</summary>
    public static string? Build(NotificationTarget target)
    {
        var id = target.Id;
        string? P(string n) => target.Param(n);
        return target.Type switch
        {
            NotificationTargetTypes.ProjectTask when P("projectId") is { } p =>
                $"/projects/{p}?task={id}" + (P("commentId") is { } c ? $"&comment={c}" : ""),
            NotificationTargetTypes.Project => $"/projects/{id}" + (P("tab") is { } tab ? $"?tab={Uri.EscapeDataString(tab)}" + (P("page") is { } pg ? $"&page={pg}" : "") : ""),
            NotificationTargetTypes.WikiShare when P("projectId") is { } p =>
                $"/projects/{p}?tab=wiki" + (P("pageId") is { } pg ? $"&page={pg}" : ""),
            NotificationTargetTypes.ApprovalRequest or NotificationTargetTypes.ApprovalDelegation => "/approvals",
            NotificationTargetTypes.ChatConversation => $"/chat?c={id}",
            NotificationTargetTypes.NewsPost => $"/news/{id}" + (P("commentId") is { } c ? $"?comment={c}" : ""),
            NotificationTargetTypes.MeetingBooking => "/meetings",
            NotificationTargetTypes.LaborContract => "/contracts",
            NotificationTargetTypes.Payslip => "/payslips",
            NotificationTargetTypes.AssetDevice or NotificationTargetTypes.AssetService or NotificationTargetTypes.AssetReview
                or NotificationTargetTypes.AssetHandover => "/assets",
            NotificationTargetTypes.Employee => P("view") == "assets" ? "/assets" : "/employees",
            NotificationTargetTypes.SocialAccount => P("view") == "posts" ? "/social/facebook" : "/assets?tab=social&platform=facebook",
            NotificationTargetTypes.SocialPost => "/social/facebook",
            NotificationTargetTypes.DocumentAsset => $"/documents?asset={id}",
            NotificationTargetTypes.ExpenseRequest => "/finance",
            NotificationTargetTypes.SalesCustomer => $"/sales?customer={id}",
            NotificationTargetTypes.SalesContract when P("customerId") is { } cu => $"/sales?customer={cu}",
            NotificationTargetTypes.SalesReceivable => "/sales?tab=receivables",
            NotificationTargetTypes.ProfileChangeRequest => P("view") == "profile" ? "/profile" : "/employees",
            NotificationTargetTypes.Page => PageLink(target),
            _ => null,
        };
    }

    private static string? PageLink(NotificationTarget t)
    {
        if (t.Param(NotificationTarget.KeyParam) is not { } key || !PageKey().IsMatch(key)) return null;
        var query = (t.Params ?? new Dictionary<string, string>()).Where(kv => kv.Key != NotificationTarget.KeyParam)
            .Select(kv => $"{Uri.EscapeDataString(kv.Key)}={Uri.EscapeDataString(kv.Value)}").ToList();
        return "/" + key + (query.Count > 0 ? "?" + string.Join("&", query) : "");
    }

    /// <summary>Khoá trang: chữ thường / số / '-' / '/', không bắt đầu bằng '/'; rỗng = trang chủ.</summary>
    [GeneratedRegex("^([a-z0-9-]+(/[a-z0-9-]+)*)?$")]
    private static partial Regex PageKey();

    public static bool IsPageKey(string key) => PageKey().IsMatch(key);

}
