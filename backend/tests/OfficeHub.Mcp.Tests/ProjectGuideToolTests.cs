using ModelContextProtocol;
using OfficeHub.Mcp.Tools;

namespace OfficeHub.Mcp.Tests;

/// <summary>update_project_guide (TEST-35): "none" = xoá, trống / quá dài bị chặn trước khi gọi Api.</summary>
public class ProjectGuideToolTests
{
    [Fact]
    public void Keeps_trimmed_markdown() => Assert.Equal("## Định nghĩa xong\n- Có link", ProjectTools.GuideValue("  ## Định nghĩa xong\n- Có link \n"));

    [Theory]
    [InlineData("none")]
    [InlineData(" NONE ")]
    [InlineData("không")]
    public void None_clears(string input) => Assert.Null(ProjectTools.GuideValue(input));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Empty_is_rejected(string? input) => Assert.Throws<McpException>(() => ProjectTools.GuideValue(input));

    [Fact]
    public void Limit_is_20000_characters()
    {
        Assert.Equal(ProjectTools.GuideMax, ProjectTools.GuideValue(new string('x', ProjectTools.GuideMax))!.Length);
        Assert.Throws<McpException>(() => ProjectTools.GuideValue(new string('x', ProjectTools.GuideMax + 1)));
    }
}
