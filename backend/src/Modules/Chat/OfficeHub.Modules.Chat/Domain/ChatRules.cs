using System.Globalization;
using System.Text;

namespace OfficeHub.Modules.Chat.Domain;

/// <summary>Quy tắc thuần của chat (không truy cập DB) — test ở OfficeHub.Modules.Chat.Tests.</summary>
public static class ChatRules
{
    public const int MaxTextLength = 1000;
    public const int MaxAttachments = 5;
    public const long MaxImageSize = 10L * 1024 * 1024;
    public const long MaxFileSize = 25L * 1024 * 1024;
    public const int MaxPreviewLength = 80;
    public const string DeletedPreview = "Tin nhắn đã thu hồi";
    /// <summary>Tối đa số tin một bot (token AI) gửi trong 1 giờ — chặn vòng lặp / spam (chủ dự án chốt 2026-11-11).</summary>
    public const int BotMessagesPerHour = 60;
    public static readonly TimeSpan BotQuotaWindow = TimeSpan.FromHours(1);
    public const string AiNotBotMessage = "Chỉ tài khoản bot (HR đánh dấu) được nhắn tin qua trợ lý AI — nhắn trên web hoặc trong văn phòng 3D";

    /// <summary>
    /// Bot (token AI): Toàn văn phòng, 1-1 có sẵn (người nhắn trước) và kênh phòng — kênh phòng vẫn chỉ khi là thành viên (bot đã đi vào phòng
    /// bằng tool go_to, Realtime báo như người thật bước vào; chủ dự án mở 2026-11-11). Thành viên theo tài khoản: người thật đăng nhập cùng
    /// tài khoản vẫn thấy lịch sử.
    /// </summary>
    public static bool BotCanUse(ConversationType type) => type is ConversationType.Office or ConversationType.Direct or ConversationType.Room;

    /// <summary>Còn hạn mức gửi không (đã gửi <paramref name="sentLastHour"/> tin trong giờ qua).</summary>
    public static bool BotQuotaLeft(int sentLastHour) => sentLastHour < BotMessagesPerHour;
    public static readonly TimeSpan MinSendInterval = TimeSpan.FromSeconds(1);
    public static readonly TimeSpan UploadUrlTtl = TimeSpan.FromMinutes(30);
    /// <summary>Hạn link xem / tải trả kèm tin nhắn (client giữ cache lâu hơn → tải lại danh sách sẽ có link mới).</summary>
    public static readonly TimeSpan AttachmentUrlTtl = TimeSpan.FromMinutes(60);
    public static readonly TimeSpan TicketCleanupAfter = TimeSpan.FromHours(24);

    public const string OfficeAlias = "office";
    public const string RoomAliasPrefix = "room:";

    private static readonly HashSet<string> Blocked = new(StringComparer.OrdinalIgnoreCase)
    {
        ".exe", ".msi", ".bat", ".cmd", ".com", ".scr", ".ps1", ".vbs", ".jar", ".apk", ".dll", ".sh", ".app", ".dmg", ".pkg",
    };

    private static readonly HashSet<string> ImageTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "image/jpeg", "image/png", "image/webp", "image/gif",
    };

    /// <summary>Cặp (nhỏ, lớn) cố định cho hội thoại 1-1 — hai chiều cho cùng kết quả.</summary>
    public static (Guid Low, Guid High) DirectPair(Guid a, Guid b) =>
        string.CompareOrdinal(a.ToString(), b.ToString()) <= 0 ? (a, b) : (b, a);

    /// <summary>Chữ thường, bỏ dấu tiếng Việt — để tìm "nguyen" ra "Nguyễn".</summary>
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

    /// <summary>Bỏ khoảng trắng đầu / cuối; rỗng → null.</summary>
    public static string? NormalizeText(string? text)
    {
        var t = text?.Trim();
        return string.IsNullOrEmpty(t) ? null : t;
    }

    /// <summary>Lỗi theo field (rỗng = hợp lệ). <paramref name="text"/> đã qua <see cref="NormalizeText"/>.</summary>
    public static List<(string Field, string Message)> ValidateMessage(string? text, int attachmentCount)
    {
        var e = new List<(string, string)>();
        if (text is null && attachmentCount == 0) e.Add(("text", "Nhập nội dung hoặc đính kèm ít nhất một tệp"));
        if (text is { Length: > MaxTextLength }) e.Add(("text", $"Tin nhắn tối đa {MaxTextLength} ký tự"));
        if (attachmentCount > MaxAttachments) e.Add(("uploadIds", $"Mỗi tin đính kèm tối đa {MaxAttachments} tệp"));
        return e;
    }

    public static bool IsBlocked(string fileName) => Blocked.Contains(Path.GetExtension(fileName));

    public static bool IsImageType(string contentType) => ImageTypes.Contains(contentType);

    /// <summary>Ảnh (jpeg / png / webp / gif) xem trực tiếp trong khung chat; còn lại là tệp tải về.</summary>
    public static bool IsImage(string contentType) => IsImageType(NormalizeContentType(contentType));

    public static long MaxSizeOf(string contentType) => IsImage(contentType) ? MaxImageSize : MaxFileSize;

    /// <summary>Lỗi theo field khi xin tải lên (rỗng = hợp lệ).</summary>
    public static List<(string Field, string Message)> ValidateUpload(string fileName, string contentType, long size)
    {
        var e = new List<(string, string)>();
        if (fileName.Length == 0) e.Add(("fileName", "Thiếu tên tệp"));
        else if (IsBlocked(fileName)) e.Add(("fileName", "Không gửi file chạy chương trình (.exe, .bat, .apk…)"));
        if (size <= 0) e.Add(("size", "Tệp rỗng"));
        else if (size > MaxSizeOf(contentType))
            e.Add(("size", IsImage(contentType) ? "Ảnh tối đa 10 MB" : "Tệp tối đa 25 MB"));
        return e;
    }

    /// <summary>Loại MIME hợp lệ dạng "type/subtype"; rỗng / sai → application/octet-stream.</summary>
    public static string NormalizeContentType(string? contentType)
    {
        var ct = contentType?.Split(';')[0].Trim().ToLowerInvariant();
        return ct is { Length: > 2 and <= 150 } && ct.Count(c => c == '/') == 1 && ct.All(c => char.IsAsciiLetterOrDigit(c) || "/.+-_".Contains(c))
            ? ct : "application/octet-stream";
    }

    /// <summary>Tên hiển thị của file: bỏ đường dẫn, ký tự điều khiển; tối đa 300 ký tự.</summary>
    public static string CleanFileName(string? fileName)
    {
        var name = new string(Path.GetFileName((fileName ?? "").Replace('\\', '/')).Where(c => !char.IsControl(c)).ToArray()).Trim();
        return name.Length > 300 ? name[^300..] : name;
    }

    /// <summary>Tên file dùng trong key S3: bỏ dấu, chỉ giữ chữ / số / . _ (tên gốc vẫn lưu ở DB).</summary>
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

    /// <summary>Khoá S3 của tệp chat — thư mục riêng <c>chat/</c>, không dùng chung với kho tài liệu (<c>documents/</c>).</summary>
    public static string FileKey(DateTimeOffset now, Guid ticketId, string fileName) =>
        $"chat/{now:yyyy}/{now:MM}/{ticketId:N}/{SafeKeyName(fileName)}";

    /// <summary>Dòng xem trước trong danh sách hội thoại: nội dung, hoặc "[Ảnh] tên" / "[Tệp] tên" khi chỉ có đính kèm.</summary>
    public static string Preview(string? text, IReadOnlyList<(string FileName, bool IsImage)> attachments)
    {
        var s = text is not null ? text.ReplaceLineEndings(" ")
            : attachments.Count > 0 ? $"{(attachments[0].IsImage ? "[Ảnh]" : "[Tệp]")} {attachments[0].FileName}"
            : "";
        return s.Length > MaxPreviewLength ? s[..(MaxPreviewLength - 1)] + "…" : s;
    }
}
