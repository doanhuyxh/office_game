using OfficeHub.Modules.Organization.Domain;

namespace OfficeHub.Modules.Organization.Tests;

public class SelfPublishTests
{
    [Theory]
    [InlineData(1, true)]
    [InlineData(5, true)]
    [InlineData(6, true)]  // Chuyên viên
    [InlineData(7, false)] // Nhân viên
    [InlineData(8, false)] // Thực tập sinh
    [InlineData(0, false)] // dữ liệu cũ chưa có cấp
    public void Only_specialist_and_above_can_self_publish(int level, bool expected) =>
        Assert.Equal(expected, PositionLadder.CanSelfPublish(level));

    [Fact]
    public void Specialist_level_matches_default_ladder() =>
        Assert.Equal(PositionLadder.SpecialistLevel, PositionLadder.LevelOf("Chuyên viên"));
}
