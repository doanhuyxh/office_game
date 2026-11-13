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

    // ---------------- Sửa tin, phản ứng, tìm, nhóm (TEST-54, chủ dự án chốt 2026-11-12) ----------------

    /// <summary>Chỉ sửa được tin của mình trong 24 giờ kể từ lúc gửi.</summary>
    public static readonly TimeSpan EditWindow = TimeSpan.FromHours(24);
    public const string EditExpiredMessage = "Chỉ sửa được tin nhắn trong 24 giờ sau khi gửi";
    public const int MaxEmojiLength = 32;
    /// <summary>Mỗi tin tối đa bấy nhiêu emoji khác nhau (chặn spam phản ứng).</summary>
    public const int MaxReactionKinds = 20;
    public const int MaxGroupTitleLength = 100;
    /// <summary>Tối đa thành viên một nhóm tự tạo (kể cả người tạo).</summary>
    public const int MaxGroupMembers = 100;
    public const int MinSearchLength = 2;
    public const int MaxSearchResults = 50;

    // ---------------- @nhắc trong tin (TEST-70) ----------------

    /// <summary>Tối đa số người được nhắc trong một tin (như bình luận việc).</summary>
    public const int MaxMentions = 10;
    /// <summary>Số gợi ý tối đa khi gõ @ trong ô soạn tin (danh sách cuộn được — TEST-71).</summary>
    public const int MaxMentionCandidates = 20;
    /// <summary>Số kết quả tối đa của /api/chat/people (tìm người nhắn 1-1 / thêm vào nhóm).</summary>
    public const int MaxPeople = 20;

    /// <summary>1-1 không cần @nhắc (người kia đã nhận tin) — mọi loại hội thoại khác có.</summary>
    public static bool CanMention(ConversationType type) => type != ConversationType.Direct;

    /// <summary>
    /// Người được nhắc: mã @ trong <paramref name="text"/> (cú pháp chung <see cref="OfficeHub.BuildingBlocks.Text.MentionCodes"/>) khớp (không phân biệt hoa thường)
    /// một <paramref name="candidates"/> (thành viên hội thoại có tài khoản); bỏ người gửi, bỏ trùng, giữ thứ tự xuất hiện, tối đa <see cref="MaxMentions"/>.
    /// Mã không phải thành viên (người ngoài kênh phòng / nhóm) bị bỏ qua.
    /// </summary>
    public static List<Guid> MentionTargets(string? text, IEnumerable<(Guid UserId, string Code)> candidates, Guid senderId)
    {
        var codes = OfficeHub.BuildingBlocks.Text.MentionCodes.Parse(text, MaxMentions * 2);
        if (codes.Count == 0) return [];
        var byCode = new Dictionary<string, Guid>(StringComparer.OrdinalIgnoreCase);
        foreach (var (userId, code) in candidates) byCode.TryAdd(code, userId);
        var list = new List<Guid>();
        foreach (var code in codes)
            if (byCode.TryGetValue(code, out var u) && u != senderId && !list.Contains(u) && list.Count < MaxMentions) list.Add(u);
        return list;
    }

    /// <summary>Tiêu đề push cho người được nhắc: "Tên nhắc bạn · Toàn văn phòng" / tên phòng / tên nhóm.</summary>
    public static string MentionPushTitle(string senderName, string where) => $"{senderName} nhắc bạn · {where}";

    public static bool CanEdit(DateTimeOffset createdAt, DateTimeOffset now) => now - createdAt <= EditWindow;

    /// <summary>
    /// Emoji tự do: đúng MỘT ký tự hiển thị (grapheme — có thể ghép nhiều code point như 👍🏽, 👨‍👩‍👧, cờ), có ít nhất một ký hiệu (Unicode So),
    /// không chữ cái / khoảng trắng / ký tự điều khiển. Sai → null.
    /// </summary>
    public static string? NormalizeEmoji(string? emoji)
    {
        var e = emoji?.Trim();
        if (string.IsNullOrEmpty(e) || e.Length > MaxEmojiLength || new StringInfo(e).LengthInTextElements != 1) return null;
        var symbol = false;
        foreach (var r in e.EnumerateRunes())
        {
            var cat = Rune.GetUnicodeCategory(r);
            if (Rune.IsLetter(r) || Rune.IsWhiteSpace(r) || cat is UnicodeCategory.Control or UnicodeCategory.PrivateUse) return null;
            if (cat == UnicodeCategory.OtherSymbol) symbol = true;
        }
        return symbol ? e : null;
    }

    /// <summary>Lỗi theo field khi tạo nhóm. <paramref name="memberCount"/> = số người được mời (không tính người tạo).</summary>
    public static List<(string Field, string Message)> ValidateGroup(string? title, int memberCount)
    {
        var e = new List<(string, string)>();
        if (string.IsNullOrWhiteSpace(title)) e.Add(("title", "Nhập tên nhóm"));
        else if (title.Trim().Length > MaxGroupTitleLength) e.Add(("title", $"Tên nhóm tối đa {MaxGroupTitleLength} ký tự"));
        if (memberCount < 1) e.Add(("userIds", "Chọn ít nhất một đồng nghiệp"));
        else if (memberCount + 1 > MaxGroupMembers) e.Add(("userIds", $"Nhóm tối đa {MaxGroupMembers} người"));
        return e;
    }

    /// <summary>Mẫu ILIKE "chứa chuỗi" — thoát % _ \ để người dùng gõ ký tự đặc biệt không thành ký tự đại diện.</summary>
    public static string LikeContains(string term) =>
        "%" + term.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%";

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
        // TEST-13: ngoài danh sách chặn còn phải nằm trong danh sách đuôi được phép (FileTypes)
        else if (!OfficeHub.BuildingBlocks.Storage.FileTypes.IsAllowed(fileName)) e.Add(("fileName", $"Không gửi được loại tệp {Path.GetExtension(fileName)}"));
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
