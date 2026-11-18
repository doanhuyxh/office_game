using OfficeHub.Modules.Projects.Domain;

namespace OfficeHub.Modules.Projects.Tests;

public class FollowerRulesTests
{
    [Fact]
    public void Member_can_follow() => Assert.Null(FollowerRules.AddError(isMember: true, alreadyFollowing: false, currentCount: 0));

    [Fact]
    public void Non_member_rejected() =>
        Assert.Equal("Người theo dõi phải là thành viên dự án", FollowerRules.AddError(isMember: false, alreadyFollowing: false, currentCount: 0));

    [Fact]
    public void Already_following_is_noop_even_after_leaving_project() =>
        Assert.Null(FollowerRules.AddError(isMember: false, alreadyFollowing: true, currentCount: FollowerRules.MaxFollowers));

    [Fact]
    public void Limit_reached() =>
        Assert.Equal($"Tối đa {FollowerRules.MaxFollowers} người theo dõi một việc",
            FollowerRules.AddError(isMember: true, alreadyFollowing: false, currentCount: FollowerRules.MaxFollowers));

    [Fact]
    public void Below_limit() => Assert.Null(FollowerRules.AddError(isMember: true, alreadyFollowing: false, currentCount: FollowerRules.MaxFollowers - 1));
}
