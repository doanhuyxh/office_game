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

    /// <summary>Bot (token AI) không đưa việc còn chờ ra khỏi cột đầu tiên. Người thật: chỉ cảnh báo trên giao diện.</summary>
    public static string? StartError(int unfinishedDependencies, bool leavingFirstColumn, bool byBot) =>
        byBot && leavingFirstColumn && unfinishedDependencies > 0
            ? $"Việc còn chờ {unfinishedDependencies} việc khác chưa xong — làm việc khác trước, sẽ có thông báo khi việc này sẵn sàng"
            : null;
}
