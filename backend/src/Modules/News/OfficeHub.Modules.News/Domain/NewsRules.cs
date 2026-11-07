using System.Globalization;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;

namespace OfficeHub.Modules.News.Domain;

/// <summary>Quy tắc thuần của tin tức (không truy cập DB) — test ở OfficeHub.Modules.News.Tests.</summary>
public static partial class NewsRules
{
    public const int MaxPlainLength = 20000;
    public const int MaxHtmlLength = 200_000;
    public const int MaxCommentLength = 2000;
    public const int MaxMedia = 10;
    public const int MaxTargets = 200;
    public const long MaxImageSize = 10L * 1024 * 1024;
    public const long MaxVideoSize = 200L * 1024 * 1024;
    public const long MaxFileSize = 25L * 1024 * 1024;
    /// <summary>Số bài có kèm email mỗi ngày (giờ văn phòng) của người thường; HR / admin không giới hạn.</summary>
    public const int MaxEmailPostsPerDay = 3;
    public const int PreviewLength = 300;
    public const string DeletedText = "Nội dung đã bị gỡ";
    public static readonly TimeSpan UploadUrlTtl = TimeSpan.FromMinutes(60);
    public static readonly TimeSpan MediaUrlTtl = TimeSpan.FromMinutes(60);
    public static readonly TimeSpan TicketCleanupAfter = TimeSpan.FromHours(24);
    public static readonly TimeSpan MinPostInterval = TimeSpan.FromSeconds(5);
    public static readonly TimeSpan MinCommentInterval = TimeSpan.FromSeconds(1);

    private static readonly HashSet<string> Blocked = new(StringComparer.OrdinalIgnoreCase)
    {
        ".exe", ".msi", ".bat", ".cmd", ".com", ".scr", ".ps1", ".vbs", ".jar", ".apk", ".dll", ".sh", ".app", ".dmg", ".pkg", ".html", ".htm", ".svg",
    };

    private static readonly HashSet<string> ImageTypes = new(StringComparer.OrdinalIgnoreCase) { "image/jpeg", "image/png", "image/webp", "image/gif" };
    private static readonly HashSet<string> VideoTypes = new(StringComparer.OrdinalIgnoreCase) { "video/mp4", "video/webm", "video/quicktime" };

    public static MediaKind KindOf(string contentType) =>
        ImageTypes.Contains(contentType) ? MediaKind.Image : VideoTypes.Contains(contentType) ? MediaKind.Video : MediaKind.File;

    public static long MaxSizeOf(MediaKind kind) => kind switch { MediaKind.Image => MaxImageSize, MediaKind.Video => MaxVideoSize, _ => MaxFileSize };

    public static bool IsBlocked(string fileName) => Blocked.Contains(Path.GetExtension(fileName));

    /// <summary>Lỗi theo field khi xin tải lên (rỗng = hợp lệ). <paramref name="imageOnly"/>: ảnh bình luận.</summary>
    public static List<(string Field, string Message)> ValidateUpload(string fileName, string contentType, long size, bool imageOnly = false)
    {
        var e = new List<(string, string)>();
        var kind = KindOf(contentType);
        if (fileName.Length == 0) e.Add(("fileName", "Thiếu tên tệp"));
        else if (IsBlocked(fileName)) e.Add(("fileName", "Không đăng file chạy chương trình hoặc trang web (.exe, .bat, .html, .svg…)"));
        if (imageOnly && kind != MediaKind.Image) e.Add(("contentType", "Bình luận chỉ đính kèm được ảnh (jpeg, png, webp, gif)"));
        if (size <= 0) e.Add(("size", "Tệp rỗng"));
        else if (size > MaxSizeOf(kind))
            e.Add(("size", kind switch { MediaKind.Image => "Ảnh tối đa 10 MB", MediaKind.Video => "Video tối đa 200 MB", _ => "Tệp tối đa 25 MB" }));
        return e;
    }

    public static string NormalizeContentType(string? contentType)
    {
        var ct = contentType?.Split(';')[0].Trim().ToLowerInvariant();
        return ct is { Length: > 2 and <= 150 } && ct.Count(c => c == '/') == 1 && ct.All(c => char.IsAsciiLetterOrDigit(c) || "/.+-_".Contains(c))
            ? ct : "application/octet-stream";
    }

    public static string CleanFileName(string? fileName)
    {
        var name = new string(Path.GetFileName((fileName ?? "").Replace('\\', '/')).Where(c => !char.IsControl(c)).ToArray()).Trim();
        return name.Length > 300 ? name[^300..] : name;
    }

    public static string SafeKeyName(string fileName)
    {
        var sb = new StringBuilder();
        foreach (var c in fileName.Normalize(NormalizationForm.FormD))
        {
            if (CharUnicodeInfo.GetUnicodeCategory(c) == UnicodeCategory.NonSpacingMark) continue;
            var ch = c is 'đ' ? 'd' : c is 'Đ' ? 'D' : c;
            var o = char.IsAsciiLetterOrDigit(ch) || ch is '.' or '_' ? ch : '-';
            if (o == '-' && sb.Length > 0 && sb[^1] == '-') continue;
            if (o == '.' && sb.Length > 0 && sb[^1] == '-') sb.Length--;
            sb.Append(o);
        }
        var s = sb.ToString().Trim('-', '.');
        if (s.Length > 120) s = s[^120..];
        return s.Length == 0 ? "file" : s;
    }

    /// <summary>Khoá S3 — thư mục riêng <c>feed/</c> (dưới <c>files/</c> của IFileStorage), không chung <c>documents/</c> và <c>chat/</c>.</summary>
    public static string FileKey(DateTimeOffset now, Guid ticketId, string fileName) =>
        $"feed/{now:yyyy}/{now:MM}/{ticketId:N}/{SafeKeyName(fileName)}";

    /// <summary>Chữ thuần từ HTML đã lọc: thẻ khối → xuống dòng, bỏ thẻ, giải mã &amp;…; nhắc tên giữ nguyên chữ "@Tên".</summary>
    public static string ToPlainText(string html)
    {
        if (string.IsNullOrEmpty(html)) return "";
        var s = BlockEnd().Replace(html, "\n");
        s = Tags().Replace(s, "");
        s = WebUtility.HtmlDecode(s).Replace(' ', ' ');
        s = Spaces().Replace(s, " ");
        s = ManyNewlines().Replace(s, "\n\n");
        return s.Trim();
    }

    /// <summary>Cắt cho xem trước (email, danh sách): tối đa <paramref name="max"/> ký tự, thêm "…".</summary>
    public static string Preview(string text, int max = PreviewLength)
    {
        var s = text.ReplaceLineEndings(" ").Trim();
        return s.Length > max ? s[..(max - 1)].TrimEnd() + "…" : s;
    }

    /// <summary>Id người được nhắc trong HTML bài (<c>data-mention="guid"</c>) hoặc bình luận (<c>@[Tên](guid)</c>); chỉ nhận Guid hợp lệ.</summary>
    public static IReadOnlyList<Guid> ExtractMentions(string? htmlOrText)
    {
        if (string.IsNullOrEmpty(htmlOrText)) return [];
        var ids = new HashSet<Guid>();
        foreach (Match m in MentionAttr().Matches(htmlOrText))
            if (Guid.TryParse(m.Groups[1].Value, out var g) && g != Guid.Empty) ids.Add(g);
        foreach (Match m in MentionToken().Matches(htmlOrText))
            if (Guid.TryParse(m.Groups[1].Value, out var g) && g != Guid.Empty) ids.Add(g);
        return ids.ToList();
    }

    /// <summary>Bình luận: bỏ khoảng trắng đầu / cuối; rỗng → null.</summary>
    public static string? NormalizeText(string? text)
    {
        var t = text?.Trim();
        return string.IsNullOrEmpty(t) ? null : t;
    }

    public static List<(string Field, string Message)> ValidateComment(string? text, bool hasImage)
    {
        var e = new List<(string, string)>();
        if (text is null && !hasImage) e.Add(("text", "Nhập nội dung hoặc đính kèm một ảnh"));
        if (text is { Length: > MaxCommentLength }) e.Add(("text", $"Bình luận tối đa {MaxCommentLength} ký tự"));
        return e;
    }

    /// <summary>Lỗi theo field của bài: nội dung (chữ hoặc có tệp), độ dài, phạm vi.</summary>
    public static List<(string Field, string Message)> ValidatePost(string plainText, int htmlLength, int mediaCount, PostAudience audience, int targetCount)
    {
        var e = new List<(string, string)>();
        if (plainText.Length == 0 && mediaCount == 0) e.Add(("contentHtml", "Nhập nội dung hoặc đính kèm ít nhất một tệp"));
        if (plainText.Length > MaxPlainLength) e.Add(("contentHtml", $"Bài viết tối đa {MaxPlainLength:N0} ký tự"));
        if (htmlLength > MaxHtmlLength) e.Add(("contentHtml", "Nội dung quá dài"));
        if (mediaCount > MaxMedia) e.Add(("uploadIds", $"Mỗi bài đính kèm tối đa {MaxMedia} tệp"));
        if (audience is PostAudience.Departments or PostAudience.Custom && targetCount == 0)
            e.Add(("targets", audience == PostAudience.Departments ? "Chọn ít nhất một phòng ban" : "Chọn ít nhất một người"));
        if (targetCount > MaxTargets) e.Add(("targets", $"Tối đa {MaxTargets} đối tượng"));
        return e;
    }

    /// <summary>Phòng ban của người xem + toàn bộ phòng ban cha (bài gửi cho phòng cha thì phòng con cũng thấy).</summary>
    public static HashSet<Guid> DepartmentChain(Guid? departmentId, IReadOnlyDictionary<Guid, Guid?> parentOf)
    {
        var set = new HashSet<Guid>();
        var cur = departmentId;
        while (cur is { } d && set.Add(d)) cur = parentOf.GetValueOrDefault(d);
        return set;
    }

    /// <summary>Có được xem không (chưa tính ẩn / xoá): tác giả luôn thấy; Company mọi người; Departments khi chuỗi phòng ban của người xem chứa một đích; Custom khi có tên trong danh sách.</summary>
    public static bool CanView(PostAudience audience, Guid authorUserId, Guid viewer, IReadOnlySet<Guid> viewerDepartments,
        IEnumerable<(TargetKind Kind, Guid Id)> targets)
    {
        if (authorUserId == viewer) return true;
        return audience switch
        {
            PostAudience.Company => true,
            PostAudience.Departments => targets.Any(t => t.Kind == TargetKind.Department && viewerDepartments.Contains(t.Id)),
            PostAudience.Custom => targets.Any(t => t.Kind == TargetKind.User && t.Id == viewer),
            _ => false,
        };
    }

    /// <summary>Đầu ngày (theo múi giờ văn phòng) chứa <paramref name="now"/> — mốc đếm hạn mức email trong ngày.</summary>
    public static DateTimeOffset StartOfDay(DateTimeOffset now, TimeZoneInfo tz)
    {
        var local = TimeZoneInfo.ConvertTime(now, tz);
        var midnight = new DateTime(local.Year, local.Month, local.Day, 0, 0, 0, DateTimeKind.Unspecified);
        return new DateTimeOffset(midnight, tz.GetUtcOffset(midnight)).ToUniversalTime();
    }

    public static string Fold(string? s)
    {
        var sb = new StringBuilder();
        foreach (var c in (s ?? "").Normalize(NormalizationForm.FormD))
        {
            if (CharUnicodeInfo.GetUnicodeCategory(c) == UnicodeCategory.NonSpacingMark) continue;
            sb.Append(c is 'đ' or 'Đ' ? 'd' : char.ToLowerInvariant(c));
        }
        return sb.ToString();
    }

    [GeneratedRegex(@"</(p|div|h[1-6]|li|blockquote|ul|ol)>|<br\s*/?>", RegexOptions.IgnoreCase)] private static partial Regex BlockEnd();
    [GeneratedRegex(@"<[^>]+>")] private static partial Regex Tags();
    [GeneratedRegex(@"[ \t]+")] private static partial Regex Spaces();
    [GeneratedRegex(@"\n{3,}")] private static partial Regex ManyNewlines();
    [GeneratedRegex(@"data-mention=""([0-9a-fA-F-]{36})""")] private static partial Regex MentionAttr();
    [GeneratedRegex(@"@\[[^\]\r\n]{1,100}\]\(([0-9a-fA-F-]{36})\)")] private static partial Regex MentionToken();
}
