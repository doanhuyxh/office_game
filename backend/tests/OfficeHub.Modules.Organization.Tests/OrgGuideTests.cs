using OfficeHub.Modules.Organization.Domain;

namespace OfficeHub.Modules.Organization.Tests;

public class OrgGuideTests
{
    private sealed record D(Guid Id, Guid? ParentId, string Name);

    [Fact]
    public void Chain_goes_from_own_department_up_to_root()
    {
        var root = new D(Guid.NewGuid(), null, "Ban Giám đốc");
        var mid = new D(Guid.NewGuid(), root.Id, "Kỹ thuật");
        var leaf = new D(Guid.NewGuid(), mid.Id, "Nhóm Web");
        var byId = new[] { root, mid, leaf }.ToDictionary(d => d.Id);
        Assert.Equal(["Nhóm Web", "Kỹ thuật", "Ban Giám đốc"], OrgGuide.Chain(byId, leaf.Id, d => d.ParentId).Select(d => d.Name));
        Assert.Empty(OrgGuide.Chain(byId, null, d => d.ParentId));
        Assert.Empty(OrgGuide.Chain(byId, Guid.NewGuid(), d => d.ParentId));
    }

    [Fact]
    public void Chain_stops_on_cycle_or_missing_parent()
    {
        Guid a = Guid.NewGuid(), b = Guid.NewGuid();
        var cyc = new Dictionary<Guid, D> { [a] = new(a, b, "A"), [b] = new(b, a, "B") };
        Assert.Equal(["A", "B"], OrgGuide.Chain(cyc, a, d => d.ParentId).Select(d => d.Name));
        var orphan = new Dictionary<Guid, D> { [a] = new(a, Guid.NewGuid(), "A") };
        Assert.Equal(["A"], OrgGuide.Chain(orphan, a, d => d.ParentId).Select(d => d.Name));
    }

    [Theory]
    [InlineData(null, null)]
    [InlineData("   \n ", null)]
    [InlineData("  ## Trách nhiệm\r\n- Tuyển dụng  ", "## Trách nhiệm\n- Tuyển dụng")]
    public void Clean_trims_and_normalizes_newlines(string? input, string? expected) => Assert.Equal(expected, OrgGuide.Clean(input));

    [Fact]
    public void Templates_fit_limits() =>
        Assert.True(OrgGuide.DepartmentTemplate.Length < OrgGuide.GuideMax && OrgGuide.PositionTemplate.Contains("## Quyền hạn"));

    /// <summary>Chủ dự án nâng 2026-11-09. Cùng giá trị ở OrgGuideTools (MCP, OrgGuideToolsTests) và guide-dialog (FE) — đổi thì đổi cả 3 + migration.</summary>
    [Fact]
    public void Limits() => Assert.Equal((2_000, 40_000), (OrgGuide.DescriptionMax, OrgGuide.GuideMax));
}
