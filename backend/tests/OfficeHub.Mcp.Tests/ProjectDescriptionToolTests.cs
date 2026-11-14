using ModelContextProtocol;
using OfficeHub.Mcp.Tools;

namespace OfficeHub.Mcp.Tests;

/// <summary>update_project_description (TEST-103): "none" = xoá, trống / quá dài bị chặn trước khi gọi Api.</summary>
public class ProjectDescriptionToolTests
{
    [Fact]
    public void Keeps_trimmed_text() => Assert.Equal("Mục tiêu: rà soát\nPhạm vi: Api", ProjectTools.DescriptionValue("  Mục tiêu: rà soát\nPhạm vi: Api \n"));

    [Theory]
    [InlineData("none")]
    [InlineData(" NONE ")]
    [InlineData("không")]
    public void None_clears(string input) => Assert.Null(ProjectTools.DescriptionValue(input));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Empty_is_rejected(string? input) => Assert.Throws<McpException>(() => ProjectTools.DescriptionValue(input));

    [Fact]
    public void Limit_is_2000_characters()
    {
        Assert.Equal(2000, ProjectTools.DescriptionMax);
        Assert.Equal(ProjectTools.DescriptionMax, ProjectTools.DescriptionValue(new string('x', ProjectTools.DescriptionMax))!.Length);
        Assert.Throws<McpException>(() => ProjectTools.DescriptionValue(new string('x', ProjectTools.DescriptionMax + 1)));
    }
}
