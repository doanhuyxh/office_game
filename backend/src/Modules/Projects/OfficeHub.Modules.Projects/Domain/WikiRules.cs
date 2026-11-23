using System.Text;

namespace OfficeHub.Modules.Projects.Domain;

/// <summary>Bị từ chối: <see cref="Status"/> 403 (không có quyền / trang khoá / token AI) hoặc 409 (dự án đã đóng).</summary>
public sealed record WikiDenial(int Status, string Message);

/// <summary>Một trang trong cây (để kiểm tra độ sâu / vòng khi tạo, di chuyển).</summary>
public sealed record WikiNode(Guid Id, Guid? ParentId);

/// <summary>
/// Sổ tay dự án (wiki, TEST-215 — chủ dự án chốt 2026-11-23). Hàm thuần — test: tests/OfficeHub.Modules.Projects.Tests/WikiRulesTests.cs.
/// <list type="bullet">
/// <item>Đọc (cây, trang, lịch sử, tìm): người xem được dự án (<c>CanSee</c> — gồm người xem nhờ phòng ban tham gia, Xem tài chính).</item>
/// <item>Tạo / sửa / nối thêm / di chuyển: thành viên — người và bot (<c>CanWork</c>); token AI được, ghi <c>ByBot</c>.</item>
/// <item>Xoá, khoá / mở khoá, khôi phục phiên bản: quản lý dự án + HR / admin (<c>CanManage</c>), chỉ trên web (token AI → 403).</item>
/// <item>Trang đã khoá: chỉ quản lý dự án / HR trên web sửa. Dự án đã đóng: như <see cref="ClosedProjectRules"/> (thành viên chỉ đọc).</item>
/// </list>
/// </summary>
public static class WikiRules
{
    public const int MaxTitle = 200;
    public const int MaxSummary = 300;
    public const int MaxContent = 50_000;
    public const int MaxNote = 300;
    /// <summary>Cây sâu tối đa 4 cấp (trang gốc = cấp 1).</summary>
    public const int MaxDepth = 4;
    public const int MaxPagesPerProject = 500;
    public const int MaxSearchResults = 20;
    public const int MaxQuery = 200;
    /// <summary>Số ký tự lấy mỗi bên chỗ khớp khi trích đoạn kết quả tìm.</summary>
    public const int SnippetRadius = 80;
    public const int MaxVersionPageSize = 100;

    public const string NotMember = "Chỉ thành viên dự án được sửa sổ tay";
    public const string ManagerOnly = "Chỉ quản lý dự án hoặc HR được xoá / khoá trang, khôi phục phiên bản";
    public const string NoAgent = "Trợ lý AI không xoá / khoá trang hay khôi phục phiên bản — làm trên web";
    public const string LockedPage = "Trang đã khoá — chỉ quản lý dự án hoặc HR sửa được (trên web)";

    /// <summary>
    /// Tạo / sửa / nối thêm / di chuyển trang. Thứ tự: không phải thành viên → 403; dự án đóng (thành viên thường / token) → 409;
    /// trang khoá mà không phải quản lý trên web → 403. null = được.
    /// </summary>
    public static WikiDenial? EditDenial(bool canWork, bool canManage, bool active, bool byToken, bool locked = false)
    {
        if (!canWork) return new(403, NotMember);
        if (ClosedProjectRules.TaskWriteError(active, canManage, byToken) is { } closed) return new(409, closed);
        if (locked && (!canManage || byToken)) return new(403, LockedPage);
        return null;
    }

    /// <summary>Xoá trang, khoá / mở khoá, khôi phục phiên bản: quản lý dự án / HR, không qua token AI. null = được.</summary>
    public static WikiDenial? ManageDenial(bool canManage, bool active, bool byToken)
    {
        if (byToken) return new(403, NoAgent);
        if (!canManage) return new(403, ManagerOnly);
        return ClosedProjectRules.TaskWriteError(active, canManage, byToken) is { } closed ? new(409, closed) : null;
    }

    /// <summary>Cờ quyền trên một trang cho người gọi (FE / MCP hiện nút): sửa được, quản lý được.</summary>
    public static (bool CanEdit, bool CanManage) Flags(bool canWork, bool canManage, bool active, bool byToken, bool locked) =>
        (EditDenial(canWork, canManage, active, byToken, locked) is null, ManageDenial(canManage, active, byToken) is null);

    /// <summary>Tiêu đề: bỏ khoảng trắng đầu / cuối, gộp xuống dòng thành dấu cách.</summary>
    public static string NormalizeTitle(string? s) => OneLine(s) ?? "";

    /// <summary>Tóm tắt một dòng (trống → null).</summary>
    public static string? NormalizeSummary(string? s) => OneLine(s);

    private static string? OneLine(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        var sb = new StringBuilder(s.Length);
        foreach (var ch in s.Trim()) sb.Append(ch is '\r' or '\n' or '\t' ? ' ' : ch);
        return sb.ToString();
    }

    /// <summary>Nội dung Markdown: đổi CRLF → LF (đếm độ dài, so sánh thay đổi ổn định), null → "".</summary>
    public static string NormalizeContent(string? s) => (s ?? "").Replace("\r\n", "\n");

    /// <summary>Lỗi theo field (field → câu lỗi) cho tiêu đề / tóm tắt / nội dung / ghi chú đã chuẩn hoá.</summary>
    public static Dictionary<string, string> Errors(string title, string? summary, string content, string? note = null)
    {
        var e = new Dictionary<string, string>();
        if (title.Length == 0) e["title"] = "Tên trang không được để trống";
        else if (title.Length > MaxTitle) e["title"] = $"Tên trang tối đa {MaxTitle} ký tự";
        if (summary is { Length: > MaxSummary }) e["summary"] = $"Tóm tắt tối đa {MaxSummary} ký tự";
        if (content.Length > MaxContent) e["content"] = "Nội dung tối đa 50.000 ký tự / trang";
        if (note is { Length: > MaxNote }) e["note"] = $"Ghi chú tối đa {MaxNote} ký tự";
        return e;
    }

    /// <summary>Hai tên trang trùng nhau (không phân biệt hoa thường) — tên không trùng trong cùng cha.</summary>
    public static bool SameTitle(string a, string b) => string.Equals(a.Trim(), b.Trim(), StringComparison.OrdinalIgnoreCase);

    /// <summary>Lưu mà tiêu đề + tóm tắt + nội dung không đổi → không tạo phiên bản.</summary>
    public static bool IsUnchanged(string oldTitle, string? oldSummary, string oldContent, string title, string? summary, string content) =>
        oldTitle == title && (oldSummary ?? "") == (summary ?? "") && oldContent == content;

    /// <summary>Nối thêm chữ vào cuối trang: cách đoạn cũ một dòng trống (trang trống → chỉ phần mới).</summary>
    public static string Append(string content, string text)
    {
        text = NormalizeContent(text).Trim('\n');
        if (content.Length == 0) return text;
        var body = content.TrimEnd('\n');
        return body.Length == 0 ? text : body + "\n\n" + text;
    }

    /// <summary>Cấp của trang (gốc = 1) theo bản đồ Id → cha. Dữ liệu hỏng (vòng) → dừng ở <see cref="MaxDepth"/> + 1.</summary>
    public static int Depth(Guid? id, IReadOnlyDictionary<Guid, Guid?> parents)
    {
        var d = 0;
        while (id is { } x && d <= MaxDepth)
        {
            d++;
            id = parents.TryGetValue(x, out var p) ? p : null;
        }
        return d;
    }

    /// <summary>Số cấp của cây con tính từ <paramref name="id"/> (chỉ nó = 1).</summary>
    public static int Height(Guid id, ILookup<Guid?, Guid> children, int guard = 0) =>
        guard > MaxDepth ? guard : 1 + children[id].Select(c => Height(c, children, guard + 1)).DefaultIfEmpty(0).Max();

    /// <summary><paramref name="candidate"/> là chính <paramref name="id"/> hoặc con cháu của nó.</summary>
    public static bool IsSelfOrDescendant(Guid id, Guid candidate, IReadOnlyDictionary<Guid, Guid?> parents)
    {
        Guid? x = candidate;
        for (var i = 0; x is { } c && i <= MaxPagesPerProject; i++)
        {
            if (c == id) return true;
            x = parents.TryGetValue(c, out var p) ? p : null;
        }
        return false;
    }

    /// <summary>
    /// Lỗi khi đặt trang <paramref name="pageId"/> (null = trang mới) dưới <paramref name="parentId"/>: cha không thuộc dự án / đã xoá,
    /// làm con của chính nó / con cháu, quá <see cref="MaxDepth"/> cấp. null = được.
    /// </summary>
    public static string? PlacementError(Guid? pageId, Guid? parentId, IReadOnlyCollection<WikiNode> pages)
    {
        var parents = pages.ToDictionary(p => p.Id, p => p.ParentId);
        if (parentId is { } pid && !parents.ContainsKey(pid)) return "Trang cha không tồn tại trong sổ tay dự án";
        if (pageId is { } id && parentId is { } np && IsSelfOrDescendant(id, np, parents)) return "Không đặt trang làm con của chính nó hoặc trang con của nó";
        var height = pageId is { } self ? Height(self, pages.ToLookup(p => p.ParentId, p => p.Id)) : 1;
        return Depth(parentId, parents) + height > MaxDepth ? $"Sổ tay sâu tối đa {MaxDepth} cấp" : null;
    }

    /// <summary>Thứ tự mới của các trang cùng cha khi chèn <paramref name="pageId"/> vào vị trí <paramref name="position"/> (kẹp vào [0, số trang]).</summary>
    public static List<Guid> Reorder(IReadOnlyList<Guid> siblings, Guid pageId, int position)
    {
        var list = siblings.Where(x => x != pageId).ToList();
        list.Insert(Math.Clamp(position, 0, list.Count), pageId);
        return list;
    }

    /// <summary>
    /// Đoạn trích quanh chỗ khớp đầu tiên của <paramref name="query"/> trong <paramref name="text"/> (không phân biệt hoa thường), ±<see cref="SnippetRadius"/> ký tự,
    /// gộp khoảng trắng / xuống dòng, thêm "…" khi cắt. Không khớp → đầu văn bản (tối đa 2 × bán kính). Văn bản trống → "".
    /// </summary>
    public static string Snippet(string text, string query)
    {
        if (string.IsNullOrEmpty(text)) return "";
        var q = query.Trim();
        var i = q.Length == 0 ? -1 : text.IndexOf(q, StringComparison.OrdinalIgnoreCase);
        int start, end;
        if (i < 0) { start = 0; end = Math.Min(text.Length, 2 * SnippetRadius); }
        else { start = Math.Max(0, i - SnippetRadius); end = Math.Min(text.Length, i + q.Length + SnippetRadius); }
        var sb = new StringBuilder();
        if (start > 0) sb.Append('…');
        var space = false;
        foreach (var ch in text.AsSpan(start, end - start))
        {
            if (char.IsWhiteSpace(ch)) { space = true; continue; }
            if (space && sb.Length > 0 && sb[^1] != '…') sb.Append(' ');
            space = false;
            sb.Append(ch);
        }
        if (end < text.Length) sb.Append('…');
        return sb.ToString();
    }
}
