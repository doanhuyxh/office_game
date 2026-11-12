using System.Globalization;
using System.Text;

namespace OfficeHub.Modules.Documents.Domain;

/// <summary>Quy tắc thuần của kho tài liệu (không truy cập DB) — test ở OfficeHub.Modules.Documents.Tests.</summary>
public static class DocumentRules
{
    /// <summary>Giới hạn một lần PUT presigned của S3.</summary>
    public const long MaxFileSize = 5L * 1024 * 1024 * 1024;
    public const int TrashDays = 30;
    /// <summary>Nhắc HR + người phụ trách trước khi hết hạn lưu trữ.</summary>
    public const int RetentionNoticeDays = 30;
    /// <summary>Hạn presigned PUT (đủ cho file vài GB bắt đầu tải); vé quá <see cref="TicketCleanupAfter"/> bị dọn.</summary>
    public static readonly TimeSpan UploadUrlTtl = TimeSpan.FromMinutes(30); // chỉ cần còn hạn lúc BẮT ĐẦU PUT (TEST-13: trước 2 giờ)
    /// <summary>Vé chưa dùng tối đa / người trong <see cref="TicketCleanupAfter"/> và tổng dung lượng đang chờ.</summary>
    public const int MaxPendingTickets = 20;
    public const long MaxPendingBytes = 20L * 1024 * 1024 * 1024;
    public static readonly TimeSpan TicketCleanupAfter = TimeSpan.FromHours(24);
    public const string CompanySpaceCode = "CTY";
    public const int MaxTags = 20;
    public const int MaxTagLength = 40;

    private static readonly HashSet<string> ArchiveExt = new(StringComparer.OrdinalIgnoreCase) { ".zip", ".rar", ".7z", ".tar", ".gz", ".tgz" };
    private static readonly HashSet<string> DocExt = new(StringComparer.OrdinalIgnoreCase)
    {
        ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp", ".txt", ".csv", ".md", ".rtf", ".json", ".xml", ".html",
    };


    public static AssetKind KindOf(string contentType, string fileName)
    {
        var ext = Path.GetExtension(fileName);
        if (contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase)) return AssetKind.Image;
        if (contentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase)) return AssetKind.Video;
        if (contentType.StartsWith("audio/", StringComparison.OrdinalIgnoreCase)) return AssetKind.Audio;
        if (ArchiveExt.Contains(ext)) return AssetKind.Archive;
        if (DocExt.Contains(ext) || contentType.StartsWith("text/", StringComparison.OrdinalIgnoreCase)) return AssetKind.Document;
        return AssetKind.Other;
    }


    /// <summary>Tên file dùng trong key S3: bỏ dấu, chỉ giữ chữ / số / . - _ (tên gốc vẫn lưu ở DB và trả về khi tải).</summary>
    public static string SafeKeyName(string fileName)
    {
        var sb = new StringBuilder();
        foreach (var c in fileName.Normalize(NormalizationForm.FormD))
        {
            if (CharUnicodeInfo.GetUnicodeCategory(c) == UnicodeCategory.NonSpacingMark) continue;
            var ch = c is 'đ' ? 'd' : c is 'Đ' ? 'D' : c;
            var o = char.IsAsciiLetterOrDigit(ch) || ch is '.' or '_' ? ch : '-';
            if (o == '-' && sb.Length > 0 && sb[^1] == '-') continue; // gộp "--"
            if (o == '.' && sb.Length > 0 && sb[^1] == '-') sb.Length--; // "abc-.pdf" → "abc.pdf"
            sb.Append(o);
        }
        var s = sb.ToString().Trim('-', '.');
        if (s.Length > 120) s = s[^120..];
        return s.Length == 0 ? "file" : s;
    }

    /// <summary>Tên hiển thị của file: bỏ đường dẫn, ký tự điều khiển; tối đa 300 ký tự.</summary>
    public static string CleanFileName(string fileName)
    {
        var name = new string(Path.GetFileName(fileName.Replace('\\', '/')).Where(c => !char.IsControl(c)).ToArray()).Trim();
        return name.Length > 300 ? name[^300..] : name;
    }

    /// <summary>Tên thư mục hợp lệ: không rỗng, không chứa / \ và không phải . / ..</summary>
    public static string? FolderNameError(string? name)
    {
        var n = name?.Trim();
        if (string.IsNullOrEmpty(n)) return "Tên thư mục không được để trống";
        if (n.Length > 200) return "Tên thư mục tối đa 200 ký tự";
        if (n.IndexOfAny(['/', '\\']) >= 0 || n is "." or "..") return "Tên thư mục không được chứa / hoặc \\";
        return null;
    }

    /// <summary>Thẻ: bỏ khoảng trắng thừa, bỏ trùng (không phân biệt hoa thường), tối đa 20 thẻ × 40 ký tự.</summary>
    public static List<string> NormalizeTags(IEnumerable<string>? tags) =>
        (tags ?? []).Select(t => string.Join(' ', (t ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries)))
            .Where(t => t.Length > 0)
            .Select(t => t.Length > MaxTagLength ? t[..MaxTagLength] : t)
            .DistinctBy(t => t.ToLowerInvariant())
            .Take(MaxTags)
            .ToList();

    /// <summary>Ngày hết hạn lưu trữ: ngày bắt đầu + số năm; null = vĩnh viễn.</summary>
    public static DateOnly? RetentionUntil(DateOnly start, int? years) => years is > 0 ? start.AddYears(years.Value) : null;

    public static string AssetCode(string spaceCode, int year, int seq) => $"TL-{spaceCode}-{year}-{seq:D5}";

    /// <summary>Số hiệu ban hành kiểu văn bản hành chính VN: 012/2026/QĐ-KTH.</summary>
    public static string DocumentNumber(int seq, int year, string typeCode, string spaceCode) => $"{seq:D3}/{year}/{typeCode}-{spaceCode}";

    /// <summary>Mã kho trong mã tài sản / số hiệu: CTY, mã phòng ban hoặc mã dự án (viết hoa, chỉ chữ số).</summary>
    public static string SpaceCode(SpaceKind kind, string? code)
    {
        if (kind == SpaceKind.Company) return CompanySpaceCode;
        var c = string.IsNullOrWhiteSpace(code) ? "" : new string(SafeKeyName(code).ToUpperInvariant().Where(char.IsAsciiLetterOrDigit).ToArray());
        return c.Length == 0 ? (kind == SpaceKind.Project ? "DA" : "PB") : c.Length > 12 ? c[..12] : c;
    }

    public static bool CanChangeFile(AssetStatus s) => s == AssetStatus.Draft;
    public static bool CanTrash(AssetStatus s) => s == AssetStatus.Draft;
    public static bool CanSubmit(AssetStatus s) => s == AssetStatus.Draft;
    public static bool CanArchive(AssetStatus s) => s == AssetStatus.Published;
    public static bool CanDestroy(AssetStatus s) => s is AssetStatus.Draft or AssetStatus.Published or AssetStatus.Archived;
    /// <summary>Đổi loại tài liệu chỉ khi còn nháp (loại quyết định số hiệu + hạn lưu trữ).</summary>
    public static bool CanChangeType(AssetStatus s) => s == AssetStatus.Draft;

    /// <summary>Loại tài liệu mặc định khi tạo kho (HR sửa được). Hạn lưu trữ tham khảo Luật Kế toán / Luật Lưu trữ — kế toán nên xác nhận.</summary>
    public static readonly (string Code, string Name, int? Years)[] DefaultTypes =
    [
        ("VB", "Văn bản chung", 5),
        ("QĐ", "Quyết định", null),
        ("QC", "Quy chế, quy trình", null),
        ("HĐ", "Hợp đồng, pháp lý", 10),
        ("KT", "Kế toán, tài chính", 10),
        ("BC", "Báo cáo", 5),
        ("TK", "Thiết kế, kỹ thuật", 10),
        ("HA", "Hình ảnh", 5),
        ("VD", "Video", 5),
        ("K", "Khác", 2),
    ];
}
