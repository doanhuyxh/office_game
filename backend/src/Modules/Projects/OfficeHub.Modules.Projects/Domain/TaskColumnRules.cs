using System.Text.RegularExpressions;

namespace OfficeHub.Modules.Projects.Domain;

/// <summary>Cột trạng thái (thông tin đủ cho luật thuần — test không cần DB).</summary>
public sealed record ColumnInfo(Guid Id, string Name, int Position, bool IsDone, bool ApproverOnly);

/// <summary>
/// Luật cột trạng thái công việc (chủ dự án chốt 2026-11-11): tên / màu / thứ tự tự do, tối đa <see cref="MaxColumns"/> cột,
/// luôn còn ≥ 1 cột và ≥ 1 cột hoàn thành. Hàm thuần, test: tests/OfficeHub.Modules.Projects.Tests/TaskColumnRulesTests.cs.
/// </summary>
public static partial class TaskColumnRules
{
    public const int MaxColumns = 15;
    public const int MaxName = 50;
    public const string DefaultColor = "#64748b";

    /// <summary>Bảng màu gợi ý ở FE (vẫn nhận mọi mã #rrggbb).</summary>
    public static readonly string[] Palette =
        ["#64748b", "#3b82f6", "#06b6d4", "#8b5cf6", "#ec4899", "#ef4444", "#f97316", "#f59e0b", "#84cc16", "#22c55e"];

    /// <summary>4 cột khi tạo dự án mới: Cần làm · Đang làm · Chờ review · Xong (hoàn thành + cần người duyệt).</summary>
    public static List<TaskColumn> Defaults(Guid projectId) =>
    [
        new() { ProjectId = projectId, Name = "Cần làm", Position = 0, Color = "#64748b" },
        new() { ProjectId = projectId, Name = "Đang làm", Position = 1, Color = "#3b82f6" },
        new() { ProjectId = projectId, Name = "Chờ review", Position = 2, Color = "#f59e0b" },
        new() { ProjectId = projectId, Name = "Xong", Position = 3, Color = "#22c55e", IsDone = true, ApproverOnly = true },
    ];

    /// <summary>
    /// Việc "đang làm" (bot ngồi bàn trong văn phòng 3D, 2026-11-13): không ở cột đầu (chưa bắt đầu), không ở cột hoàn thành / cần duyệt,
    /// không còn việc phải chờ, và cột không phải cột chờ — tên (bỏ dấu) có "review" / "duyet" / "nghiem thu" hoặc bắt đầu bằng "cho "
    /// (vd "Chờ review": phần của người làm đã xong, đang chờ người duyệt → tính là rảnh).
    /// </summary>
    public static bool IsInProgress(string columnName, int position, bool isDone, bool approverOnly, bool completed, int waitingOn)
    {
        if (position == 0 || isDone || approverOnly || completed || waitingOn > 0) return false;
        var n = OfficeHub.BuildingBlocks.Text.PersonSearch.Fold(columnName).Trim();
        return !(n.Contains("review") || n.Contains("duyet") || n.Contains("nghiem thu") || n.StartsWith("cho ") || n == "cho");
    }

    [GeneratedRegex("^#[0-9a-fA-F]{6}$")]
    private static partial Regex HexColor();

    public static bool IsValidColor(string? c) => c is not null && HexColor().IsMatch(c);

    public static string NormalizeName(string? name) => string.Join(' ', (name ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries));

    /// <summary>Lỗi tên cột (null = hợp lệ). Trùng tên không phân biệt hoa thường trong cùng dự án.</summary>
    public static string? NameError(string name, IEnumerable<ColumnInfo> columns, Guid? selfId)
    {
        if (name.Length == 0) return "Nhập tên trạng thái";
        if (name.Length > MaxName) return $"Tên trạng thái tối đa {MaxName} ký tự";
        return columns.Any(c => c.Id != selfId && string.Equals(c.Name, name, StringComparison.OrdinalIgnoreCase)) ? "Tên trạng thái đã có trong dự án" : null;
    }

    public static string? AddError(int count) => count >= MaxColumns ? $"Một dự án tối đa {MaxColumns} trạng thái" : null;

    /// <summary>Bỏ cờ hoàn thành ở cột hoàn thành cuối cùng → lỗi.</summary>
    public static string? UnsetDoneError(ColumnInfo self, bool isDone, IEnumerable<ColumnInfo> columns) =>
        self.IsDone && !isDone && !columns.Any(c => c.Id != self.Id && c.IsDone) ? "Dự án cần ít nhất một trạng thái hoàn thành" : null;

    /// <summary>Xoá cột: còn ≥ 1 cột, còn ≥ 1 cột hoàn thành, cột còn việc phải chọn cột nhận việc (khác cột bị xoá, cùng dự án).</summary>
    public static string? DeleteError(ColumnInfo self, IReadOnlyList<ColumnInfo> columns, bool hasTasks, Guid? moveTo)
    {
        if (columns.Count <= 1) return "Dự án cần ít nhất một trạng thái";
        if (self.IsDone && !columns.Any(c => c.Id != self.Id && c.IsDone)) return "Không xoá trạng thái hoàn thành cuối cùng";
        if (moveTo is { } m && (m == self.Id || columns.All(c => c.Id != m))) return "Trạng thái nhận việc không hợp lệ";
        return hasTasks && moveTo is null ? "Trạng thái còn công việc — chọn trạng thái để chuyển việc sang" : null;
    }

    /// <summary>Thứ tự mới phải là hoán vị đúng của các cột hiện có.</summary>
    public static bool IsPermutation(IReadOnlyList<Guid> ids, IEnumerable<ColumnInfo> columns)
    {
        var have = columns.Select(c => c.Id).ToHashSet();
        return ids.Count == have.Count && ids.Distinct().Count() == ids.Count && ids.All(have.Contains);
    }
}
