using System.IO.Compression;

namespace OfficeHub.BuildingBlocks.Documents;

/// <summary>
/// Chống "zip bomb" khi mở file Office (.docx / .xlsx là zip) người dùng tải lên (TEST-13): kiểm thư mục zip TRƯỚC khi thư viện giải nén —
/// quá nhiều mục, tổng dung lượng giải nén quá lớn hoặc tỉ lệ nén bất thường → <see cref="InvalidDataException"/> (nơi gọi đã bắt lỗi này
/// thành "file không hợp lệ"). Dung lượng khai báo trong zip có thể bị làm giả → còn giới hạn ký tự mỗi phần ở <c>DocxTemplate</c>.
/// </summary>
public static class ZipGuard
{
    public const long MaxUncompressedBytes = 200L * 1024 * 1024;
    public const int MaxEntries = 5_000;
    /// <summary>File Office thật hiếm khi nén quá 100 lần; bomb thường hàng nghìn lần.</summary>
    public const int MaxRatio = 200;

    /// <summary>Kiểm rồi đưa con trỏ về đầu. Stream phải seek được (MemoryStream).</summary>
    public static void Check(Stream zip)
    {
        if (!zip.CanSeek) throw new InvalidDataException("Cần stream seek được để kiểm file nén");
        var start = zip.Position;
        try
        {
            using var archive = new ZipArchive(zip, ZipArchiveMode.Read, leaveOpen: true);
            if (archive.Entries.Count > MaxEntries) throw new InvalidDataException("File có quá nhiều thành phần");
            long total = 0;
            foreach (var e in archive.Entries)
            {
                total += e.Length;
                if (total > MaxUncompressedBytes) throw new InvalidDataException("File giải nén quá lớn");
                if (e.CompressedLength > 0 && e.Length / e.CompressedLength > MaxRatio && e.Length > 1024 * 1024)
                    throw new InvalidDataException("Tỉ lệ nén bất thường");
            }
        }
        finally { zip.Position = start; }
    }
}
