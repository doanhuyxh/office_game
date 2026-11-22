using System.Text.Json;

namespace OfficeHub.Modules.Assets.Domain;

/// <summary>Một quyền của token (từ <c>GET /me/permissions</c>): <c>granted</c> / <c>declined</c> / <c>expired</c>.</summary>
public sealed record SocialTokenPermission(string Permission, string Status);

/// <summary>Quyền OfficeHub cần + hậu quả khi thiếu (hiện cho HR).</summary>
public sealed record SocialRequiredPermission(string Permission, string Impact);

/// <summary>Quy tắc thuần (có test) cho tài khoản mạng xã hội + đăng bài.</summary>
public static class SocialRules
{
    // ---------------- Đường dẫn theo nền tảng (TEST-207) ----------------

    /// <summary>Tiền tố API của Facebook trong nhóm <c>/api/assets</c>: <c>/social/facebook/…</c> (Zalo OA / TikTok sau này: <c>/social/zalo-oa</c>, <c>/social/tiktok</c>).</summary>
    public const string FacebookApiPrefix = "/social/facebook";

    /// <summary>Trang đăng bài Facebook trên web — link trong chuông / email (link cũ <c>/social</c> FE tự chuyển hướng tới đây).</summary>
    public const string FacebookPostsLink = "/social/facebook";

    /// <summary>Sub-tab Facebook BM ở Tài sản → MXH — link cảnh báo token hỏng cho HR / Quản trị viên.</summary>
    public const string FacebookAccountsLink = "/assets?tab=social&platform=facebook";

    // ---------------- Bàn giao BM ----------------

    /// <summary>Lỗi nếu không bàn giao được; null = được.</summary>
    public static string? CannotAssign(SocialAccountStatus status, Guid? currentHolder, bool employeeActive)
    {
        if (status == SocialAccountStatus.Disabled) return "Tài khoản đã ngừng dùng";
        if (currentHolder is not null) return "Tài khoản đang giao cho người khác, hãy thu hồi trước";
        if (!employeeActive) return "Nhân viên đã nghỉ việc hoặc không tồn tại";
        return null;
    }

    /// <summary>Lỗi nếu không ngừng dùng được; null = được.</summary>
    public static string? CannotDisable(Guid? currentHolder) => currentHolder is null ? null : "Hãy thu hồi tài khoản trước khi ngừng dùng";

    /// <summary>Người được đăng lên trang thuộc BM: HR, hoặc người đang giữ BM (BM đang dùng).</summary>
    public static bool CanPublish(bool isHr, Guid? viewerEmployeeId, SocialAccountStatus status, Guid? holder) =>
        status == SocialAccountStatus.Active && (isHr || (viewerEmployeeId is { } e && holder == e));

    // ---------------- Nội dung bài ----------------

    /// <summary>Giới hạn nội dung của Facebook (63 206 ký tự).</summary>
    public const int MaxMessageLength = 63_206;
    public const int MaxImages = 10;
    public const int MaxPages = 50;
    public const long MaxImageBytes = 10L * 1024 * 1024;
    public const long MaxVideoBytes = 1024L * 1024 * 1024;
    /// <summary>Hẹn giờ: ít nhất 2 phút sau hiện tại, tối đa 180 ngày.</summary>
    public static readonly TimeSpan MinScheduleLead = TimeSpan.FromMinutes(2);
    public static readonly TimeSpan MaxScheduleLead = TimeSpan.FromDays(180);
    public static readonly TimeSpan UploadUrlTtl = TimeSpan.FromMinutes(30);
    /// <summary>Link S3 cho Facebook tự tải ảnh / video (phải đủ cho video lớn).</summary>
    public static readonly TimeSpan FetchUrlTtl = TimeSpan.FromHours(2);

    private static readonly Dictionary<string, string> ImageTypes = new()
    {
        [".jpg"] = "image/jpeg", [".jpeg"] = "image/jpeg", [".png"] = "image/png", [".gif"] = "image/gif", [".webp"] = "image/webp",
    };
    private static readonly Dictionary<string, string> VideoTypes = new() { [".mp4"] = "video/mp4", [".mov"] = "video/quicktime" };

    /// <summary>Phân loại theo đuôi tệp (ảnh: jpg / png / gif / webp; video: mp4 / mov) + kiểm tra cỡ. Trả (loại, content-type, lỗi).</summary>
    public static (SocialMediaKind Kind, string ContentType, string? Error) ClassifyMedia(string fileName, long size)
    {
        var ext = Path.GetExtension(fileName).ToLowerInvariant();
        if (ImageTypes.TryGetValue(ext, out var img))
            return (SocialMediaKind.Image, img, size <= 0 ? "Tệp rỗng" : size > MaxImageBytes ? "Ảnh tối đa 10 MB" : null);
        if (VideoTypes.TryGetValue(ext, out var vid))
            return (SocialMediaKind.Video, vid, size <= 0 ? "Tệp rỗng" : size > MaxVideoBytes ? "Video tối đa 1 GB" : null);
        return (SocialMediaKind.Image, "application/octet-stream", "Chỉ nhận ảnh JPG, PNG, GIF, WEBP hoặc video MP4, MOV");
    }

    /// <summary>Kiểm tra bài: có chữ / link / tệp; ảnh ≤ 10 hoặc đúng 1 video (không trộn); link http(s); giờ hẹn hợp lệ.</summary>
    public static List<(string Field, string Message)> ValidatePost(string? message, string? link, int pages, IReadOnlyList<SocialMediaKind> media,
        DateTimeOffset? scheduledAt, DateTimeOffset now)
    {
        var e = new List<(string, string)>();
        var msg = message?.Trim() ?? "";
        if (msg.Length == 0 && string.IsNullOrWhiteSpace(link) && media.Count == 0) e.Add(("message", "Nhập nội dung, link hoặc chọn ảnh / video"));
        if (msg.Length > MaxMessageLength) e.Add(("message", $"Nội dung tối đa {MaxMessageLength:N0} ký tự"));
        if (!string.IsNullOrWhiteSpace(link))
        {
            if (link.Trim().Length > 2000 || !Uri.TryCreate(link.Trim(), UriKind.Absolute, out var u) || (u.Scheme != "http" && u.Scheme != "https"))
                e.Add(("link", "Link phải bắt đầu bằng http:// hoặc https://"));
            else if (media.Count > 0) e.Add(("link", "Bài có ảnh / video không gắn được link xem trước — dán link vào nội dung"));
        }
        if (pages == 0) e.Add(("pageIds", "Chọn ít nhất một trang"));
        else if (pages > MaxPages) e.Add(("pageIds", $"Tối đa {MaxPages} trang mỗi bài"));
        var videos = media.Count(m => m == SocialMediaKind.Video);
        if (videos > 0 && media.Count > 1) e.Add(("mediaIds", "Mỗi bài chỉ một video và không kèm ảnh"));
        else if (media.Count > MaxImages) e.Add(("mediaIds", $"Tối đa {MaxImages} ảnh mỗi bài"));
        if (scheduledAt is { } at)
        {
            if (at < now + MinScheduleLead) e.Add(("scheduledAt", "Giờ hẹn phải sau hiện tại ít nhất 2 phút"));
            else if (at > now + MaxScheduleLead) e.Add(("scheduledAt", "Chỉ hẹn trước tối đa 180 ngày"));
        }
        return e;
    }

    /// <summary>Trạng thái tổng của bài từ các đích.</summary>
    public static SocialPostStatus PostStatus(IReadOnlyCollection<SocialTargetStatus> targets)
    {
        if (targets.Count == 0) return SocialPostStatus.Cancelled;
        if (targets.Any(t => t == SocialTargetStatus.Publishing)) return SocialPostStatus.Publishing;
        if (targets.Any(t => t == SocialTargetStatus.Pending)) return SocialPostStatus.Scheduled;
        var ok = targets.Count(t => t == SocialTargetStatus.Published);
        var failed = targets.Count(t => t == SocialTargetStatus.Failed);
        if (ok > 0) return failed > 0 ? SocialPostStatus.PartiallyFailed : SocialPostStatus.Published;
        return failed > 0 ? SocialPostStatus.Failed : SocialPostStatus.Cancelled;
    }

    // ---------------- Sửa bài đã hẹn (TEST-208) ----------------

    /// <summary>
    /// Bài còn sửa được không (null = được; khác = lý do, API trả 409): chưa đích nào từng được gửi đi — mọi đích đang Chờ với
    /// <c>Attempts = 0</c> hoặc Đã huỷ — và còn ít nhất một đích Chờ. Đang đăng / đã đăng / lỗi / đang chờ thử lại → không sửa.
    /// </summary>
    public static string? CannotEditPost(IReadOnlyCollection<(SocialTargetStatus Status, int Attempts)> targets)
    {
        if (targets.Any(t => t.Status == SocialTargetStatus.Publishing)) return "Bài đang được đăng, không sửa được nữa";
        if (targets.Any(t => t.Status is SocialTargetStatus.Published or SocialTargetStatus.Failed))
            return "Bài đã gửi lên Facebook (đã đăng hoặc lỗi) ở ít nhất một trang, không sửa được — huỷ phần còn chờ rồi tạo bài mới";
        if (targets.Any(t => t.Status == SocialTargetStatus.Pending && t.Attempts > 0))
            return "Bài đang chờ thử lại sau lỗi tạm thời, không sửa được — huỷ rồi tạo bài mới";
        if (!targets.Any(t => t.Status == SocialTargetStatus.Pending)) return "Bài không còn trang nào đang chờ đăng";
        return null;
    }

    /// <summary>Người được sửa nội dung bài: người đăng hoặc HR / admin. Người giữ BM không phải tác giả chỉ được huỷ.</summary>
    public static bool CanEditAuthor(bool isHr, Guid viewerUserId, Guid authorUserId) => isHr || viewerUserId == authorUserId;

    // ---------------- Quyền của token ----------------

    /// <summary>
    /// Quyền token System User cần cho OfficeHub (Graph API v23): <c>pages_show_list</c> (liệt kê trang, /me/accounts),
    /// <c>pages_manage_posts</c> + <c>pages_read_engagement</c> (đăng bài — Meta yêu cầu cả hai; đọc bài / tương tác),
    /// <c>business_management</c> (trang được gán qua Business Manager / System User), <c>pages_read_user_content</c>
    /// (đọc bài + tổng bình luận khi đồng bộ bài viết của trang — TEST-206), <c>pages_manage_engagement</c> (trả lời bình luận dưới tên Trang — TEST-212).
    /// </summary>
    public static readonly IReadOnlyList<SocialRequiredPermission> RequiredPermissions =
    [
        new("pages_show_list", "không lấy được danh sách trang"),
        new("pages_manage_posts", "không đăng bài lên trang được"),
        new("pages_read_engagement", "không đọc bài / tương tác được (Facebook cũng cần quyền này để đăng bài)"),
        new("business_management", "không truy cập được các trang được gán qua Business Manager"),
        new("pages_read_user_content", "không đồng bộ được bài viết / số bình luận của trang"),
        new(EngagementPermission, "không trả lời được bình luận dưới tên Trang"),
    ];

    /// <summary>Quyền Graph cần để trả lời bình luận dưới tên Trang (TEST-212).</summary>
    public const string EngagementPermission = "pages_manage_engagement";

    public static bool IsRequiredPermission(string permission) => RequiredPermissions.Any(r => r.Permission == permission);

    /// <summary>Quyền OfficeHub cần mà token chưa được cấp (không có trong danh sách hoặc trạng thái khác <c>granted</c>).</summary>
    public static List<SocialRequiredPermission> MissingPermissions(IEnumerable<SocialTokenPermission> permissions)
    {
        var granted = permissions.Where(p => p.Status == "granted").Select(p => p.Permission).ToHashSet();
        return [.. RequiredPermissions.Where(r => !granted.Contains(r.Permission))];
    }

    private static readonly JsonSerializerOptions PermJson = new(JsonSerializerDefaults.Web);

    /// <summary>Lưu danh sách quyền: bỏ trùng / rỗng, sắp theo tên, trạng thái chữ thường.</summary>
    public static string SerializePermissions(IEnumerable<SocialTokenPermission> permissions) =>
        JsonSerializer.Serialize(permissions.Where(p => !string.IsNullOrWhiteSpace(p.Permission))
            .Select(p => new SocialTokenPermission(p.Permission.Trim(), (p.Status ?? "").Trim().ToLowerInvariant()))
            .DistinctBy(p => p.Permission).OrderBy(p => p.Permission, StringComparer.Ordinal).ToList(), PermJson);

    /// <summary>Đọc danh sách quyền đã lưu; null / hỏng → null (coi như chưa lấy được).</summary>
    public static List<SocialTokenPermission>? ParsePermissions(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return JsonSerializer.Deserialize<List<SocialTokenPermission>>(json, PermJson)?.Where(p => p.Permission is not null).ToList(); }
        catch (JsonException) { return null; }
    }

    // ---------------- Gửi lên Facebook ----------------

    /// <summary>Số lần thử tối đa (chỉ thử lại với lỗi tạm thời).</summary>
    public const int MaxAttempts = 3;
    /// <summary>Đích kẹt ở "Đang đăng" quá lâu (Api khởi động lại giữa chừng) → báo lỗi, không đăng lại tự động (tránh đăng trùng).</summary>
    public static readonly TimeSpan StuckAfter = TimeSpan.FromMinutes(15);

    /// <summary>Mã lỗi Graph API tạm thời (giới hạn tần suất, lỗi máy chủ) → thử lại sau.</summary>
    public static bool IsTransient(int? httpStatus, int? code) =>
        code is 1 or 2 or 4 or 17 or 32 or 341 or 368 or 613 || httpStatus is >= 500 and < 600 || httpStatus == 429;

    /// <summary>Lỗi token (hết hạn, bị thu hồi, System User bị xoá) → đánh dấu token BM lỗi, báo HR + người giữ. Thiếu quyền (10 / 200) chỉ lỗi bài.</summary>
    public static bool IsTokenError(int? code) => code is 190 or 102;

    // ---------------- Kiểm tra token định kỳ (TEST-205) ----------------

    /// <summary>Chu kỳ job <c>SocialTokenCheckJob</c> kiểm tra lại token của mọi BM đang dùng.</summary>
    public static readonly TimeSpan TokenCheckInterval = TimeSpan.FromHours(5);
    /// <summary>Lần chạy đầu sau khi Api khởi động.</summary>
    public static readonly TimeSpan TokenCheckFirstDelay = TimeSpan.FromMinutes(3);

    /// <summary>
    /// Facebook trả lỗi khi kiểm tra token → token có bị coi là hỏng không. Lỗi tạm thời (giới hạn tần suất, máy chủ Facebook lỗi)
    /// giữ nguyên trạng thái như lỗi mạng, tránh báo nhầm mỗi 5 giờ.
    /// </summary>
    public static bool MarksTokenInvalid(int? httpStatus, int? code) => !IsTransient(httpStatus, code);

    /// <summary>Chỉ báo khi token CHUYỂN sang lỗi; đang lỗi rồi thì không báo lại.</summary>
    public static bool ShouldAlertTokenInvalid(SocialTokenStatus before) => before != SocialTokenStatus.Invalid;

    /// <summary>Người nhận báo token hỏng: người đang giữ BM (còn làm việc) + mọi HR + mọi Quản trị viên, bỏ trùng, giữ thứ tự.</summary>
    public static IReadOnlyList<Guid> TokenAlertRecipients(Guid? holderUserId, IEnumerable<Guid> hrUserIds, IEnumerable<Guid> adminUserIds) =>
        [.. (holderUserId is { } h ? new[] { h } : []).Concat(hrUserIds).Concat(adminUserIds).Distinct()];

    // ---------------- Bài viết hiện có của Fanpage (TEST-206) ----------------

    /// <summary>Số bài mới nhất lấy về mỗi lần đồng bộ một trang.</summary>
    public const int PagePostsLimit = 100;
    /// <summary>Bấm "Đồng bộ bài viết" khi vừa đồng bộ chưa tới mức này → trả kết quả hiện có, không gọi Facebook.</summary>
    public static readonly TimeSpan PostsSyncCooldown = TimeSpan.FromMinutes(1);

    /// <summary>Vừa đồng bộ (thành công hoặc lỗi) chưa quá <see cref="PostsSyncCooldown"/> → bỏ qua lần bấm này.</summary>
    public static bool PostsSyncTooSoon(DateTimeOffset? lastAttempt, DateTimeOffset now) => lastAttempt is { } t && now - t < PostsSyncCooldown;

    /// <summary>Người xem chi tiết / bài / đồng bộ bài của trang: HR, hoặc người đang giữ BM (BM đang dùng). Người khác → 404.</summary>
    public static bool CanViewPage(bool isHr, Guid? viewerEmployeeId, SocialAccountStatus status, Guid? holder) =>
        isHr || (status == SocialAccountStatus.Active && viewerEmployeeId is { } e && holder == e);

    // ---------------- Ẩn / hiện / xoá bài của Fanpage (TEST-211) ----------------

    /// <summary>
    /// Người được ẩn / hiện lại / xoá bài của trang: như <see cref="CanViewPage"/> — HR (gồm Quản trị viên) hoặc người đang giữ BM đang dùng.
    /// Người khác → 404.
    /// </summary>
    public static bool CanModeratePagePost(bool isHr, Guid? viewerEmployeeId, SocialAccountStatus status, Guid? holder) =>
        CanViewPage(isHr, viewerEmployeeId, status, holder);

    /// <summary>Lý do không gửi được lệnh ẩn / hiện / xoá lên Facebook (409); null = được. Bài đã xoá chỉ còn xem lại.</summary>
    public static string? CannotModeratePagePost(bool pageActive, bool hasPageToken, bool deleted)
    {
        if (deleted) return "Bài đã bị xoá trên Facebook";
        if (!pageActive) return "Trang không còn trong BM — đồng bộ lại BM để kiểm tra";
        if (!hasPageToken) return "Chưa có quyền với trang này — nhờ HR kiểm tra quyền System User rồi đồng bộ lại BM";
        return null;
    }

    /// <summary>
    /// Facebook báo bài không còn (đã bị xoá trên Facebook): HTTP 404, hoặc mã 100 kèm subcode 33 ("Object … does not exist"). Xoá → coi như
    /// đã xoá; ẩn / hiện → đánh dấu đã xoá + báo.
    /// </summary>
    public static bool IsPostGone(int? httpStatus, int? code, int? subcode) => httpStatus == 404 || (code == 100 && subcode == 33);

    /// <summary>Thông điệp lỗi Facebook khi ẩn / xoá cho người dùng: thiếu quyền (10, 200–299) → thêm gợi ý kiểm tra quyền token.</summary>
    public static string ModerationError(int? code, string message) =>
        code is 10 or (>= 200 and < 300)
            ? $"Facebook từ chối: {message} — chỉ ẩn / xoá được bài do Trang đăng; kiểm tra quyền pages_manage_posts / pages_manage_engagement của token BM"
            : $"Facebook từ chối: {message}";

    // ---------------- Bình luận + trả lời bình luận (TEST-212) ----------------

    /// <summary>Số bình luận / trả lời mỗi lần tải từ Facebook.</summary>
    public const int CommentsPageSize = 25;
    /// <summary>Giới hạn nội dung trả lời (Facebook nhận 8 000 ký tự cho bình luận).</summary>
    public const int MaxReplyLength = 8000;
    /// <summary>Cùng người + cùng bình luận + cùng nội dung trong khoảng này → bỏ qua lần gửi sau (bấm 2 lần không thành 2 trả lời).</summary>
    public static readonly TimeSpan ReplyDedupeWindow = TimeSpan.FromSeconds(30);

    /// <summary>Nội dung trả lời đã chuẩn hoá (bỏ khoảng trắng đầu / cuối); null → rỗng.</summary>
    public static string NormalizeReply(string? message) => message?.Trim() ?? "";

    /// <summary>Lỗi nội dung trả lời (null = hợp lệ): 1–8 000 ký tự, không rỗng / chỉ khoảng trắng.</summary>
    public static string? ValidateReply(string? message)
    {
        var msg = NormalizeReply(message);
        if (msg.Length == 0) return "Nhập nội dung trả lời";
        if (msg.Length > MaxReplyLength) return $"Trả lời tối đa {MaxReplyLength:N0} ký tự";
        return null;
    }

    /// <summary>
    /// Trả lời trước đó (cùng người + cùng bình luận) có trùng lần gửi này không: cùng nội dung (sau chuẩn hoá) và chưa quá
    /// <see cref="ReplyDedupeWindow"/> → trùng, trả lại trả lời cũ thay vì gửi lên Facebook lần nữa.
    /// </summary>
    public static bool IsDuplicateReply(string previousMessage, DateTimeOffset previousAt, string message, DateTimeOffset now) =>
        NormalizeReply(previousMessage) == NormalizeReply(message) && now - previousAt >= TimeSpan.Zero && now - previousAt < ReplyDedupeWindow;

    /// <summary>
    /// Lý do không trả lời được bình luận (null = được): bài đã xoá, trang không còn / chưa có page token, token BM đang lỗi, token thiếu
    /// <c>pages_manage_engagement</c> (chỉ khi đã lấy được danh sách quyền — chưa lấy được thì cứ gửi, Facebook sẽ báo).
    /// </summary>
    public static string? CannotReply(bool pageActive, bool hasPageToken, bool postDeleted, SocialTokenStatus tokenStatus,
        IReadOnlyCollection<SocialTokenPermission>? permissions)
    {
        if (postDeleted) return "Bài đã bị xoá trên Facebook";
        if (!pageActive) return "Trang không còn trong BM — đồng bộ lại BM để kiểm tra";
        if (!hasPageToken) return "Chưa có quyền với trang này — nhờ HR kiểm tra quyền System User rồi đồng bộ lại BM";
        if (tokenStatus == SocialTokenStatus.Invalid) return "Token BM đang lỗi — HR cần cập nhật token tại Tài sản → MXH";
        if (permissions is not null && !permissions.Any(p => p.Permission == EngagementPermission && p.Status == "granted"))
            return $"Token thiếu quyền {EngagementPermission} — người giữ BM tạo lại token có quyền này rồi lưu ở Tài sản → MXH";
        return null;
    }

    /// <summary>Thông điệp lỗi Facebook khi đọc / trả lời bình luận: thiếu quyền (10, 200–299) → nói rõ quyền <c>pages_manage_engagement</c>.</summary>
    public static string CommentError(int? code, string message) =>
        code is 10 or (>= 200 and < 300)
            ? $"Token thiếu quyền {EngagementPermission} ({message}) — người giữ BM tạo lại token có quyền này"
            : $"Facebook từ chối: {message}";

    /// <summary>Id bình luận Facebook hợp lệ cho đường dẫn: chữ số và dấu gạch dưới, ≤ 100 ký tự (khác → 404, không gọi Facebook).</summary>
    public static bool IsCommentId(string? id) =>
        id is { Length: > 0 and <= 100 } && id.All(c => char.IsAsciiDigit(c) || c == '_');

    /// <summary>Lần thử kế tiếp: 1 → +1 phút, 2 → +5 phút.</summary>
    public static TimeSpan Backoff(int attempts) => attempts <= 1 ? TimeSpan.FromMinutes(1) : TimeSpan.FromMinutes(5);

    /// <summary>assets/social/{ngày}/{id}/{tên an toàn}.</summary>
    public static string MediaKey(DateTimeOffset now, Guid id, string fileName)
    {
        var safe = new string(fileName.Select(c => char.IsAsciiLetterOrDigit(c) || c is '.' or '-' or '_' ? c : '_').ToArray()).Trim('_');
        return $"assets/social/{now:yyyyMM}/{id:N}/{(safe.Length == 0 ? "file" : safe)}";
    }

    /// <summary>Permalink Facebook có thể là đường dẫn tương đối (video) → thêm https://www.facebook.com.</summary>
    public static string? AbsolutePermalink(string? permalink) =>
        string.IsNullOrWhiteSpace(permalink) ? null
        : permalink.StartsWith("http", StringComparison.OrdinalIgnoreCase) ? permalink
        : "https://www.facebook.com" + (permalink.StartsWith('/') ? "" : "/") + permalink;
}
