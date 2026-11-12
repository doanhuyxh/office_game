namespace OfficeHub.Modules.Projects.Domain;

/// <summary>Phòng ban tham gia dự án (TEST-40). Hàm thuần — test: tests/OfficeHub.Modules.Projects.Tests/ProjectDepartmentRulesTests.cs.</summary>
public static class ProjectDepartmentRules
{
    public const int MaxDepartments = 20;

    /// <summary>Lỗi theo trường API (rỗng = hợp lệ). <paramref name="ids"/> đã bỏ trùng; <paramref name="existing"/> = id phòng ban đang có ở Organization.</summary>
    public static Dictionary<string, string> Errors(IReadOnlyCollection<Guid> ids, Guid? lead, IReadOnlySet<Guid> existing)
    {
        var e = new Dictionary<string, string>();
        if (ids.Count > MaxDepartments) e["departmentIds"] = $"Tối đa {MaxDepartments} phòng ban tham gia";
        else if (ids.Any(x => !existing.Contains(x))) e["departmentIds"] = "Có phòng ban không tồn tại";
        if (lead is { } l && !ids.Contains(l)) e["leadDepartmentId"] = "Phòng chủ trì phải nằm trong danh sách phòng ban tham gia";
        return e;
    }

    /// <summary>Bỏ trùng + Guid rỗng, giữ thứ tự gửi lên.</summary>
    public static List<Guid> Normalize(IEnumerable<Guid>? ids) => (ids ?? []).Where(x => x != Guid.Empty).Distinct().ToList();

    /// <summary>Sắp để hiển thị: phòng chủ trì trước, rồi theo tên.</summary>
    public static IEnumerable<T> Ordered<T>(IEnumerable<T> rows, Func<T, bool> isLead, Func<T, string> name) =>
        rows.OrderByDescending(isLead).ThenBy(name, StringComparer.CurrentCulture);
}
