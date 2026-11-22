using OfficeHub.Modules.Documents.Domain;
using OfficeHub.Modules.Documents.Infrastructure;
using OfficeHub.Modules.Projects.Contracts;

namespace OfficeHub.Modules.Documents.Tests;

/// <summary>TEST-213: kho dự án đã đóng — thành viên thường chỉ đọc / tải về, quản lý dự án + HR vẫn ghi.</summary>
public class ProjectSpaceWriteTests
{
    private static readonly Guid P = Guid.NewGuid();

    private static Viewer Viewer(ProjectRole? role = null, bool hr = false) =>
        new(Guid.NewGuid(), "x", hr, null, new HashSet<Guid>(), new HashSet<Guid>(),
            role is { } r ? new Dictionary<Guid, ProjectRole> { [P] = r } : new Dictionary<Guid, ProjectRole>());

    private static ProjectRef Project(bool active) => new(P, "P", "Dự án", active, [], null);

    [Theory]
    [InlineData(true, false, true)]
    [InlineData(true, true, true)]
    [InlineData(false, false, false)]
    [InlineData(false, true, true)]
    public void Rule(bool active, bool canManage, bool expected) => Assert.Equal(expected, DocumentRules.CanWriteProjectSpace(active, canManage));

    [Fact]
    public void Member_read_only_on_closed_project()
    {
        Assert.False(DocumentAccess.CanWriteProject(Viewer(ProjectRole.Member), Project(active: false)));
        Assert.True(DocumentAccess.CanWriteProject(Viewer(ProjectRole.Member), Project(active: true)));
    }

    [Fact]
    public void Manager_and_hr_write_closed_project()
    {
        Assert.True(DocumentAccess.CanWriteProject(Viewer(ProjectRole.Manager), Project(active: false)));
        Assert.True(DocumentAccess.CanWriteProject(Viewer(hr: true), Project(active: false)));
    }
}
