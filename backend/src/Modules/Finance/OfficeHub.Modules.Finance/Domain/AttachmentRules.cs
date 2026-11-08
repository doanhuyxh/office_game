namespace OfficeHub.Modules.Finance.Domain;

/// <summary>Chứng từ tài chính — hàm thuần (test: tests/OfficeHub.Modules.Finance.Tests).</summary>
public static class AttachmentRules
{
    public const long MaxBytes = 20 * 1024 * 1024;
    public const int MaxPerOwner = 20;
    public static readonly TimeSpan UploadUrlTtl = TimeSpan.FromMinutes(15);

    private static readonly HashSet<string> Allowed =
        [".pdf", ".png", ".jpg", ".jpeg", ".webp", ".heic", ".xlsx", ".xls", ".csv", ".docx", ".doc", ".xml", ".zip", ".txt"];

    /// <summary>Tên hiển thị: bỏ đường dẫn + ký tự điều khiển, tối đa 200 ký tự (giữ đuôi).</summary>
    public static string CleanFileName(string? name)
    {
        var n = new string((Path.GetFileName(name?.Replace('\\', '/') ?? "") ?? "").Where(c => !char.IsControl(c)).ToArray()).Trim();
        if (n.Length <= 200) return n;
        var ext = Path.GetExtension(n);
        return n[..(200 - ext.Length)] + ext;
    }

    public static string NormalizeContentType(string? contentType)
    {
        var ct = contentType?.Split(';')[0].Trim().ToLowerInvariant();
        return ct is { Length: > 2 and <= 150 } && ct.Count(c => c == '/') == 1 && ct.All(c => char.IsAsciiLetterOrDigit(c) || "/.+-_".Contains(c))
            ? ct : "application/octet-stream";
    }

    /// <summary>Chỉ nhận chứng từ văn phòng: PDF, ảnh, Excel / Word, XML (hoá đơn điện tử), zip, txt — tối đa 20 MB.</summary>
    public static List<(string Field, string Message)> Validate(string fileName, long size)
    {
        var e = new List<(string, string)>();
        if (fileName.Length == 0) e.Add(("fileName", "Thiếu tên tệp"));
        else if (!Allowed.Contains(Path.GetExtension(fileName).ToLowerInvariant()))
            e.Add(("fileName", "Chỉ nhận PDF, ảnh, Excel, Word, XML hoá đơn điện tử, zip, txt"));
        if (size <= 0) e.Add(("size", "Tệp rỗng"));
        else if (size > MaxBytes) e.Add(("size", "Tệp tối đa 20 MB"));
        return e;
    }

    /// <summary>finance/{yyyy}/{MM}/{id}/{tên an toàn}.</summary>
    public static string FileKey(DateTimeOffset now, Guid id, string fileName)
    {
        var safe = new string(fileName.Select(c => char.IsAsciiLetterOrDigit(c) || c is '.' or '-' or '_' ? c : '_').ToArray());
        return $"finance/{now:yyyy}/{now:MM}/{id:N}/{(safe.Trim('_').Length == 0 ? "file" : safe)}";
    }

    public static bool IsInline(string contentType) => contentType == "application/pdf" || contentType.StartsWith("image/", StringComparison.Ordinal);
}
