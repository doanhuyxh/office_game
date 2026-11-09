using System.ComponentModel;
using System.Text.Json.Nodes;
using ModelContextProtocol;
using ModelContextProtocol.Server;
using OfficeHub.Mcp.Infrastructure;
using static OfficeHub.Mcp.Tools.ToolHelpers;

namespace OfficeHub.Mcp.Tools;

/// <summary>
/// Sửa mô tả ngắn + hướng dẫn chi tiết (Markdown) của phòng ban / chức vụ — nội dung mọi nhân viên và trợ lý AI đọc được (get_department, get_position, get_my_role).
/// Phòng ban: HR hoặc trưởng phòng đó; chức vụ: chỉ HR — Api (GuideEndpoints) kiểm tra, trả 403 nếu không đủ quyền. Lịch sử: Department / Position có [Audited].
/// </summary>
[McpServerToolType]
public sealed class OrgGuideTools
{
    /// <summary>Khớp OrgGuide.DescriptionMax / GuideMax ở module Organization (Mcp không tham chiếu module — Api vẫn kiểm tra lại).</summary>
    internal const int DescriptionMax = 2_000, GuideMax = 40_000;

    private const string Confirm = "Chỉ truyền ô cần đổi — ô bỏ trống giữ nguyên; \"none\" = xoá trắng ô đó. " +
        "Nội dung công khai cho mọi nhân viên + trợ lý AI: không ghi lương, mật khẩu, thông tin cá nhân. " +
        "Gọi get_department / get_position xem nội dung hiện tại, cho người dùng xem bản mới (hoặc tóm tắt thay đổi) và chờ đồng ý trước khi gọi.";

    [McpServerTool(Name = "update_department_guide", Title = "Sửa hướng dẫn phòng ban", Destructive = false, Idempotent = true, OpenWorld = false)]
    [Description("(HR hoặc trưởng phòng đó) Sửa mô tả ngắn (≤ 2.000 ký tự) và / hoặc hướng dẫn chi tiết Markdown (≤ 40.000 ký tự: ## tiêu đề, - gạch đầu dòng, **đậm**) " +
                 "của một phòng ban. Hướng dẫn mới THAY THẾ TOÀN BỘ nội dung cũ — muốn thêm một mục thì gửi lại cả bài đã ghép. " + Confirm)]
    public static async Task<string> UpdateDepartmentGuide(OfficeHubApi api,
        [Description("Phòng ban: id, tên hoặc mã (khớp đúng)")] string department,
        [Description("Mô tả ngắn mới (vd \"Phụ trách tuyển dụng, chấm công, chính sách nhân sự\"); \"none\" = xoá")] string? description = null,
        [Description("Hướng dẫn chi tiết mới (Markdown, thay toàn bộ); \"none\" = xoá")] string? guide = null,
        CancellationToken ct = default)
    {
        var all = ((await api.GetAsync("/api/org/departments", ct)) as JsonArray ?? []).OfType<JsonObject>().ToList();
        var id = DepartmentAdminTools.Resolve(all, department, partial: false);
        return await SaveAsync(api, $"/api/org/departments/{id}", description, guide, ct);
    }

    [McpServerTool(Name = "update_position_guide", Title = "Sửa hướng dẫn chức vụ (HR)", Destructive = false, Idempotent = true, OpenWorld = false)]
    [Description("(HR) Sửa mô tả ngắn (≤ 2.000 ký tự) và / hoặc hướng dẫn chi tiết Markdown (≤ 40.000 ký tự: trách nhiệm, quyền hạn, KPI, kỹ năng) " +
                 "của một chức vụ / cấp bậc. Hướng dẫn mới THAY THẾ TOÀN BỘ nội dung cũ. " + Confirm)]
    public static async Task<string> UpdatePositionGuide(OfficeHubApi api,
        [Description("Chức vụ: id hoặc tên (khớp đúng, từ list_positions)")] string position,
        [Description("Mô tả ngắn mới; \"none\" = xoá")] string? description = null,
        [Description("Hướng dẫn chi tiết mới (Markdown, thay toàn bộ); \"none\" = xoá")] string? guide = null,
        CancellationToken ct = default)
    {
        var all = ((await api.GetAsync("/api/org/positions", ct)) as JsonArray ?? []).OfType<JsonObject>().ToList();
        var id = ResolvePosition(all, position);
        return await SaveAsync(api, $"/api/org/positions/{id}", description, guide, ct);
    }

    private static async Task<string> SaveAsync(OfficeHubApi api, string path, string? description, string? guide, CancellationToken ct)
    {
        if (description is null && guide is null) throw new McpException("Không có gì để sửa — truyền description và / hoặc guide");
        var cur = (await api.GetAsync(path, ct))?["guide"] as JsonObject;
        var (desc, body) = Merge((string?)cur?["description"], (string?)cur?["guide"], description, guide);
        var saved = await api.PutAsync($"{path}/guide", new { description = desc, guide = body }, ct);
        return Out(new JsonObject { ["before"] = cur?.DeepClone(), ["after"] = saved?.DeepClone() });
    }

    /// <summary>Ghép nội dung hiện tại với tham số: null = giữ nguyên, "none" = xoá, còn lại = thay. Quá dài → McpException (Api cũng chặn lại).</summary>
    internal static (string? Description, string? Guide) Merge(string? curDesc, string? curGuide, string? description, string? guide)
    {
        static string? Pick(string? cur, string? next) => next is null ? cur : next.Trim().ToLowerInvariant() is "none" or "không" ? null : next;
        var d = Pick(curDesc, description);
        var g = Pick(curGuide, guide);
        if (d?.Trim().Length > DescriptionMax) throw new McpException($"Mô tả ngắn tối đa {DescriptionMax:N0} ký tự (đang {d.Trim().Length:N0})");
        if (g?.Trim().Length > GuideMax) throw new McpException($"Hướng dẫn tối đa {GuideMax:N0} ký tự (đang {g.Trim().Length:N0}) — rút gọn hoặc tách bớt");
        return (d, g);
    }

    /// <summary>Id / tên chức vụ → Id (khớp đúng, không phân biệt hoa thường).</summary>
    internal static Guid ResolvePosition(IReadOnlyList<JsonObject> all, string key)
    {
        var k = key?.Trim() ?? "";
        if (k.Length == 0) throw new McpException("Thiếu chức vụ (id hoặc tên)");
        if (Guid.TryParse(k, out var id))
            return all.Any(p => Guid.TryParse((string?)p["id"], out var g) && g == id) ? id : throw new McpException($"Không có chức vụ id {id}");
        var match = all.Where(p => string.Equals((string?)p["name"], k, StringComparison.OrdinalIgnoreCase)).ToList();
        if (match.Count == 1) return Guid.Parse((string)match[0]["id"]!);
        if (match.Count == 0) throw new McpException($"Không có chức vụ '{k}' — gọi list_positions để xem danh sách");
        throw new McpException($"'{k}' khớp nhiều chức vụ — dùng id");
    }
}
