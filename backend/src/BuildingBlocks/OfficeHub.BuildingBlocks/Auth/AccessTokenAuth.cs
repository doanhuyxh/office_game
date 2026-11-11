using System.Security.Claims;
using Microsoft.AspNetCore.Http;

namespace OfficeHub.BuildingBlocks.Auth;

/// <summary>Ai đang gọi bằng token AI. <c>ClientName</c> = tên token cá nhân hoặc tên ứng dụng OAuth.</summary>
public sealed record AccessTokenCaller(Guid UserId, Guid TokenId, string ClientName, bool ViaOAuth);

/// <summary>Cấu hình token AI. Tắt <c>AccessTokens__Enabled</c> = mọi token / ứng dụng AI bị từ chối ngay (công tắc toàn công ty).</summary>
public sealed class AccessTokenSettings
{
    public const string Section = "AccessTokens";
    public bool Enabled { get; set; } = true;
    /// <summary>Giới hạn request / phút cho mỗi token (Api trả 429 khi vượt).</summary>
    [System.ComponentModel.DataAnnotations.Range(10, 10000)] public int RequestsPerMinute { get; set; } = 120;
}

/// <summary>
/// Token truy cập cá nhân (PAT) cho trợ lý AI qua MCP: <c>Authorization: Bearer ohk_…</c>.
/// Nhân viên tự tạo / thu hồi ở trang "Kết nối AI". Token mang đúng quyền của chủ tài khoản,
/// nhưng CHỈ dùng được cho các route trong <see cref="IsAllowed"/> (không hợp đồng / lương, không quản trị tài khoản).
/// </summary>
public static class AccessTokenAuth
{
    public const string Scheme = "AccessToken";
    /// <summary>Scheme mặc định của Api: chọn <see cref="Scheme"/> khi có Bearer, ngược lại dùng cookie.</summary>
    public const string SelectorScheme = "OfficeHub";
    public const string TokenPrefix = "ohk_";
    public const string TokenIdClaim = "access_token_id";
    /// <summary>Header OfficeHub.Mcp gửi kèm: tên tool MCP đang chạy (ghi vào audit log).</summary>
    public const string ToolHeader = "X-Mcp-Tool";
    /// <summary>HttpContext.Items: <see cref="AccessTokenCaller"/> của request dùng token (kể cả khi route bị chặn) — module Audit đọc.</summary>
    public const string CallerItemKey = "officehub.access_token.caller";

    /// <summary>Request này được xác thực bằng token AI (không phải cookie trình duyệt).</summary>
    public static bool IsAccessToken(this ClaimsPrincipal user) => user.Identity?.AuthenticationType == Scheme;

    public static bool HasBearerToken(string? authorizationHeader) =>
        authorizationHeader is not null && authorizationHeader.StartsWith("Bearer " + TokenPrefix, StringComparison.Ordinal);

    // Danh sách cho phép (method, tiền tố path). Mặc định CHẶN: route mới phải chủ động thêm vào đây.
    // Cố ý không có: /api/contracts (hợp đồng, lương), /api/auth/* trừ /me (đổi mật khẩu, quản lý token),
    // ghi của /api/org (tạo nhân viên, cấp tài khoản, vai trò), ca / lịch / ngày lễ (HR), điều chỉnh phép (HR).
    private static readonly (string Method, string Path)[] Allowed =
    [
        ("GET", "/api/auth/me"),
        ("GET", "/api/org/employees"),
        ("GET", "/api/org/departments"),
        ("GET", "/api/org/positions"),
        ("GET", "/api/attendance/today"),
        ("POST", "/api/attendance/check"),
        ("GET", "/api/attendance/my"),
        ("GET", "/api/attendance/board"),
        ("GET", "/api/attendance/report"),
        ("GET", "/api/attendance/employees/"),
        ("GET", "/api/attendance/shifts"),
        ("GET", "/api/attendance/holidays"),
        ("GET", "/api/attendance/overtime"),
        ("POST", "/api/attendance/overtime"),
        ("GET", "/api/attendance/corrections/my"),
        ("POST", "/api/attendance/corrections"),
        ("GET", "/api/leave/types"),
        ("GET", "/api/leave/balance"),
        ("GET", "/api/leave/preview"),
        ("GET", "/api/leave/requests"),
        ("POST", "/api/leave/requests"),
        ("GET", "/api/approval/"),
        ("POST", "/api/approval/"),
        ("GET", "/api/meetings"),
        ("POST", "/api/meetings/bookings"),
        ("DELETE", "/api/meetings/bookings/"),
        // Bảng tin: ĐỌC (feed, bài, bình luận) — endpoint tự bỏ HTML + link tệp khi gọi bằng token AI. Đăng bài: xem AllowedExact (chỉ admin / HR).
        // Bình luận / cảm xúc / sửa / xoá / tải tệp chỉ làm trên web.
        ("GET", "/api/news/feed"),
        ("GET", "/api/news/posts/"),
        // Tài sản: chỉ ĐỌC (tài sản của mình; của cấp dưới nếu là quản lý — API tự kiểm quyền). Cấp / thu hồi chỉ làm trên web.
        ("GET", "/api/assets/my"),
        ("GET", "/api/assets/employees/"),
        ("GET", "/api/notifications"),
        ("POST", "/api/notifications/"),
    ];

    // Route có Id ở giữa (không diễn tả được bằng tiền tố) → khớp NGUYÊN path bằng mẫu. {id} = Guid.
    // Dự án: đọc dự án / việc (+ bình luận, lịch sử) / ngày công (không tiền), ghi CHỈ tạo / sửa việc, chuyển trạng thái việc (theo quy trình), bình luận.
    //   Cố ý không có: tài chính (/financials), đợt thu / HĐ bán (/installments, /sales-contracts), CR (/change-requests),
    //   thành viên, phân bổ %, mốc nghiệm thu, tạo / sửa dự án (gồm hướng dẫn làm việc), xoá việc.
    // Tài liệu: chỉ ĐỌC (kho, thư mục, tìm, chi tiết, link xem / tải — ghi nhật ký truy cập). Không tải lên, ban hành, xoá, quản trị.
    private const string Id = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
    private static readonly (string Method, System.Text.RegularExpressions.Regex Path)[] AllowedExact =
    [
        ("GET", Exact("/api/projects/?")),
        ("GET", Exact($"/api/projects/{Id}")),
        ("GET", Exact($"/api/projects/{Id}/(tasks|effort|columns)")),
        ("GET", Exact("/api/projects/tasks/mine")),
        ("GET", Exact($"/api/projects/tasks/{Id}(/comments)?")),
        ("PUT", Exact($"/api/projects/tasks/{Id}")),
        ("POST", Exact($"/api/projects/{Id}/tasks")),
        ("POST", Exact($"/api/projects/tasks/{Id}/(move|comments)")),
        ("PUT", Exact($"/api/projects/tasks/{Id}/dependencies")), // việc phải chờ (2026-11-11, đội agent chuyền việc)
        // Phòng ban (HR — Api tự yêu cầu AuthPolicies.Hr): tạo / sửa / xoá mềm.
        ("POST", Exact("/api/org/departments/?")),
        ("PUT", Exact($"/api/org/departments/{Id}")),
        ("DELETE", Exact($"/api/org/departments/{Id}")),
        // Mô tả + hướng dẫn (2026-11-09): phòng ban = HR hoặc trưởng phòng đó, chức vụ = chỉ HR — Api (GuideEndpoints) tự kiểm tra.
        ("PUT", Exact($"/api/org/(departments|positions)/{Id}/guide")),
        // Bảng tin: đăng bài (Api trả 403 nếu không phải admin / HR, không đính kèm tệp). Sửa / xoá / bình luận / kiểm duyệt vẫn chỉ trên web.
        ("POST", Exact("/api/news/posts/?")),
        ("GET", Exact("/api/documents/(spaces|folders|assets|recent)")),
        ("GET", Exact($"/api/documents/assets/{Id}(/file)?")),
        // Chat (2026-11-11): CHỈ tài khoản bot (Api tự trả 403 cho người thật), kênh Toàn văn phòng + 1-1 người khác đã mở.
        //   Không có: mở 1-1 mới, kênh phòng (Api trả 404), tải tệp, thu hồi, tìm người.
        ("GET", Exact("/api/chat/(conversations|unread-count)")),
        ("GET", Exact($"/api/chat/conversations/(office|{Id})/messages")),
        ("POST", Exact($"/api/chat/conversations/(office|{Id})/(messages|read)")),
    ];

    private static System.Text.RegularExpressions.Regex Exact(string pattern) =>
        new($@"\A{pattern}\z",System.Text.RegularExpressions.RegexOptions.IgnoreCase | System.Text.RegularExpressions.RegexOptions.CultureInvariant
                            | System.Text.RegularExpressions.RegexOptions.Compiled);

    /// <summary>
    /// Khớp theo đoạn path: "/api/leave/requests" cho phép chính nó và "/api/leave/requests/my",
    /// nhưng "/api/leave/balance" KHÔNG mở "/api/leave/balances" (danh sách quỹ phép mọi người — HR).
    /// Tiền tố kết thúc bằng "/" chỉ cho phép đường dẫn con.
    /// </summary>
    public static bool IsAllowed(string method, string? path)
    {
        if (string.IsNullOrEmpty(path)) return false;
        if (path.Contains("..", StringComparison.Ordinal)) return false;
        // Trao quyền duyệt thay (tạo / thu hồi uỷ quyền) chỉ làm trên web, không qua token AI; xem danh sách thì được.
        if (!HttpMethods.IsGet(method) && path.StartsWith("/api/approval/delegations", StringComparison.OrdinalIgnoreCase)) return false;
        foreach (var (m, p) in Allowed)
        {
            if (!string.Equals(m, method, StringComparison.OrdinalIgnoreCase)) continue;
            if (!path.StartsWith(p, StringComparison.OrdinalIgnoreCase)) continue;
            if (p.EndsWith('/') || path.Length == p.Length || path[p.Length] == '/') return true;
        }
        foreach (var (m, re) in AllowedExact)
            if (string.Equals(m, method, StringComparison.OrdinalIgnoreCase) && re.IsMatch(path)) return true;
        return false;
    }
}
