namespace OfficeHub.Modules.Projects.Domain;

/// <summary>Việc phụ thuộc (2026-11-11). Hàm thuần — test: tests/OfficeHub.Modules.Projects.Tests/DependencyRulesTests.cs.</summary>
public static class DependencyRules
{
    public const int MaxDependencies = 10;

    /// <summary>
    /// Lỗi khi đặt <paramref name="taskId"/> chờ <paramref name="dependsOn"/> (null = hợp lệ). <paramref name="sameProject"/> = id các việc cùng dự án;
    /// <paramref name="edges"/> = cạnh hiện có (việc → việc nó chờ) của dự án, KHÔNG gồm cạnh cũ của <paramref name="taskId"/>.
    /// </summary>
    public static string? Error(Guid taskId, IReadOnlyCollection<Guid> dependsOn, IReadOnlySet<Guid> sameProject, IEnumerable<(Guid Task, Guid DependsOn)> edges)
    {
        if (dependsOn.Count > MaxDependencies) return $"Tối đa {MaxDependencies} việc phải chờ";
        if (dependsOn.Contains(taskId)) return "Việc không thể chờ chính nó";
        if (dependsOn.Any(d => !sameProject.Contains(d))) return "Chỉ chờ được việc trong cùng dự án";
        // Vòng: từ một việc được chờ đi theo cạnh "chờ" mà quay về taskId
        var next = edges.GroupBy(e => e.Task).ToDictionary(g => g.Key, g => g.Select(e => e.DependsOn).ToList());
        var seen = new HashSet<Guid>();
        var stack = new Stack<Guid>(dependsOn);
        while (stack.Count > 0)
        {
            var cur = stack.Pop();
            if (cur == taskId) return "Tạo vòng chờ nhau — kiểm tra lại các việc phải chờ";
            if (!seen.Add(cur)) continue;
            foreach (var n in next.GetValueOrDefault(cur) ?? []) stack.Push(n);
        }
        return null;
    }

    /// <summary>
    /// TEST-199: cột mà việc trước nằm ở đó là "đủ" cho việc đang chờ nó — cột hoàn thành, cột có cờ <see cref="ColumnInfo.UnblocksDependents"/>, và (dự án đi lần lượt)
    /// mọi cột đứng sau cột có cờ đầu tiên. Không cột nào có cờ → chỉ cột hoàn thành (như trước TEST-199).
    /// </summary>
    public static HashSet<Guid> ReadyColumnIds(IEnumerable<ColumnInfo> columns, bool sequential)
    {
        var cols = columns.OrderBy(c => c.Position).ThenBy(c => c.Id).ToList();
        var first = cols.FindIndex(c => c.UnblocksDependents);
        return cols.Where((c, i) => c.IsDone || c.UnblocksDependents || (sequential && first >= 0 && i >= first)).Select(c => c.Id).ToHashSet();
    }

    /// <summary>TEST-199: việc trước "đủ" (việc chờ nó được bắt đầu): đã xong (<c>CompletedAt != null</c>) hoặc đang ở cột thuộc <paramref name="readyColumns"/>.</summary>
    public static bool IsReady(bool completed, Guid columnId, IReadOnlySet<Guid> readyColumns) => completed || readyColumns.Contains(columnId);

    /// <summary>Bot (token AI) không đưa việc còn chờ ra khỏi cột đầu tiên. Người thật: chỉ cảnh báo trên giao diện.</summary>
    public static string? StartError(int unfinishedDependencies, bool leavingFirstColumn, bool byBot) =>
        byBot && leavingFirstColumn && unfinishedDependencies > 0
            ? $"Việc còn chờ {unfinishedDependencies} việc khác chưa xong — làm việc khác trước, sẽ có thông báo khi việc này sẵn sàng"
            : null;

    /// <summary>
    /// Việc vừa HẾT phải chờ (→ báo "Sẵn sàng"): chưa xong, trước đó còn chờ ít nhất một việc chưa "đủ" (<see cref="IsReady"/>), nay không còn.
    /// Dùng cho cả 3 đường: việc trước tới cột "đủ", sửa danh sách việc phải chờ, xoá việc đứng trước (TEST-198).
    /// Thêm một việc đã xong / sửa mà vẫn còn chờ / trước đó vốn không chờ → không báo.
    /// </summary>
    public static bool BecameReady(bool taskDone, int unfinishedBefore, int unfinishedAfter) =>
        !taskDone && unfinishedBefore > 0 && unfinishedAfter == 0;

    /// <summary>TEST-199: việc trước bị kéo lùi khỏi vùng "đủ" → việc đang chờ nó đã rời cột đầu (đã bắt đầu, chưa xong) thì không dừng, chỉ báo người làm
    /// kiểm tra lại đầu vào; việc còn ở cột đầu thì chỉ bị chặn lại (không báo).</summary>
    public static bool ShouldWarnRegressed(bool dependentDone, bool dependentInFirstColumn) => !dependentDone && !dependentInFirstColumn;
}
