using System.ComponentModel;
using System.Text.Json.Nodes;
using ModelContextProtocol;
using ModelContextProtocol.Server;
using OfficeHub.Mcp.Infrastructure;
using static OfficeHub.Mcp.Tools.ToolHelpers;

namespace OfficeHub.Mcp.Tools;

/// <summary>
/// Quản lý phòng ban — CHỈ HR / admin (Api trả 403 với người khác). Tạo, sửa (tên, mã, phòng cha, trưởng phòng, thứ tự), xoá mềm.
/// Mô tả + hướng dẫn: OrgGuideTools. Chuyển nhân viên giữa phòng ban vẫn làm trên web. Mọi thay đổi ghi vào "Lịch sử thay đổi" (Department có [Audited]).
/// </summary>
[McpServerToolType]
public sealed class DepartmentAdminTools
{
    [McpServerTool(Name = "create_department", Title = "Tạo phòng ban (HR)", Destructive = false, OpenWorld = false)]
    [Description("(HR) Tạo phòng ban mới. Tên không trùng phòng khác. Gọi list_departments trước để chọn phòng cha / tránh trùng, " +
                 "rồi XÁC NHẬN tên, mã, phòng cha, trưởng phòng với người dùng trước khi gọi.")]
    public static async Task<string> CreateDepartment(OfficeHubApi api,
        [Description("Tên phòng ban (≤ 150 ký tự, không trùng)")] string name,
        [Description("Mã phòng ban (tuỳ chọn, vd KT) — dùng làm mã kho tài liệu")] string? code = null,
        [Description("Phòng cha: id, tên hoặc mã phòng ban (tuỳ chọn; bỏ trống = cấp cao nhất)")] string? parent = null,
        [Description("Trưởng phòng: mã nhân viên, email hoặc họ tên (tuỳ chọn)")] string? head = null,
        [Description("Thứ tự hiển thị (số nhỏ đứng trước)")] int sortOrder = 0,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(name)) throw new McpException("Thiếu tên phòng ban");
        var all = await ListAsync(api, ct);
        var id = await api.PostAsync("/api/org/departments", new
        {
            name = name.Trim(),
            code = Blank(code),
            parentId = string.IsNullOrWhiteSpace(parent) ? (Guid?)null : Resolve(all, parent),
            headEmployeeId = string.IsNullOrWhiteSpace(head) ? (Guid?)null : await MeetingTools.ResolveEmployeeAsync(api, head.Trim(), ct),
            mapZone = (string?)null,
            sortOrder,
        }, ct);
        return Out(await FindAsync(api, G(id), ct));
    }

    [McpServerTool(Name = "update_department", Title = "Sửa phòng ban (HR)", Destructive = false, Idempotent = true, OpenWorld = false)]
    [Description("(HR) Sửa phòng ban: đổi tên, mã, phòng cha, trưởng phòng, thứ tự. Chỉ truyền trường cần đổi — trường bỏ trống giữ nguyên. " +
                 "Bỏ phòng cha: parent = \"none\"; bỏ trưởng phòng: head = \"none\". Không chọn được phòng con làm phòng cha. " +
                 "Tóm tắt thay đổi (cũ → mới) và chờ người dùng đồng ý trước khi gọi.")]
    public static async Task<string> UpdateDepartment(OfficeHubApi api,
        [Description("Phòng ban cần sửa: id, tên hoặc mã")] string department,
        [Description("Tên mới")] string? name = null,
        [Description("Mã mới (\"none\" = xoá mã)")] string? code = null,
        [Description("Phòng cha mới: id, tên hoặc mã; \"none\" = lên cấp cao nhất")] string? parent = null,
        [Description("Trưởng phòng mới: mã nhân viên, email hoặc họ tên; \"none\" = bỏ trưởng phòng")] string? head = null,
        [Description("Thứ tự hiển thị mới")] int? sortOrder = null,
        CancellationToken ct = default)
    {
        var all = await ListAsync(api, ct);
        var id = Resolve(all, department, partial: false);
        var cur = all.First(d => G(d["id"]) == id);
        var body = new
        {
            name = string.IsNullOrWhiteSpace(name) ? (string?)cur["name"] : name.Trim(),
            code = code is null ? (string?)cur["code"] : IsNone(code) ? null : Blank(code),
            parentId = parent is null ? G(cur["parentId"]) : IsNone(parent) ? null : Resolve(all, parent),
            headEmployeeId = head is null ? G(cur["headEmployeeId"])
                : IsNone(head) ? null : await MeetingTools.ResolveEmployeeAsync(api, head.Trim(), ct),
            mapZone = (string?)cur["mapZone"], // vùng trên bản đồ 3D: giữ nguyên, chỉ sửa trên web
            sortOrder = sortOrder ?? cur["sortOrder"]?.GetValue<int>() ?? 0,
        };
        await api.PutAsync($"/api/org/departments/{id}", body, ct);
        return Out(new JsonObject { ["before"] = cur.DeepClone(), ["after"] = await FindAsync(api, id, ct) });
    }

    [McpServerTool(Name = "delete_department", Title = "Xoá phòng ban (HR)", Destructive = true, Idempotent = false, OpenWorld = false)]
    [Description("(HR) Xoá (mềm) một phòng ban. Hệ thống từ chối nếu còn phòng ban con hoặc còn nhân viên đang làm — chuyển họ đi trên web trước. " +
                 "Hỏi người dùng xác nhận rõ ràng (nêu tên phòng) trước khi gọi.")]
    public static async Task<string> DeleteDepartment(OfficeHubApi api,
        [Description("Phòng ban cần xoá: id, tên hoặc mã")] string department, CancellationToken ct = default)
    {
        var all = await ListAsync(api, ct);
        var id = Resolve(all, department, partial: false);
        await api.DeleteAsync($"/api/org/departments/{id}", ct);
        return Out(new { ok = true, deleted = all.First(d => G(d["id"]) == id)["name"]?.GetValue<string>() });
    }

    // ---------------- Helpers ----------------

    private static async Task<List<JsonObject>> ListAsync(OfficeHubApi api, CancellationToken ct) =>
        ((await api.GetAsync("/api/org/departments", ct)) as JsonArray ?? []).OfType<JsonObject>().ToList();

    private static async Task<JsonNode?> FindAsync(OfficeHubApi api, Guid? id, CancellationToken ct) =>
        id is null ? null : (await ListAsync(api, ct)).FirstOrDefault(d => G(d["id"]) == id)?.DeepClone();

    private static Guid? G(JsonNode? n) => Guid.TryParse((string?)n, out var g) ? g : null;

    private static bool IsNone(string v) => v.Trim().ToLowerInvariant() is "none" or "không" or "khong" or "-";

    private static string? Blank(string? v) => string.IsNullOrWhiteSpace(v) ? null : v.Trim();

    /// <summary>Id / tên / mã phòng ban → Id (khớp đúng, không phân biệt hoa thường).</summary>
    internal static Guid Resolve(IReadOnlyList<JsonObject> all, string key, bool partial = true)
    {
        var k = key?.Trim() ?? "";
        if (k.Length == 0) throw new McpException("Thiếu phòng ban (id, tên hoặc mã)");
        if (Guid.TryParse(k, out var id))
            return all.Any(d => G(d["id"]) == id) ? id : throw new McpException($"Không có phòng ban id {id}");
        var match = all.Where(d => string.Equals((string?)d["name"], k, StringComparison.OrdinalIgnoreCase)
                                || string.Equals((string?)d["code"], k, StringComparison.OrdinalIgnoreCase)).ToList();
        if (match.Count == 0 && partial) match = all.Where(d => ((string?)d["name"])?.Contains(k, StringComparison.OrdinalIgnoreCase) == true).ToList();
        if (match.Count == 1) return G(match[0]["id"])!.Value;
        if (match.Count == 0) throw new McpException($"Không có phòng ban '{k}' — gọi list_departments để xem danh sách");
        throw new McpException($"'{k}' khớp nhiều phòng ban: {string.Join(", ", match.Take(8).Select(d => $"{d["name"]} ({d["code"]})"))}. Dùng tên đầy đủ hoặc mã.");
    }
}
