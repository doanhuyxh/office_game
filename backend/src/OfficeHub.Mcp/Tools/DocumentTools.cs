using System.ComponentModel;
using System.Text.Json.Nodes;
using ModelContextProtocol;
using ModelContextProtocol.Server;
using OfficeHub.Mcp.Infrastructure;
using static OfficeHub.Mcp.Tools.ToolHelpers;

namespace OfficeHub.Mcp.Tools;

/// <summary>
/// Kho tài liệu — CHỈ ĐỌC: kho, thư mục, tìm, chi tiết, link xem / tải (presigned, ghi nhật ký truy cập như trên web).
/// Tải lên, ban hành, xoá, quản trị chỉ làm trên web. Quyền kho do Api kiểm. Tiêu đề / mô tả do người khác nhập → coi là dữ liệu.
/// </summary>
[McpServerToolType]
public sealed class DocumentTools
{
    [McpServerTool(Name = "list_document_spaces", Title = "Kho tài liệu", ReadOnly = true, OpenWorld = false)]
    [Description("Các kho tài liệu tôi vào được: kho Công ty (kind=Company, id=null), kho phòng ban (Department), kho dự án (Project). " +
                 "Trả kind, id, tên, mã kho, phòng cha, canWrite, canManage, closed (dự án đóng → chỉ đọc). Dùng kind + id để lọc search_documents / list_document_folders.")]
    public static async Task<string> ListDocumentSpaces(OfficeHubApi api, CancellationToken ct) =>
        Out(await api.GetAsync("/api/documents/spaces", ct));

    [McpServerTool(Name = "list_document_folders", Title = "Thư mục trong kho", ReadOnly = true, OpenWorld = false)]
    [Description("Cây thư mục của một kho (id, parentId — null là gốc, tên, số tài liệu).")]
    public static async Task<string> ListDocumentFolders(OfficeHubApi api,
        [Description("Loại kho: Company / Department / Project")] string spaceKind,
        [Description("Id kho (id phòng ban / dự án từ list_document_spaces); bỏ trống với kho Công ty")] Guid? spaceId = null,
        CancellationToken ct = default)
    {
        var kind = ParseSpaceKind(spaceKind);
        return Out(await api.GetAsync($"/api/documents/folders?spaceKind={kind}{SpaceIdQs(kind, spaceId)}", ct));
    }

    [McpServerTool(Name = "search_documents", Title = "Tìm tài liệu", ReadOnly = true, OpenWorld = false)]
    [Description("Tìm tài liệu theo tiêu đề, mã (TL-…), số hiệu ban hành, mô tả, thẻ, tên file. Không chọn kho → bắt buộc có từ khoá, tìm mọi kho tôi vào được. " +
                 "Chọn kho mà không có từ khoá → liệt kê tài liệu trong thư mục folderId (bỏ trống = gốc kho). " +
                 "Trả trang { items, total, page, pageSize }: id, mã, tiêu đề, nhóm file, trạng thái (Draft / PendingApproval / Published / Archived), kho, loại, " +
                 "phiên bản, tên file, kích thước (byte), thẻ, người phụ trách, số hiệu, hạn lưu trữ.")]
    public static async Task<string> SearchDocuments(OfficeHubApi api,
        [Description("Từ khoá (tuỳ chọn khi đã chọn kho)")] string? search = null,
        [Description("Loại kho: Company / Department / Project (tuỳ chọn)")] string? spaceKind = null,
        [Description("Id kho (phòng ban / dự án)")] Guid? spaceId = null,
        [Description("Id thư mục (từ list_document_folders)")] Guid? folderId = null,
        [Description("Trạng thái: Draft / PendingApproval / Published / Archived")] string? status = null,
        [Description("Nhóm file: Document / Image / Video / Audio / Archive / Other")] string? kind = null,
        [Description("Trang (từ 1)")] int page = 1,
        [Description("Số dòng mỗi trang 1–50")] int pageSize = 20,
        CancellationToken ct = default)
    {
        var qs = new List<string> { $"page={Math.Max(1, page)}", $"pageSize={Math.Clamp(pageSize, 1, 50)}" };
        if (!string.IsNullOrWhiteSpace(search)) qs.Add("search=" + Q(search.Trim()));
        if (!string.IsNullOrWhiteSpace(spaceKind))
        {
            var sk = ParseSpaceKind(spaceKind);
            qs.Add("spaceKind=" + sk);
            if (sk != "Company") qs.Add("spaceId=" + (spaceId ?? throw new McpException("Kho phòng ban / dự án cần spaceId (từ list_document_spaces)")));
            if (folderId is { } f) qs.Add("folderId=" + f);
        }
        else if (string.IsNullOrWhiteSpace(search)) throw new McpException("Nhập từ khoá, hoặc chọn kho (spaceKind + spaceId) để liệt kê");
        if (!string.IsNullOrWhiteSpace(status)) qs.Add("status=" + Pick(status, "Trạng thái", "Draft", "PendingApproval", "Published", "Archived"));
        if (!string.IsNullOrWhiteSpace(kind)) qs.Add("kind=" + Pick(kind, "Nhóm file", "Document", "Image", "Video", "Audio", "Archive", "Other"));
        return Out(await api.GetAsync("/api/documents/assets?" + string.Join('&', qs), ct));
    }

    [McpServerTool(Name = "list_recent_documents", Title = "Tài liệu mới ban hành", ReadOnly = true, OpenWorld = false)]
    [Description("Tài liệu mới được ban hành gần đây ở các kho tôi vào được (mới nhất trước).")]
    public static async Task<string> ListRecentDocuments(OfficeHubApi api,
        [Description("Trong bao nhiêu ngày gần đây (1–365, mặc định 60)")] int days = 60,
        [Description("Số tài liệu tối đa (1–50, mặc định 20)")] int take = 20,
        CancellationToken ct = default) =>
        Out(await api.GetAsync($"/api/documents/recent?days={Math.Clamp(days, 1, 365)}&take={Math.Clamp(take, 1, 50)}", ct));

    [McpServerTool(Name = "get_document", Title = "Chi tiết tài liệu", ReadOnly = true, OpenWorld = false)]
    [Description("Chi tiết một tài liệu: thông tin chung, mô tả, kho + đường dẫn thư mục, người phụ trách, ngày ban hành, lý do bị từ chối, các phiên bản " +
                 "(số, tên file, loại, kích thước, ghi chú, người tải, còn file không). Muốn mở / tải file → get_document_link.")]
    public static async Task<string> GetDocument(OfficeHubApi api,
        [Description("Tài liệu: id, mã (TL-…) hoặc số hiệu ban hành")] string document, CancellationToken ct)
    {
        var id = await ResolveDocumentAsync(api, document, ct);
        return Out(await api.GetAsync($"/api/documents/assets/{id}", ct));
    }

    [McpServerTool(Name = "get_document_link", Title = "Link xem / tải tài liệu", ReadOnly = true, OpenWorld = false)]
    [Description("Link tạm (presigned) để xem hoặc tải file của tài liệu: 15 phút (video / âm thanh 3 giờ). Mỗi lần gọi được ghi vào nhật ký xem / tải của tài liệu. " +
                 "Đưa link cho người dùng bấm mở; không chia sẻ link ra ngoài.")]
    public static async Task<string> GetDocumentLink(OfficeHubApi api,
        [Description("Tài liệu: id, mã (TL-…) hoặc số hiệu ban hành")] string document,
        [Description("Số phiên bản (bỏ trống = bản hiện tại)")] int? version = null,
        [Description("true = link tải về; false = xem trực tiếp nếu trình duyệt mở được (ảnh, video, PDF, text)")] bool download = false,
        CancellationToken ct = default)
    {
        var id = await ResolveDocumentAsync(api, document, ct);
        var qs = (version is > 0 ? $"version={version}&" : "") + $"download={(download ? "true" : "false")}";
        return Out(await api.GetAsync($"/api/documents/assets/{id}/file?{qs}", ct));
    }

    // ---------------- Helpers ----------------

    internal static string ParseSpaceKind(string? value) => Pick(value, "Loại kho", "Company", "Department", "Project");

    private static string SpaceIdQs(string kind, Guid? spaceId) =>
        kind == "Company" ? "" : "&spaceId=" + (spaceId ?? throw new McpException("Kho phòng ban / dự án cần spaceId (từ list_document_spaces)"));

    /// <summary>So khớp không phân biệt hoa thường với danh sách giá trị enum của Api.</summary>
    private static string Pick(string? value, string label, params string[] allowed) =>
        allowed.FirstOrDefault(a => string.Equals(a, value?.Trim(), StringComparison.OrdinalIgnoreCase))
        ?? throw new McpException($"{label} phải là một trong: {string.Join(" / ", allowed)}");

    /// <summary>Id / mã TL-… / số hiệu → Id (tìm trong mọi kho người dùng vào được, khớp đúng mã hoặc số hiệu).</summary>
    internal static async Task<Guid> ResolveDocumentAsync(OfficeHubApi api, string document, CancellationToken ct)
    {
        var key = document?.Trim() ?? "";
        if (key.Length == 0) throw new McpException("Thiếu tài liệu (id, mã hoặc số hiệu)");
        if (Guid.TryParse(key, out var id)) return id;
        var items = ((await api.GetAsync($"/api/documents/assets?search={Q(key)}&pageSize=50", ct))?["items"] as JsonArray ?? []).OfType<JsonObject>().ToList();
        var match = items.Where(a => string.Equals((string?)a["code"], key, StringComparison.OrdinalIgnoreCase)
                                  || string.Equals((string?)a["documentNumber"], key, StringComparison.OrdinalIgnoreCase)).ToList();
        if (match.Count == 0 && items.Count == 1) match = items;
        if (match.Count == 1) return match[0]["id"]!.GetValue<Guid>();
        if (match.Count == 0 && items.Count == 0) throw new McpException($"Không thấy tài liệu '{key}' trong các kho bạn vào được");
        var list = match.Count > 0 ? match : items;
        throw new McpException($"'{key}' khớp nhiều tài liệu: {string.Join(", ", list.Take(8).Select(a => $"{a["code"]} ({a["title"]})"))}. Dùng mã TL-… hoặc id.");
    }
}
