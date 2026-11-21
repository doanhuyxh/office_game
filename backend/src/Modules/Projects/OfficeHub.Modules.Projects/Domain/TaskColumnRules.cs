using System.Text.RegularExpressions;

namespace OfficeHub.Modules.Projects.Domain;

/// <summary>Cột trạng thái (thông tin đủ cho luật thuần — test không cần DB).</summary>
/// <param name="WakeFollowers">Cột "Đánh thức bot theo dõi" (TEST-178) — việc vào đây thì đánh thức bot theo dõi việc (<see cref="FollowerWakeRules"/>).</param>
/// <param name="WakeBotIds">TEST-184: bot (Id nhân viên) được đánh thức ở cột này; null / rỗng = mọi bot theo dõi việc.</param>
/// <param name="UnblocksDependents">TEST-199: "Việc sau được bắt đầu từ cột này" — việc trước tới đây là việc đang chờ nó được bắt đầu (<see cref="DependencyRules.ReadyColumnIds"/>).</param>
public sealed record ColumnInfo(Guid Id, string Name, int Position, bool IsDone, bool ApproverOnly, bool WakeFollowers = false, IReadOnlyList<Guid>? WakeBotIds = null,
    bool UnblocksDependents = false);

/// <summary>
/// Luật cột trạng thái công việc (chủ dự án chốt 2026-11-11): tên / màu / thứ tự tự do, tối đa <see cref="MaxColumns"/> cột,
/// luôn còn ≥ 1 cột và ≥ 1 cột hoàn thành. Hàm thuần, test: tests/OfficeHub.Modules.Projects.Tests/TaskColumnRulesTests.cs.
/// </summary>
public static partial class TaskColumnRules
{
    public const int MaxColumns = 15;
    public const int MaxName = 50;
    public const string DefaultColor = "#64748b";
    /// <summary>Độ dài tối đa hướng dẫn của cột (TEST-186).</summary>
    public const int MaxGuide = 10_000;

    /// <summary>Chuẩn hoá hướng dẫn cột: CRLF → LF, trim, rỗng → null (như <c>OrgGuide.Clean</c>).</summary>
    public static string? CleanGuide(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Replace("\r\n", "\n").Trim();

    /// <summary>Lỗi hướng dẫn cột (null = hợp lệ): quá dài, hoặc có nội dung mà cột không bật "Đánh thức bot theo dõi".
    /// <paramref name="guide"/> null = không gửi (giữ nguyên) → không kiểm.</summary>
    public static string? GuideError(string? guide, bool wakeFollowers)
    {
        var clean = CleanGuide(guide);
        if (clean is null) return null;
        if (clean.Length > MaxGuide) return $"Hướng dẫn tối đa {MaxGuide:N0} ký tự";
        return wakeFollowers ? null : "Bật \"Đánh thức bot theo dõi\" để soạn hướng dẫn cho cột";
    }

    /// <summary>Hướng dẫn đang có hiệu lực của cột: chỉ khi bật "Đánh thức bot theo dõi" (tắt → nội dung giữ nhưng không dùng).</summary>
    public static string? ActiveGuide(bool wakeFollowers, string? guide) => wakeFollowers ? CleanGuide(guide) : null;

    /// <summary>Bảng màu gợi ý ở FE (vẫn nhận mọi mã #rrggbb).</summary>
    public static readonly string[] Palette =
        ["#64748b", "#3b82f6", "#06b6d4", "#8b5cf6", "#ec4899", "#ef4444", "#f97316", "#f59e0b", "#84cc16", "#22c55e"];

    /// <summary>4 cột khi tạo dự án mới: Cần làm · Đang làm · Chờ review (đánh thức bot theo dõi) · Xong (hoàn thành + cần người duyệt).</summary>
    public static List<TaskColumn> Defaults(Guid projectId) =>
    [
        new() { ProjectId = projectId, Name = "Cần làm", Position = 0, Color = "#64748b" },
        new() { ProjectId = projectId, Name = "Đang làm", Position = 1, Color = "#3b82f6" },
        new() { ProjectId = projectId, Name = "Chờ review", Position = 2, Color = "#f59e0b", WakeFollowers = true },
        new() { ProjectId = projectId, Name = "Xong", Position = 3, Color = "#22c55e", IsDone = true, ApproverOnly = true },
    ];

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
