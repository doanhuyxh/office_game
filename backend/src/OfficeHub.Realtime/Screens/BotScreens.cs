using System.Collections.Concurrent;
using System.Security.Cryptography;

namespace OfficeHub.Realtime.Screens;

/// <summary>Khung hình mới nhất bot chiếu ở một phòng — chỉ trong RAM, khung mới thay khung cũ, không ghi đĩa / S3.</summary>
public sealed record BotFrame(byte[] Bytes, string ContentType, long Version, DateTimeOffset At);

/// <summary>
/// Bot đang chiếu ở một phòng: <see cref="Screen"/> = đúng đối tượng đã đặt vào <see cref="RoomScreens"/> (so tham chiếu để biết màn hình còn là của bot
/// hay đã bị người khác thay / tắt). <see cref="Token"/> = phần khó đoán trong URL ảnh (như link presigned — chỉ người trong phòng nhận được).
/// </summary>
public sealed class BotPresentation
{
    public required string UserId { get; init; }
    public required string RoomId { get; init; }
    public required string Token { get; init; }
    public BotFrame? Frame;
    public ScreenDto? Screen;
    public DateTimeOffset LastAt;
}

/// <summary>
/// Bot chiếu màn hình / tài liệu lên TV phòng họp (tool MCP present_screen / present_document, 2026-11-11 — chủ dự án chọn "ảnh chụp cập nhật").
/// Ảnh phục vụ ở <c>GET /rt/screens/{roomId}/{token}</c>; mỗi khung mới tăng <c>?v=</c> để trình duyệt tải lại.
/// </summary>
public sealed class BotScreens
{
    public const int MaxBytes = 2 * 1024 * 1024;
    public static readonly TimeSpan MinInterval = TimeSpan.FromSeconds(3);
    /// <summary>present_markdown: nội dung chữ gửi kèm ScreenChanged (không qua URL) → giới hạn ký tự + tần suất riêng (nhẹ hơn ảnh).</summary>
    public const int MaxMarkdownChars = 20_000;
    public static readonly TimeSpan MarkdownMinInterval = TimeSpan.FromSeconds(1);
    /// <summary>Không có khung / lệnh mới trong từng này → tự tắt.</summary>
    public static readonly TimeSpan Idle = TimeSpan.FromMinutes(10);
    public const string FramePathPrefix = "/rt/screens";

    private readonly ConcurrentDictionary<string, BotPresentation> _byRoom = new();
    private readonly ConcurrentDictionary<string, DateTimeOffset> _clearedAt = new();
    /// <summary>Người trong phòng bấm "Tắt chiếu" → bot không tự bật lại trong từng này.</summary>
    public static readonly TimeSpan ClearedCooldown = TimeSpan.FromMinutes(1);

    public void MarkCleared(string roomId, DateTimeOffset now) => _clearedAt[roomId] = now;
    public bool RecentlyCleared(string roomId, DateTimeOffset now) => _clearedAt.TryGetValue(roomId, out var t) && now - t < ClearedCooldown;

    public IEnumerable<BotPresentation> All => _byRoom.Values;
    public BotPresentation? Get(string roomId) => _byRoom.TryGetValue(roomId, out var p) ? p : null;

    /// <summary>Lấy (hoặc mở mới) lượt chiếu của bot ở phòng; bot khác đang chiếu ở đó thì thay luôn (như người chiếu đè).</summary>
    public BotPresentation Begin(string userId, string roomId) =>
        _byRoom.AddOrUpdate(roomId,
            _ => New(userId, roomId),
            (_, cur) => cur.UserId == userId ? cur : New(userId, roomId));

    public bool End(string roomId, BotPresentation p) => _byRoom.TryRemove(new(roomId, p));

    private static BotPresentation New(string userId, string roomId) =>
        new() { UserId = userId, RoomId = roomId, Token = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16)) };

    public static string FrameUrl(BotPresentation p) => $"{FramePathPrefix}/{p.RoomId}/{p.Token}?v={p.Frame?.Version ?? 0}";

    /// <summary>Nhận diện ảnh bằng chữ ký đầu file (không tin content-type client gửi): PNG, JPEG, WebP; khác → null.</summary>
    public static string? DetectImage(ReadOnlySpan<byte> b)
    {
        if (b.Length >= 8 && b[..8].SequenceEqual(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A })) return "image/png";
        if (b.Length >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF) return "image/jpeg";
        if (b.Length >= 12 && b[..4].SequenceEqual("RIFF"u8) && b[8..12].SequenceEqual("WEBP"u8)) return "image/webp";
        return null;
    }

    /// <summary>Kiểm nội dung present_markdown: bỏ ký tự điều khiển (trừ xuống dòng / tab), không rỗng, ≤ <see cref="MaxMarkdownChars"/>.</summary>
    public static string? CleanMarkdown(string? input, out string? error)
    {
        error = null;
        var s = new string((input ?? "").Where(c => c is '\n' or '\t' || !char.IsControl(c)).ToArray()).Trim();
        if (s.Length == 0) { error = "Thiếu nội dung trình bày (content)"; return null; }
        if (s.Length > MaxMarkdownChars) { error = $"Nội dung dài quá {MaxMarkdownChars:N0} ký tự — rút gọn hoặc chia nhiều lần trình bày"; return null; }
        return s;
    }

    /// <summary>Base64 (có thể kèm tiền tố data:image/…;base64,) → byte; lỗi / quá cỡ → null + lý do tiếng Việt.</summary>
    public static byte[]? DecodeImage(string? input, out string? error)
    {
        error = null;
        var s = (input ?? "").Trim();
        var comma = s.StartsWith("data:", StringComparison.OrdinalIgnoreCase) ? s.IndexOf(',') : -1;
        if (comma >= 0) s = s[(comma + 1)..];
        if (s.Length == 0) { error = "Thiếu ảnh màn hình"; return null; }
        if (s.Length > (MaxBytes + 2) / 3 * 4 + 4) { error = $"Ảnh lớn quá {MaxBytes / 1024 / 1024} MB — giảm độ phân giải / dùng JPEG"; return null; }
        byte[] bytes;
        try { bytes = Convert.FromBase64String(s); }
        catch (FormatException) { error = "Ảnh không phải base64 hợp lệ"; return null; }
        if (bytes.Length > MaxBytes) { error = $"Ảnh lớn quá {MaxBytes / 1024 / 1024} MB"; return null; }
        if (DetectImage(bytes) is null) { error = "Chỉ nhận ảnh PNG, JPEG hoặc WebP"; return null; }
        return bytes;
    }
}
