using System.Security.Claims;

namespace OfficeHub.BuildingBlocks.Auth;

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
        ("GET", "/api/notifications"),
        ("POST", "/api/notifications/"),
    ];

    /// <summary>
    /// Khớp theo đoạn path: "/api/leave/requests" cho phép chính nó và "/api/leave/requests/my",
    /// nhưng "/api/leave/balance" KHÔNG mở "/api/leave/balances" (danh sách quỹ phép mọi người — HR).
    /// Tiền tố kết thúc bằng "/" chỉ cho phép đường dẫn con.
    /// </summary>
    public static bool IsAllowed(string method, string? path)
    {
        if (string.IsNullOrEmpty(path)) return false;
        if (path.Contains("..", StringComparison.Ordinal)) return false;
        foreach (var (m, p) in Allowed)
        {
            if (!string.Equals(m, method, StringComparison.OrdinalIgnoreCase)) continue;
            if (!path.StartsWith(p, StringComparison.OrdinalIgnoreCase)) continue;
            if (p.EndsWith('/') || path.Length == p.Length || path[p.Length] == '/') return true;
        }
        return false;
    }
}
