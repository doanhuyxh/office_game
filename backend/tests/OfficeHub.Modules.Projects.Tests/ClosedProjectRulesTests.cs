using OfficeHub.Modules.Projects.Contracts;
using OfficeHub.Modules.Projects.Domain;
using OfficeHub.Modules.Projects.Infrastructure;

namespace OfficeHub.Modules.Projects.Tests;

/// <summary>TEST-213: dự án đã đóng — thành viên thường chỉ bình luận, quản lý dự án + HR làm đầy đủ trên web, token AI không ghi việc.</summary>
public class ClosedProjectRulesTests
{
    private static readonly Guid P = Guid.NewGuid();

    private static ProjectViewer Viewer(ProjectMemberRole? role = null, bool hr = false, bool token = false) =>
        new(Guid.NewGuid(), "x", hr, false, false, null,
            role is { } r ? new Dictionary<Guid, ProjectMemberRole> { [P] = r } : new Dictionary<Guid, ProjectMemberRole>(), ByToken: token);

    [Theory]
    [InlineData(false, false)]
    [InlineData(true, false)]
    [InlineData(false, true)]
    [InlineData(true, true)]
    public void Active_project_always_writable(bool canManage, bool byToken)
    {
        Assert.True(ClosedProjectRules.CanWriteTasks(active: true, canManage, byToken));
        Assert.Null(ClosedProjectRules.TaskWriteError(active: true, canManage, byToken));
    }

    [Fact]
    public void Closed_member_only_comments() =>
        Assert.Equal(ClosedProjectRules.MemberOnlyComment, ClosedProjectRules.TaskWriteError(active: false, canManage: false, byToken: false));

    [Fact]
    public void Closed_manager_on_web_works_fully() => Assert.Null(ClosedProjectRules.TaskWriteError(active: false, canManage: true, byToken: false));

    [Fact]
    public void Closed_manager_via_ai_token_cannot_write() =>
        Assert.Equal(ClosedProjectRules.NoAgent, ClosedProjectRules.TaskWriteError(active: false, canManage: true, byToken: true));

    [Theory]
    [InlineData(true, false, true)]
    [InlineData(true, true, true)]
    [InlineData(false, false, true)]  // dự án đóng: bình luận kèm tệp trên web / token vẫn được
    [InlineData(false, true, false)]  // link tải lên từ thiết bị khác hết hiệu lực khi dự án đóng
    public void Attach_files(bool active, bool viaUploadLink, bool expected) => Assert.Equal(expected, ClosedProjectRules.CanAttachFiles(active, viaUploadLink));

    [Fact]
    public void Wakes_bots_only_when_active()
    {
        Assert.True(ClosedProjectRules.WakesBots(true));
        Assert.False(ClosedProjectRules.WakesBots(false));
    }

    [Fact]
    public void Viewer_member_on_closed_project_comments_only()
    {
        var v = Viewer(ProjectMemberRole.Member);
        Assert.True(v.CanComment(P));
        Assert.True(v.CanWorkOn(P, active: true));
        Assert.False(v.CanWorkOn(P, active: false));
        Assert.Equal(ClosedProjectRules.MemberOnlyComment, v.ClosedError(P, active: false));
    }

    [Fact]
    public void Viewer_manager_and_hr_work_on_closed_project()
    {
        foreach (var v in new[] { Viewer(ProjectMemberRole.Manager), Viewer(hr: true) })
        {
            Assert.True(v.CanWorkOn(P, active: false));
            Assert.Null(v.ClosedError(P, active: false));
            Assert.True(v.CanComment(P));
        }
    }

    [Fact]
    public void Viewer_manager_token_cannot_write_closed_project_but_can_comment()
    {
        var v = Viewer(ProjectMemberRole.Manager, token: true);
        Assert.False(v.CanWorkOn(P, active: false));
        Assert.True(v.CanWorkOn(P, active: true));
        Assert.True(v.CanComment(P));
    }

    [Fact]
    public void Outsider_cannot_comment_or_work()
    {
        var v = Viewer();
        Assert.False(v.CanComment(P));
        Assert.False(v.CanWorkOn(P, active: true));
    }
}
