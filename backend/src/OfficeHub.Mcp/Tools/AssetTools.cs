using System.ComponentModel;
using ModelContextProtocol;
using ModelContextProtocol.Server;
using OfficeHub.Mcp.Infrastructure;
using static OfficeHub.Mcp.Tools.ToolHelpers;

namespace OfficeHub.Mcp.Tools;

/// <summary>
/// Tài sản công ty — CHỈ ĐỌC. Api tự kiểm quyền (nhân viên: của mình; quản lý: cấp dưới; HR: mọi người). Cấp phát / thu hồi / rà soát chỉ làm trên web.
/// Không có mật khẩu tài khoản trong hệ thống.
/// </summary>
[McpServerToolType]
public sealed class AssetTools
{
    [McpServerTool(Name = "get_my_assets", Title = "Tài sản của tôi", ReadOnly = true, OpenWorld = false)]
    [Description("Tài sản công ty đang giao cho tôi: thiết bị (mã, tên, loại, serial, ngày nhận) và tài khoản dịch vụ như Figma, Google Workspace… " +
                 "(dịch vụ, tên đăng nhập, vai trò, ngày cấp). Không có giá và không có mật khẩu.")]
    public static async Task<string> GetMyAssets(OfficeHubApi api, CancellationToken ct) =>
        Out(await api.GetAsync("/api/assets/my", ct));

    [McpServerTool(Name = "get_employee_assets", Title = "Tài sản của một nhân viên", ReadOnly = true, OpenWorld = false)]
    [Description("(Quản lý / HR) Thiết bị và tài khoản dịch vụ một nhân viên đang giữ. Quản lý chỉ xem được bản thân và cấp dưới; không đủ quyền trả 404.")]
    public static async Task<string> GetEmployeeAssets(OfficeHubApi api, [Description("Id nhân viên (từ search_colleagues)")] Guid employeeId, CancellationToken ct)
    {
        if (employeeId == Guid.Empty) throw new McpException("Thiếu employeeId");
        return Out(await api.GetAsync($"/api/assets/employees/{employeeId}/holdings", ct));
    }
}
