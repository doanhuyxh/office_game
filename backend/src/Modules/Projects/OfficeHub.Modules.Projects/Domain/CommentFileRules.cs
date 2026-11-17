using System.Globalization;
using System.Text;
using OfficeHub.BuildingBlocks.Storage;

namespace OfficeHub.Modules.Projects.Domain;

/// <summary>
/// Tệp đính kèm bình luận việc (TEST-153) — quy tắc thuần, test ở OfficeHub.Modules.Projects.Tests. Giới hạn như chat (ảnh ≤ 10 MB, tệp ≤ 25 MB,
/// chặn đuôi chạy chương trình, đuôi phải nằm trong <see cref="FileTypes"/>; SVG / HTML luôn tải về). Module Projects có bản riêng, không tham chiếu Chat.
/// DB chỉ giữ khoá S3 (<c>projects/comments/…</c>), link xem = presigned GET cấp mỗi lần đọc.
/// </summary>
public static class CommentFileRules
{
    public const int MaxAttachments = 5;
    public const long MaxImageSize = 10L * 1024 * 1024;
    public const long MaxFileSize = 25L * 1024 * 1024;
    /// <summary>Token AI: tối đa số tệp xin tải lên / 1 giờ (vé còn treo + tệp đã gắn vào bình luận BOT) — như chat.</summary>
    public const int BotUploadsPerHour = 30;
    public static readonly TimeSpan BotQuotaWindow = TimeSpan.FromHours(1);
    public static readonly TimeSpan UploadUrlTtl = TimeSpan.FromMinutes(30);
    /// <summary>Hạn link xem / tải trả kèm bình luận (web tải lại việc → link mới).</summary>
    public static readonly TimeSpan AttachmentUrlTtl = TimeSpan.FromMinutes(60);
    /// <summary>Hạn link tải trả cho trợ lý AI (view_attachment).</summary>
    public static readonly TimeSpan AiAttachmentUrlTtl = TimeSpan.FromMinutes(10);
    /// <summary>Vé xin link nhưng không gắn vào bình luận nào sau chừng này → xoá vé + file mồ côi.</summary>
    public static readonly TimeSpan TicketCleanupAfter = TimeSpan.FromHours(24);
    public const int PreviewMaxSide = 1280;
    public const int PreviewMinSide = 64;

    private static readonly HashSet<string> Blocked = new(StringComparer.OrdinalIgnoreCase)
    {
        ".exe", ".msi", ".bat", ".cmd", ".com", ".scr", ".ps1", ".vbs", ".jar", ".apk", ".dll", ".sh", ".app", ".dmg", ".pkg",
    };

    private static readonly HashSet<string> ImageTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "image/jpeg", "image/png", "image/webp", "image/gif",
    };

    /// <summary>Ảnh (jpeg / png / webp / gif) xem trực tiếp trong bình luận; còn lại là tệp tải về.</summary>
    public static bool IsImage(string contentType) => ImageTypes.Contains(contentType);

    public static long MaxSizeOf(string contentType) => IsImage(contentType) ? MaxImageSize : MaxFileSize;

    public static bool QuotaLeft(int usedLastHour) => usedLastHour < BotUploadsPerHour;

    /// <summary>Lỗi theo field khi xin tải lên (rỗng = hợp lệ). <paramref name="contentType"/> do server suy từ đuôi.</summary>
    public static List<(string Field, string Message)> ValidateUpload(string fileName, string contentType, long size)
    {
        var e = new List<(string, string)>();
        if (fileName.Length == 0) e.Add(("fileName", "Thiếu tên tệp"));
        else if (Blocked.Contains(Path.GetExtension(fileName))) e.Add(("fileName", "Không gửi file chạy chương trình (.exe, .bat, .apk…)"));
        else if (!FileTypes.IsAllowed(fileName)) e.Add(("fileName", $"Không gửi được loại tệp {Path.GetExtension(fileName)}"));
        if (size <= 0) e.Add(("size", "Tệp rỗng"));
        else if (size > MaxSizeOf(contentType)) e.Add(("size", IsImage(contentType) ? "Ảnh tối đa 10 MB" : "Tệp tối đa 25 MB"));
        return e;
    }

    /// <summary>Lỗi theo field của bình luận: phải có chữ hoặc tệp; ≤ 3000 ký tự; ≤ <see cref="MaxAttachments"/> tệp.</summary>
    public static List<(string Field, string Message)> ValidateComment(string? content, int attachmentCount)
    {
        var e = new List<(string, string)>();
        var text = content?.Trim() ?? "";
        if (text.Length == 0 && attachmentCount == 0) e.Add(("content", "Nhập nội dung hoặc đính kèm ít nhất một tệp"));
        if (text.Length > TaskRules.MaxComment) e.Add(("content", $"Nội dung tối đa {TaskRules.MaxComment} ký tự"));
        if (attachmentCount > MaxAttachments) e.Add(("uploadIds", $"Mỗi bình luận đính kèm tối đa {MaxAttachments} tệp"));
        return e;
    }

    /// <summary>Tên hiển thị: bỏ đường dẫn, ký tự điều khiển; tối đa 300 ký tự.</summary>
    public static string CleanFileName(string? fileName)
    {
        var name = new string(Path.GetFileName((fileName ?? "").Replace('\\', '/')).Where(c => !char.IsControl(c)).ToArray()).Trim();
        return name.Length > 300 ? name[^300..] : name;
    }

    /// <summary>Tên file trong key S3: bỏ dấu, chỉ giữ chữ / số / . _ (tên gốc lưu ở DB).</summary>
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

    /// <summary>Khoá S3 riêng của module: <c>projects/comments/{yyyy}/{MM}/{vé}/{tên}</c>.</summary>
    public static string FileKey(DateTimeOffset now, Guid ticketId, string fileName) =>
        $"projects/comments/{now:yyyy}/{now:MM}/{ticketId:N}/{SafeKeyName(fileName)}";

    /// <summary>Đoạn xem trước cho chuông / luồng thay đổi: nội dung, hoặc "[Ảnh] tên" / "[Tệp] tên" khi chỉ có tệp.</summary>
    public static string Preview(string content, IReadOnlyList<(string FileName, bool IsImage)> files)
    {
        var s = content.Length > 0 ? content
            : files.Count > 0 ? $"{(files[0].IsImage ? "[Ảnh]" : "[Tệp]")} {files[0].FileName}" + (files.Count > 1 ? $" +{files.Count - 1}" : "")
            : "";
        return s.Length > 200 ? s[..200] + "…" : s;
    }
}
