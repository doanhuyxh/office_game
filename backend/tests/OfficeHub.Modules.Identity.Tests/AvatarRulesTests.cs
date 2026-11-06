using System.Text.Json;
using OfficeHub.Modules.Identity.Domain;

namespace OfficeHub.Modules.Identity.Tests;

public class AvatarRulesTests
{
    private static readonly AvatarCatalog Catalog = AvatarCatalog.Embedded;

    private static string? Normalize(string json, out Dictionary<string, string> errors) =>
        AvatarRules.Normalize(JsonDocument.Parse(json).RootElement, Catalog, out errors);

    /// <summary>Phần đầu tiên của mỗi ô cho dáng người.</summary>
    private static string Look(string body, string extra = "")
    {
        var parts = string.Join(",", AvatarRules.Slots.Select(s => $"\"{s}\":\"{Catalog.Bodies[body][s].First()}\""));
        return $"{{\"v\":1,\"body\":\"{body}\",{parts}{extra}}}";
    }

    [Fact]
    public void Embedded_catalog_has_both_bodies_and_palettes()
    {
        Assert.Contains("male", Catalog.Bodies.Keys);
        Assert.Contains("female", Catalog.Bodies.Keys);
        foreach (var body in Catalog.Bodies.Values)
            foreach (var slot in AvatarRules.Slots) Assert.NotEmpty(body[slot]);
        foreach (var (_, palette) in AvatarRules.Colors) Assert.True(Catalog.PaletteSizes[palette] > 0);
    }

    [Fact]
    public void Catalog_default_look_is_valid()
    {
        using var s = typeof(AvatarCatalog).Assembly.GetManifestResourceStream(AvatarCatalog.ResourceName)!;
        var def = JsonDocument.Parse(s).RootElement.GetProperty("default");
        Assert.NotNull(AvatarRules.Normalize(def, Catalog, out var errors));
        Assert.Empty(errors);
    }

    [Theory]
    [InlineData("male")]
    [InlineData("female")]
    public void Accepts_valid_look_and_normalizes_missing_colors_to_null(string body)
    {
        var json = Normalize(Look(body, ",\"skin\":0,\"topColor\":3,\"extra\":\"bỏ\""), out var errors);
        Assert.Empty(errors);
        var o = JsonDocument.Parse(json!).RootElement;
        Assert.Equal(body, o.GetProperty("body").GetString());
        Assert.Equal(0, o.GetProperty("skin").GetInt32());
        Assert.Equal(3, o.GetProperty("topColor").GetInt32());
        Assert.Equal(JsonValueKind.Null, o.GetProperty("hair").ValueKind);
        Assert.False(o.TryGetProperty("extra", out _)); // trường lạ bị bỏ
    }

    [Theory]
    [InlineData("{\"v\":1,\"body\":\"robot\",\"head\":\"x\",\"top\":\"x\",\"bottom\":\"x\",\"shoes\":\"x\"}", "body")]
    [InlineData("[1,2]", "look")]
    public void Rejects_bad_body_or_shape(string json, string field)
    {
        Assert.Null(Normalize(json, out var errors));
        Assert.Contains(field, errors.Keys);
    }

    [Fact]
    public void Rejects_unknown_part_and_part_of_other_body()
    {
        Assert.Null(Normalize(Look("male").Replace($"\"head\":\"{Catalog.Bodies["male"]["head"].First()}\"", "\"head\":\"khong-co\""), out var e1));
        Assert.Contains("head", e1.Keys);

        // Phần chỉ có ở dáng nữ (váy) không ghép vào dáng nam được (khác bộ xương)
        var femaleOnly = Catalog.Bodies["female"]["bottom"].Except(Catalog.Bodies["male"]["bottom"]).First();
        Assert.Null(Normalize(Look("male").Replace($"\"bottom\":\"{Catalog.Bodies["male"]["bottom"].First()}\"", $"\"bottom\":\"{femaleOnly}\""), out var e2));
        Assert.Contains("bottom", e2.Keys);
    }

    [Theory]
    [InlineData(",\"skin\":-1", "skin")]
    [InlineData(",\"hair\":999", "hair")]
    [InlineData(",\"topColor\":1.5", "topColor")]
    [InlineData(",\"eyes\":\"2\"", "eyes")]
    public void Rejects_bad_colors(string extra, string field)
    {
        Assert.Null(Normalize(Look("female", extra), out var errors));
        Assert.Contains(field, errors.Keys);
    }

    [Fact]
    public void Rejects_unsupported_version()
    {
        Assert.Null(Normalize(Look("male").Replace("\"v\":1", "\"v\":2"), out var errors));
        Assert.Contains("v", errors.Keys);
    }
}
