using OfficeHub.Modules.Projects.Domain;

namespace OfficeHub.Modules.Projects.Tests;

public class TaskNotifyRulesTests
{
    private static readonly Guid Actor = Guid.NewGuid(), A = Guid.NewGuid(), B = Guid.NewGuid(), C = Guid.NewGuid();

    [Fact]
    public void Everyone_except_actor() =>
        Assert.Equal([A, B], TaskNotifyRules.Recipients([(Actor, true), (A, true), (B, true)], Actor, []));

    [Fact]
    public void Skips_people_already_notified_for_the_same_event() =>
        Assert.Equal([B], TaskNotifyRules.Recipients([(Actor, true), (A, true), (B, true)], Actor, [A]));

    [Fact]
    public void Skips_inactive_and_members_without_account() =>
        Assert.Equal([A], TaskNotifyRules.Recipients([(A, true), (B, false), (null, true)], Actor, []));

    [Fact]
    public void Actor_outside_project_like_hr_does_not_change_list() =>
        Assert.Equal([A, C], TaskNotifyRules.Recipients([(A, true), (C, true)], Actor, []));

    [Fact]
    public void No_duplicates() =>
        Assert.Equal([A], TaskNotifyRules.Recipients([(A, true), (A, true)], Actor, []));

    [Fact]
    public void Body_is_cut_at_limit()
    {
        Assert.Equal("ngắn", TaskNotifyRules.Body("ngắn"));
        var cut = TaskNotifyRules.Body(new string('x', 400));
        Assert.Equal(TaskNotifyRules.MaxBody + 1, cut.Length);
        Assert.EndsWith("…", cut);
    }
}
