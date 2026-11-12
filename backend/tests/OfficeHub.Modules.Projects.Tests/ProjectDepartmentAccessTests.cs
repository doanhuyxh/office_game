using OfficeHub.Modules.Projects.Contracts;
using OfficeHub.Modules.Projects.Domain;
using OfficeHub.Modules.Projects.Infrastructure;

namespace OfficeHub.Modules.Projects.Tests;

/// <summary>TEST-40: xem dự án nhờ phòng ban (chỉ đọc) + bảng quyền hạn của tab Phụ lục sinh từ ProjectViewer.</summary>
public class ProjectDepartmentAccessTests
{
    private static readonly Guid P = Guid.NewGuid(), Other = Guid.NewGuid();

    private static ProjectViewer Viewer(ProjectMemberRole? role = null, bool hr = false, bool finance = false, bool columns = false, params Guid[] dept) =>
        new(Guid.NewGuid(), "x", hr, false, finance, null,
            role is { } r ? new Dictionary<Guid, ProjectMemberRole> { [P] = r } : new Dictionary<Guid, ProjectMemberRole>(),
            ManageColumns: columns, DeptProjects: dept.ToHashSet());

    [Fact]
    public void Department_viewer_sees_but_cannot_work_or_manage_columns()
    {
        var v = Viewer(columns: true, dept: P);
        Assert.True(v.CanSee(P));
        Assert.True(v.ViaDepartment(P));
        Assert.False(v.CanWork(P));
        Assert.False(v.CanManage(P));
        Assert.False(v.CanManageColumns(P)); // kể cả chức vụ có cờ "Quản lý trạng thái công việc"
        Assert.False(v.CanSeeEffort(P));
        Assert.False(v.CanSeeDocuments(P));
        Assert.False(v.CanSee(Other));
    }

    [Fact]
    public void Member_of_a_participating_department_is_not_marked_as_via_department()
    {
        var v = Viewer(role: ProjectMemberRole.Member, dept: P);
        Assert.False(v.ViaDepartment(P));
        Assert.True(v.CanWork(P));
    }

    [Fact]
    public void No_department_projects_is_the_old_behaviour() => Assert.False(Viewer().CanSee(P));

    // Kỳ vọng từng vai trò — đổi quy tắc ProjectViewer thì test này fail, nhắc kiểm tra lại phụ lục / tài liệu.
    [Theory]
    [InlineData("manager", "view,work,manage,effort,documents")]
    [InlineData("member", "view,work,documents")]
    [InlineData("department", "view")]
    [InlineData("hr", "view,work,manage,effort,documents")]
    [InlineData("finance", "view,effort,finance")]
    [InlineData("columns", "view,work,columns,documents")]
    public void Appendix_permissions_per_role(string persona, string expected)
    {
        var x = ProjectPermissions.Personas(P).Single(p => p.Key == persona);
        Assert.Equal(expected, string.Join(",", ProjectPermissions.Allowed(x.Viewer, P)));
    }

    [Fact]
    public void Every_capability_has_a_label_and_unique_key()
    {
        Assert.All(ProjectPermissions.All, c => Assert.False(string.IsNullOrWhiteSpace(c.Label)));
        Assert.Equal(ProjectPermissions.All.Count, ProjectPermissions.All.Select(c => c.Key).Distinct().Count());
    }

    private static readonly Guid D1 = Guid.NewGuid(), D2 = Guid.NewGuid(), Gone = Guid.NewGuid();
    private static readonly HashSet<Guid> Existing = [D1, D2];

    [Fact]
    public void Valid_departments_and_lead() => Assert.Empty(ProjectDepartmentRules.Errors([D1, D2], D2, Existing));

    [Fact]
    public void No_lead_is_allowed() => Assert.Empty(ProjectDepartmentRules.Errors([D1], null, Existing));

    [Fact]
    public void Lead_must_be_in_the_list() => Assert.Contains("leadDepartmentId", ProjectDepartmentRules.Errors([D1], D2, Existing).Keys);

    [Fact]
    public void Unknown_department() => Assert.Contains("departmentIds", ProjectDepartmentRules.Errors([D1, Gone], null, Existing).Keys);

    [Fact]
    public void At_most_20()
    {
        var many = Enumerable.Range(0, 21).Select(_ => Guid.NewGuid()).ToList();
        Assert.Equal("Tối đa 20 phòng ban tham gia", ProjectDepartmentRules.Errors(many, null, many.ToHashSet())["departmentIds"]);
    }

    [Fact]
    public void Normalize_drops_duplicates_and_empty() =>
        Assert.Equal([D1, D2], ProjectDepartmentRules.Normalize([D1, Guid.Empty, D2, D1]));

    [Fact]
    public void Lead_first_then_name() =>
        Assert.Equal(["Kỹ thuật", "Hành chính", "Kinh doanh"],
            ProjectDepartmentRules.Ordered([("Kinh doanh", false), ("Kỹ thuật", true), ("Hành chính", false)], x => x.Item2, x => x.Item1).Select(x => x.Item1));
}
