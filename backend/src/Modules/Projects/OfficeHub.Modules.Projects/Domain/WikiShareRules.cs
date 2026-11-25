using System.Text.RegularExpressions;

namespace OfficeHub.Modules.Projects.Domain;

/// <summary>Trạng thái link chia sẻ sổ tay khi mở trang công khai.</summary>
public enum WikiShareState
{
    Active,
    /// <summary>Hết hạn / thu hồi / mọi trang được chọn đã xoá (phạm vi "pages") / dự án đóng → 410 "Link đã hết hạn hoặc bị thu hồi".</summary>
    Gone,
}

/// <summary>Một trang trong cây khi dựng phần được chia sẻ.</summary>
public sealed record WikiShareNode(Guid Id, Guid? ParentId, int Position, string Title);

/// <summary>Một trang được chọn trong link phạm vi "pages"; <see cref="IncludeChildren"/> = kèm cả cây con (kể cả trang con tạo sau).</summary>
public sealed record WikiShareSelection(Guid PageId, bool IncludeChildren);

/// <summary>
/// Chia sẻ công khai trang sổ tay có thời hạn (TEST-228 — chủ dự án chốt 2026-11-25). Hàm thuần — test: tests/OfficeHub.Modules.Projects.Tests/WikiShareRulesTests.cs.
/// <list type="bullet">
/// <item>Phạm vi: toàn bộ sổ tay hoặc nhiều trang được chọn (mỗi trang tuỳ chọn kèm cây con — TEST-230), luôn hiện bản mới nhất. Chỉ quản lý dự án + HR / admin tạo, chỉ trên web (token AI → 403).</item>
/// <item>Hạn 1 / 7 / 30 ngày hoặc ngày tự chọn (hết ngày giờ văn phòng), tối đa 90 ngày. Thu hồi được, không gia hạn.</item>
/// <item>Token như <see cref="UploadLinkRules"/> (32 byte base64url, DB giữ SHA-256 hex). Mật khẩu tuỳ chọn, lưu băm; nhập sai bị giới hạn.</item>
/// </list>
/// </summary>
public static class WikiShareRules
{
    /// <summary>Hạn chọn nhanh (ngày).</summary>
    public static readonly IReadOnlyList<int> AllowedDays = [1, 7, 30];
    public const int MaxDays = 90;
    public const int MaxLabel = 200;
    public const int MaxRecipient = 200;
    public const int MinPassword = 4;
    public const int MaxPassword = 100;
    /// <summary>Số link còn hiệu lực tối đa / dự án.</summary>
    public const int MaxActivePerProject = 100;
    /// <summary>Endpoint công khai: số request / phút / IP (mỗi đường dẫn).</summary>
    public const int PublicRequestsPerMinute = 60;
    /// <summary>Cookie mở khoá sống tối đa 24 giờ (và không quá hạn link).</summary>
    public static readonly TimeSpan UnlockLifetime = TimeSpan.FromHours(24);
    /// <summary>Nhập sai mật khẩu: ≤ 5 lần / 15 phút / (link, IP) và ≤ 30 lần / 15 phút / link (chống dò từ nhiều IP).</summary>
    public const int MaxFailuresPerIp = 5;
    public const int MaxFailuresPerLink = 30;
    public static readonly TimeSpan FailureWindow = TimeSpan.FromMinutes(15);
    /// <summary>Báo người tạo link tối đa 1 lần / giờ / link.</summary>
    public static readonly TimeSpan NotifyInterval = TimeSpan.FromHours(1);
    public const int MaxViewPageSize = 100;
    /// <summary>Href thay cho link tới trang KHÔNG thuộc bản chia sẻ — FE hiện chữ thường, không lộ đường dẫn nội bộ.</summary>
    public const string NotSharedHref = "wiki-share:not-shared";

    public const string GoneMessage = "Link đã hết hạn hoặc bị thu hồi";
    public const string ManagerOnly = "Chỉ quản lý dự án hoặc HR được chia sẻ sổ tay ra ngoài";
    public const string NoAgent = "Trợ lý AI không tạo / xem / thu hồi link chia sẻ sổ tay — làm trên web";

    /// <summary>Quyền tạo / xem danh sách / thu hồi link: token AI → 403, không phải quản lý dự án / HR → 403. null = được.</summary>
    public static WikiDenial? ManageDenial(bool canManage, bool byToken)
    {
        if (byToken) return new(403, NoAgent);
        return canManage ? null : new(403, ManagerOnly);
    }

    /// <summary>Xem nhật ký mở link: người tạo link, quản lý dự án, HR (không qua token AI).</summary>
    public static bool CanSeeViews(bool canManage, bool isCreator, bool byToken) => !byToken && (canManage || isCreator);

    /// <summary>
    /// Thời điểm hết hạn: <paramref name="days"/> ∈ {1, 7, 30} → now + n ngày; hoặc <paramref name="expiresOn"/> = hết ngày đó (giờ văn phòng,
    /// <paramref name="endOfDay"/> chuyển ngày → thời điểm UTC đầu ngày hôm sau). Không chọn gì → 7 ngày. Lỗi → (null, câu lỗi).
    /// </summary>
    public static (DateTimeOffset? At, string? Error) ExpiresAt(int? days, DateOnly? expiresOn, DateTimeOffset now, Func<DateOnly, DateTimeOffset> endOfDay)
    {
        if (days is not null && expiresOn is not null) return (null, "Chọn số ngày hoặc ngày hết hạn, không chọn cả hai");
        if (expiresOn is { } d)
        {
            var at = endOfDay(d);
            if (at <= now) return (null, "Ngày hết hạn phải sau hôm nay");
            if (at > now.AddDays(MaxDays)) return (null, $"Hạn tối đa {MaxDays} ngày");
            return (at, null);
        }
        var n = days ?? 7;
        return AllowedDays.Contains(n) ? (now.AddDays(n), null) : (null, "Hạn chỉ chọn 1 ngày, 7 ngày, 30 ngày hoặc một ngày cụ thể");
    }

    /// <summary>Mật khẩu tuỳ chọn: trống → null (không đặt); có thì 4–100 ký tự.</summary>
    public static string? PasswordError(string? password) =>
        string.IsNullOrEmpty(password) ? null
        : password.Length < MinPassword ? $"Mật khẩu tối thiểu {MinPassword} ký tự"
        : password.Length > MaxPassword ? $"Mật khẩu tối đa {MaxPassword} ký tự" : null;

    public static WikiShareState State(DateTimeOffset expiresAt, DateTimeOffset? revokedAt, DateTimeOffset now, bool projectActive, bool hasContent) =>
        revokedAt is null && expiresAt > now && projectActive && hasContent ? WikiShareState.Active : WikiShareState.Gone;

    /// <summary>Link còn hiệu lực ở phía quản lý (danh sách): chưa thu hồi, chưa hết hạn.</summary>
    public static bool IsActive(DateTimeOffset expiresAt, DateTimeOffset? revokedAt, DateTimeOffset now) => revokedAt is null && expiresAt > now;

    /// <summary>Cookie mở khoá hết hạn lúc: min(now + 24 giờ, hạn link).</summary>
    public static DateTimeOffset UnlockExpires(DateTimeOffset now, DateTimeOffset linkExpiresAt) =>
        now + UnlockLifetime < linkExpiresAt ? now + UnlockLifetime : linkExpiresAt;

    /// <summary>Đã nhập sai quá số lần trong cửa sổ → chặn (429) trước khi kiểm mật khẩu.</summary>
    public static bool UnlockBlocked(int failuresFromIp, int failuresOnLink) => failuresFromIp >= MaxFailuresPerIp || failuresOnLink >= MaxFailuresPerLink;

    /// <summary>
    /// Báo người tạo khi mở: lần mở đầu tiên của link, hoặc thiết bị mới (cặp IP + trình duyệt chưa gặp với link này); không quá 1 lần / giờ / link.
    /// </summary>
    public static bool ShouldNotify(bool firstView, bool newDevice, DateTimeOffset? lastNotifiedAt, DateTimeOffset now) =>
        (firstView || newDevice) && (lastNotifiedAt is null || now - lastNotifiedAt.Value >= NotifyInterval);

    /// <summary>Phạm vi link: toàn bộ sổ tay (kể cả trang tạo sau) hoặc danh sách trang được chọn (TEST-230).</summary>
    public const string ScopeAll = "all";
    public const string ScopePages = "pages";
    /// <summary>Số trang được chọn tối đa / link.</summary>
    public const int MaxSelectedPages = 200;

    /// <summary>
    /// Chuẩn hoá phạm vi + danh sách trang từ yêu cầu tạo link. <paramref name="scope"/> trống → "pages" (nếu có trang) — cách viết tắt cũ
    /// <paramref name="pageId"/> + <paramref name="includeChildren"/> = một trang. Lỗi → (Error = (field, câu lỗi)).
    /// Chỉ kiểm hình thức (1–200 trang, không trùng); trang thuộc dự án / chưa xoá do endpoint kiểm.
    /// </summary>
    public static (string Scope, List<WikiShareSelection> Pages, (string Field, string Message)? Error) Selection(string? scope,
        IReadOnlyList<WikiShareSelection>? pages, Guid? pageId, bool includeChildren)
    {
        var s = string.IsNullOrWhiteSpace(scope) ? ScopePages : scope.Trim().ToLowerInvariant();
        if (s == ScopeAll) return (ScopeAll, [], null);
        if (s != ScopePages) return (s, [], ("scope", "Phạm vi chỉ là toàn bộ sổ tay (all) hoặc chọn trang (pages)"));
        var list = pages is { Count: > 0 } ? pages.ToList() : pageId is { } one ? [new WikiShareSelection(one, includeChildren)] : [];
        if (list.Count == 0) return (s, [], ("pages", "Chọn ít nhất một trang để chia sẻ"));
        if (list.Count > MaxSelectedPages) return (s, [], ("pages", $"Chọn tối đa {MaxSelectedPages} trang"));
        if (list.Select(x => x.PageId).Distinct().Count() != list.Count) return (s, [], ("pages", "Danh sách trang bị trùng"));
        return (s, list, null);
    }

    /// <summary>
    /// Các trang được chia sẻ theo phạm vi, thứ tự cây như sổ tay (Position rồi tên). <paramref name="pages"/> = trang chưa xoá của dự án;
    /// trang có tổ tiên đã xoá (không có trong danh sách) cũng bị bỏ. Phạm vi "all" → mọi trang. Phạm vi "pages" → trang được chọn
    /// + cây con (kể cả trang tạo sau) của trang có IncludeChildren. ParentId của kết quả = tổ tiên gần nhất CÓ trong bản chia sẻ, không có → null (đứng ở gốc).
    /// </summary>
    public static List<WikiShareNode> SharedPages(string scope, IReadOnlyCollection<WikiShareSelection> selected, IReadOnlyCollection<WikiShareNode> pages)
    {
        var children = pages.ToLookup(p => p.ParentId);
        var all = scope == ScopeAll;
        var pick = selected.GroupBy(x => x.PageId).ToDictionary(g => g.Key, g => g.Any(x => x.IncludeChildren));
        var result = new List<WikiShareNode>();
        var seen = new HashSet<Guid>();
        // Duyệt cây từ gốc (chỉ trang còn sống mới tới được); sharedAncestor = tổ tiên gần nhất đã vào bản chia sẻ; underIncluded = nằm dưới trang "kèm con".
        void Walk(Guid? parent, Guid? sharedAncestor, bool underIncluded, int depth)
        {
            if (depth > WikiRules.MaxDepth + 1) return;
            foreach (var c in children[parent].OrderBy(x => x.Position).ThenBy(x => x.Title, StringComparer.OrdinalIgnoreCase))
            {
                if (!seen.Add(c.Id)) continue;
                var picked = pick.TryGetValue(c.Id, out var inc);
                var shared = all || underIncluded || picked;
                if (shared) result.Add(c with { ParentId = sharedAncestor });
                Walk(c.Id, shared ? c.Id : sharedAncestor, underIncluded || (picked && inc), depth + 1);
            }
        }
        Walk(null, null, false, 1);
        return result;
    }

    /// <summary>Link phạm vi "pages" mà không còn trang nào (mọi trang chọn đã xoá) → hết hiệu lực. Phạm vi "all" sổ tay trống vẫn hiệu lực (cây rỗng).</summary>
    public static bool HasContent(string scope, int sharedCount) => scope == ScopeAll || sharedCount > 0;

    // Link Markdown "[chữ](url)" — url không chứa khoảng trắng / ngoặc đóng; có thể kèm "title".
    private static readonly Regex MdLink = new(@"\]\((?<url>[^)\s]+)(?<rest>(?:\s+""[^""]*"")?)\)", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly Regex PageParam = new(@"[?&]page=(?<id>[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    /// <summary>Url trỏ tới trang sổ tay (dạng web <c>/projects/{id}?tab=wiki&amp;page={pageId}</c>, tuyệt đối hoặc tương đối) → Id trang; khác → null.</summary>
    public static Guid? WikiPageIdOf(string url)
    {
        if (!url.Contains("/projects/", StringComparison.OrdinalIgnoreCase) && !url.Contains("tab=wiki", StringComparison.OrdinalIgnoreCase)) return null;
        var m = PageParam.Match(url);
        return m.Success && Guid.TryParse(m.Groups["id"].Value, out var id) ? id : null;
    }

    /// <summary>
    /// Đổi link Markdown giữa các trang: trang trong bản chia sẻ → <paramref name="publicHref"/>(pageId); trang ngoài (dự án khác, ngoài cây, đã xoá)
    /// → <see cref="NotSharedHref"/> (không lộ id nội bộ). Link khác giữ nguyên.
    /// </summary>
    public static string RewriteLinks(string content, IReadOnlySet<Guid> shared, Func<Guid, string> publicHref)
    {
        if (string.IsNullOrEmpty(content) || !content.Contains("](", StringComparison.Ordinal)) return content;
        return MdLink.Replace(content, m =>
        {
            if (WikiPageIdOf(m.Groups["url"].Value) is not { } id) return m.Value;
            var href = shared.Contains(id) ? publicHref(id) : NotSharedHref;
            return $"]({href}{m.Groups["rest"].Value})";
        });
    }

    /// <summary>Ô chữ một dòng tuỳ chọn (nhãn, người nhận): bỏ khoảng trắng / xuống dòng, trống → null.</summary>
    public static string? OneLine(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        return string.Join(' ', s.Split(['\r', '\n', '\t'], StringSplitOptions.RemoveEmptyEntries)).Trim();
    }
}
