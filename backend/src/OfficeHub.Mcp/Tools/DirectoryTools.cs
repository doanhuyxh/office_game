using System.ComponentModel;
using System.Text.Json.Nodes;
using ModelContextProtocol.Server;
using OfficeHub.Mcp.Infrastructure;
using static OfficeHub.Mcp.Tools.ToolHelpers;

namespace OfficeHub.Mcp.Tools;

[McpServerToolType]
public sealed class DirectoryTools
{
    [McpServerTool(Name = "search_colleagues", Title = "Tìm đồng nghiệp", ReadOnly = true, OpenWorld = false)]
    [Description("Danh bạ công ty: tìm nhân viên theo tên, mã hoặc email; lọc theo phòng ban. Trả về id, mã, họ tên, email, điện thoại, " +
                 "phòng ban, chức vụ, quản lý trực tiếp, trạng thái.")]
    public static async Task<string> SearchColleagues(OfficeHubApi api,
        [Description("Từ khoá: tên, mã nhân viên hoặc email; bỏ trống = tất cả")] string? search = null,
        [Description("Id phòng ban (từ list_departments)")] Guid? departmentId = null,
        CancellationToken ct = default)
    {
        var qs = new List<string>();
        if (!string.IsNullOrWhiteSpace(search)) qs.Add("search=" + Q(search.Trim()));
        if (departmentId is { } d) qs.Add("departmentId=" + d);
        var rows = await api.GetAsync("/api/org/employees" + (qs.Count > 0 ? "?" + string.Join('&', qs) : ""), ct) as JsonArray ?? [];
        // Chỉ trả trường danh bạ: bỏ thông tin tài khoản đăng nhập (HR mới thấy trên web) cho gọn và đỡ lộ.
        string[] keep = ["id", "code", "fullName", "email", "phone", "departmentName", "positionName", "managerId", "managerName", "status"];
        var result = new JsonArray();
        foreach (var r in rows.OfType<JsonObject>())
        {
            var o = new JsonObject();
            foreach (var k in keep) o[k] = r[k]?.DeepClone();
            result.Add(o);
        }
        return Out(result);
    }

    [McpServerTool(Name = "list_departments", Title = "Phòng ban", ReadOnly = true, OpenWorld = false)]
    [Description("Danh sách phòng ban (id, tên, trưởng phòng, số nhân viên).")]
    public static async Task<string> ListDepartments(OfficeHubApi api, CancellationToken ct)
    {
        var rows = await api.GetAsync("/api/org/departments", ct) as JsonArray ?? [];
        string[] keep = ["id", "name", "code", "parentId", "headName", "employeeCount"];
        var result = new JsonArray();
        foreach (var r in rows.OfType<JsonObject>())
        {
            var o = new JsonObject();
            foreach (var k in keep) o[k] = r[k]?.DeepClone();
            result.Add(o);
        }
        return Out(result);
    }
}
