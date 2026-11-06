namespace OfficeHub.Modules.Organization.Domain;

/// <summary>
/// Thang cấp bậc mặc định (chủ dự án chốt 2026-11-06). HR vẫn thêm / sửa / xoá chức vụ nhưng mỗi chức vụ bắt buộc có cấp.
/// Hàm thuần — test ở tests/OfficeHub.Modules.Organization.Tests.
/// </summary>
public static class PositionLadder
{
    public sealed record Rank(string Name, int Level);

    public const int MaxLevel = 99;
    public const int StaffLevel = 7;

    public static readonly Rank[] Defaults =
    [
        new("Giám đốc", 1), new("Phó giám đốc", 2), new("Trưởng phòng", 3), new("Phó phòng", 4),
        new("Trưởng nhóm", 5), new("Chuyên viên", 6), new("Nhân viên", StaffLevel), new("Thực tập sinh", 8),
    ];

    /// <summary>Tên chức vụ cũ thực chất là chức danh công việc → chuyển sang <c>Employee.JobTitle</c>, cấp = Nhân viên.</summary>
    public static readonly string[] JobFunctionNames = ["Lễ tân"];

    /// <summary>Cấp của tên chức vụ theo thang mặc định (không phân biệt hoa thường / dấu cách thừa), null nếu không có.</summary>
    public static int? LevelOf(string name) =>
        Defaults.FirstOrDefault(r => EmployeeImportSheet.Normalize(r.Name) == EmployeeImportSheet.Normalize(name))?.Level;

    /// <summary>Tên chuẩn của chức danh nếu <paramref name="name"/> là chức danh công việc (vd "Lễ Tân" → "Lễ tân").</summary>
    public static string? AsJobTitle(string name) =>
        JobFunctionNames.FirstOrDefault(j => EmployeeImportSheet.Normalize(j) == EmployeeImportSheet.Normalize(name));

    public enum Action { SetLevel, ToJobTitle }

    /// <summary>Kế hoạch chuyển chức vụ cũ (Level = 0): khớp thang → gán cấp; là chức danh → chuyển; còn lại → cấp Nhân viên (HR chỉnh sau).</summary>
    public static (Action Action, int Level, string? JobTitle) Plan(string name) =>
        LevelOf(name) is { } l ? (Action.SetLevel, l, null)
        : AsJobTitle(name) is { } j ? (Action.ToJobTitle, StaffLevel, j)
        : (Action.SetLevel, StaffLevel, null);
}
