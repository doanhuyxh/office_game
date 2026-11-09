namespace OfficeHub.Modules.Assets.Domain;

/// <summary>Quy tắc thuần (có test) cho tài khoản mạng xã hội + đăng bài.</summary>
public static class SocialRules
{
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
