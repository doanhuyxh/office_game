namespace OfficeHub.BuildingBlocks.Storage;

/// <summary>
/// Kiểu file do SERVER quyết định từ đuôi file (TEST-13) — không tin Content-Type trình duyệt gửi:
/// <list type="bullet">
/// <item>Danh sách đuôi được phép (allowlist) + MIME tương ứng; đuôi lạ → không nhận.</item>
/// <item>Chỉ ảnh raster, PDF, video, âm thanh được mở inline; còn lại (HTML, SVG, XML, văn bản…) luôn tải về với MIME an toàn
/// → không chạy được script trên domain S3 / app.</item>
/// <item>Chữ ký đầu file (magic bytes) phải khớp đuôi với các loại nhị phân phổ biến (đổi tên .exe thành .png bị chặn).</item>
/// </list>
/// </summary>
public static class FileTypes
{
    public const string OctetStream = "application/octet-stream";

    private static readonly Dictionary<string, string> Mime = new(StringComparer.OrdinalIgnoreCase)
    {
        // Ảnh raster
        [".jpg"] = "image/jpeg", [".jpeg"] = "image/jpeg", [".png"] = "image/png", [".gif"] = "image/gif", [".webp"] = "image/webp",
        [".heic"] = "image/heic", [".heif"] = "image/heif", [".bmp"] = "image/bmp", [".tif"] = "image/tiff", [".tiff"] = "image/tiff",
        // Ảnh vector / thiết kế — KHÔNG inline (SVG chứa được script)
        [".svg"] = OctetStream, [".psd"] = OctetStream, [".ai"] = OctetStream, [".eps"] = OctetStream, [".fig"] = OctetStream,
        [".sketch"] = OctetStream, [".xd"] = OctetStream, [".indd"] = OctetStream, [".dwg"] = OctetStream, [".dxf"] = OctetStream,
        // Video / âm thanh
        [".mp4"] = "video/mp4", [".m4v"] = "video/mp4", [".mov"] = "video/quicktime", [".webm"] = "video/webm", [".mkv"] = "video/x-matroska",
        [".avi"] = "video/x-msvideo", [".mp3"] = "audio/mpeg", [".m4a"] = "audio/mp4", [".wav"] = "audio/wav", [".ogg"] = "audio/ogg",
        [".aac"] = "audio/aac", [".flac"] = "audio/flac",
        // Văn bản / văn phòng
        [".pdf"] = "application/pdf",
        [".doc"] = "application/msword", [".docx"] = "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        [".xls"] = "application/vnd.ms-excel", [".xlsx"] = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        [".ppt"] = "application/vnd.ms-powerpoint", [".pptx"] = "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        [".odt"] = "application/vnd.oasis.opendocument.text", [".ods"] = "application/vnd.oasis.opendocument.spreadsheet",
        [".odp"] = "application/vnd.oasis.opendocument.presentation", [".rtf"] = "application/rtf",
        // Chữ thuần — tải về dạng text/plain (HTML / XML / JSON không bao giờ được trình duyệt dựng thành trang)
        [".txt"] = "text/plain", [".csv"] = "text/plain", [".md"] = "text/plain", [".json"] = "text/plain", [".xml"] = "text/plain",
        [".html"] = "text/plain", [".htm"] = "text/plain", [".log"] = "text/plain",
        // Nén
        [".zip"] = "application/zip", [".rar"] = "application/vnd.rar", [".7z"] = "application/x-7z-compressed", [".tar"] = "application/x-tar",
        [".gz"] = "application/gzip", [".tgz"] = "application/gzip",
        // Phông chữ
        [".ttf"] = "font/ttf", [".otf"] = "font/otf", [".woff"] = "font/woff", [".woff2"] = "font/woff2",
    };

    /// <summary>Đuôi file (chữ thường, có dấu chấm) nằm trong danh sách cho phép.</summary>
    public static bool IsAllowed(string fileName) => Mime.ContainsKey(Path.GetExtension(fileName));

    /// <summary>MIME theo đuôi; đuôi ngoài danh sách → application/octet-stream.</summary>
    public static string ContentTypeFor(string fileName) => Mime.GetValueOrDefault(Path.GetExtension(fileName), OctetStream);

    /// <summary>
    /// Được mở trực tiếp trong trình duyệt: ảnh raster, PDF, video, âm thanh, chữ thuần (text/plain — HTML / XML / JSON cũng phục vụ dạng này
    /// nên chỉ hiện mã nguồn, trình duyệt không dựng trang). SVG / file văn phòng / nén → luôn tải về.
    /// </summary>
    public static bool IsInlineSafe(string contentType) =>
        contentType is "image/jpeg" or "image/png" or "image/gif" or "image/webp" or "image/heic" or "image/heif" or "image/bmp" or "application/pdf" or "text/plain"
        || contentType.StartsWith("video/", StringComparison.Ordinal) || contentType.StartsWith("audio/", StringComparison.Ordinal);

    /// <summary>Số byte đầu file cần đọc để kiểm chữ ký.</summary>
    public const int SignatureBytes = 16;

    /// <summary>
    /// Chữ ký đầu file khớp đuôi (chỉ kiểm các loại nhị phân có chữ ký rõ ràng; loại khác — văn bản, thiết kế… — luôn true).
    /// File rỗng / ngắn hơn chữ ký → false với loại có chữ ký.
    /// </summary>
    public static bool SignatureMatches(string fileName, ReadOnlySpan<byte> head)
    {
        static bool At(ReadOnlySpan<byte> b, int offset, ReadOnlySpan<byte> sig) => b.Length >= offset + sig.Length && b.Slice(offset, sig.Length).SequenceEqual(sig);
        ReadOnlySpan<byte> zip = [0x50, 0x4B, 0x03, 0x04];
        ReadOnlySpan<byte> ole = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
        return Path.GetExtension(fileName).ToLowerInvariant() switch
        {
            ".png" => At(head, 0, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
            ".jpg" or ".jpeg" => At(head, 0, [0xFF, 0xD8, 0xFF]),
            ".gif" => At(head, 0, "GIF8"u8),
            ".webp" => At(head, 0, "RIFF"u8) && At(head, 8, "WEBP"u8),
            ".bmp" => At(head, 0, "BM"u8),
            ".pdf" => At(head, 0, "%PDF"u8),
            ".docx" or ".xlsx" or ".pptx" or ".odt" or ".ods" or ".odp" or ".zip" => At(head, 0, zip) || At(head, 0, [0x50, 0x4B, 0x05, 0x06]),
            ".doc" or ".xls" or ".ppt" => At(head, 0, ole),
            ".mp4" or ".m4v" or ".mov" or ".m4a" or ".heic" or ".heif" => At(head, 4, "ftyp"u8) || At(head, 4, "moov"u8) || At(head, 4, "mdat"u8)
                || At(head, 4, "wide"u8) || At(head, 4, "free"u8),
            ".webm" or ".mkv" => At(head, 0, [0x1A, 0x45, 0xDF, 0xA3]),
            ".wav" or ".avi" => At(head, 0, "RIFF"u8),
            ".mp3" => At(head, 0, "ID3"u8) || (head.Length >= 2 && head[0] == 0xFF && (head[1] & 0xE0) == 0xE0),
            ".ogg" => At(head, 0, "OggS"u8),
            ".flac" => At(head, 0, "fLaC"u8),
            ".gz" or ".tgz" => At(head, 0, [0x1F, 0x8B]),
            ".7z" => At(head, 0, [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C]),
            ".rar" => At(head, 0, "Rar!"u8),
            _ => true,
        };
    }

    /// <summary>Đọc chữ ký đầu stream (file tải qua Api: ảnh đại diện, file hợp đồng) rồi so với đuôi. Không đổi vị trí stream gốc khi seek được.</summary>
    public static bool StreamMatches(Stream s, string fileNameOrExt)
    {
        var buf = new byte[SignatureBytes];
        var pos = s.CanSeek ? s.Position : 0;
        var n = s.ReadAtLeast(buf, SignatureBytes, throwOnEndOfStream: false);
        if (s.CanSeek) s.Position = pos;
        var name = fileNameOrExt.StartsWith('.') ? "f" + fileNameOrExt : fileNameOrExt.Contains('.') ? fileNameOrExt : "f." + fileNameOrExt;
        return SignatureMatches(name, buf.AsSpan(0, n));
    }
}
