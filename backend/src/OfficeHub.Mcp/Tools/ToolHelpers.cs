using System.Globalization;
using System.Text.Json.Nodes;
using ModelContextProtocol;
using OfficeHub.Mcp.Infrastructure;

namespace OfficeHub.Mcp.Tools;

internal static class ToolHelpers
{
    public static string Out(JsonNode? node) => node?.ToJsonString(OfficeHubApi.Json) ?? "null";

    public static string Out(object value) => System.Text.Json.JsonSerializer.Serialize(value, OfficeHubApi.Json);

    /// <summary>"yyyy-MM-dd" → giữ nguyên chuỗi chuẩn hoá; sai định dạng → lỗi tiếng Việt.</summary>
    public static string Date(string? value, string label)
    {
        if (DateOnly.TryParseExact(value?.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d))
            return d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        throw new McpException($"{label} phải có dạng yyyy-MM-dd (ví dụ 2026-11-06)");
    }

    public static string? OptionalMonth(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        if (DateOnly.TryParseExact(value.Trim() + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _))
            return value.Trim();
        throw new McpException("Tháng phải có dạng yyyy-MM (ví dụ 2026-11)");
    }

    public static string Q(string value) => Uri.EscapeDataString(value);

    /// <summary>Id nhân viên từ id, mã, email hoặc họ tên (tìm qua danh bạ — <see cref="MeetingTools.ResolveEmployeeAsync"/>).</summary>
    public static async Task<Guid> EmployeeIdAsync(OfficeHubApi api, string? employee, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(employee)) throw new McpException("Thiếu nhân viên (mã, email, họ tên hoặc id)");
        var key = employee.Trim();
        return Guid.TryParse(key, out var id) ? id : await MeetingTools.ResolveEmployeeAsync(api, key, ct);
    }

    /// <summary>So khớp không phân biệt hoa thường với danh sách giá trị enum của Api.</summary>
    public static string Pick(string? value, string label, params string[] allowed) =>
        allowed.FirstOrDefault(a => string.Equals(a, value?.Trim(), StringComparison.OrdinalIgnoreCase))
        ?? throw new McpException($"{label} phải là một trong: {string.Join(" / ", allowed)}");
}
