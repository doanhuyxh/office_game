using OfficeHub.Modules.Projects.Domain;

namespace OfficeHub.Modules.Projects.Tests;

/// <summary>Link ảnh / video của công việc: chuẩn hoá + chỉ nhận http/https.</summary>
public class TaskRulesTests
{
    [Fact]
    public void NormalizeLinks_TrimsDropsBlankAndDuplicates() =>
        Assert.Equal(["https://a.vn/x.png", "https://youtu.be/abc"],
            TaskRules.NormalizeLinks([" https://a.vn/x.png ", "", null, "https://youtu.be/abc", "https://a.vn/x.png"]));

    [Fact]
    public void NormalizeLinks_Null_IsEmpty() => Assert.Empty(TaskRules.NormalizeLinks(null));

    [Theory]
    [InlineData("https://a.vn/x.png", true)]
    [InlineData("http://a.vn/v.mp4", true)]
    [InlineData("javascript:alert(1)", false)]
    [InlineData("data:image/png;base64,AAAA", false)]
    [InlineData("ftp://a.vn/x.png", false)]
    [InlineData("/relative/x.png", false)]
    [InlineData("không phải link", false)]
    public void MediaLinksError_Scheme(string link, bool ok) => Assert.Equal(ok, TaskRules.MediaLinksError([link]) is null);

    [Fact]
    public void MediaLinksError_TooMany() =>
        Assert.NotNull(TaskRules.MediaLinksError(Enumerable.Range(0, TaskRules.MaxMediaLinks + 1).Select(i => $"https://a.vn/{i}.png").ToList()));

    [Fact]
    public void MediaLinksError_TooLong() => Assert.NotNull(TaskRules.MediaLinksError(["https://a.vn/" + new string('x', TaskRules.MaxLinkLength)]));
}
