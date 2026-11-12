using System.Text.Json.Nodes;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Settings.Domain;

namespace OfficeHub.Modules.Settings.Tests;

public class SettingsRulesTests
{
    private static SettingsGroupDef Def(string g) => SettingsRules.Find(g)!;

    private static (NormalizedSettings N, Validation V) Run(string group, string valuesJson, Dictionary<string, string?>? secrets = null,
        string[]? clear = null, Func<string, string?>? current = null)
    {
        var v = new Validation();
        var n = SettingsRules.Normalize(Def(group), JsonNode.Parse(valuesJson) as JsonObject, secrets, clear, current ?? (_ => null), v);
        return (n, v);
    }

    [Fact]
    public void S3_requires_secret_when_none_stored()
    {
        var (_, v) = Run(SettingsGroups.S3, """{"region":"ap-southeast-1","bucketFiles":"b","accessKey":"AK"}""");
        Assert.True(v.Has("secretKey"));
    }

    [Fact]
    public void Blank_secret_keeps_current_value()
    {
        var (n, v) = Run(SettingsGroups.S3, """{"region":"ap-southeast-1","bucketFiles":"b","accessKey":"AK"}""",
            new() { ["secretKey"] = "  " }, current: k => k == "secretKey" ? "old-secret" : null);
        Assert.False(v.Failed);
        Assert.Equal("old-secret", n.Secrets["secretKey"]);
        Assert.Equal(5, n.Values["presignMinutes"]!.GetValue<int>());
    }

    [Fact]
    public void New_secret_replaces_and_clear_removes()
    {
        var (n, _) = Run(SettingsGroups.Smtp, """{"host":"smtp.x","fromEmail":"a@x.vn"}""", new() { ["password"] = "new" }, current: _ => "old");
        Assert.Equal("new", n.Secrets["password"]);
        var (n2, v2) = Run(SettingsGroups.Smtp, """{"host":"smtp.x","fromEmail":"a@x.vn"}""", clear: ["password"], current: _ => "old");
        Assert.False(v2.Failed);
        Assert.False(n2.Secrets.ContainsKey("password"));
    }

    [Theory]
    [InlineData("""{"host":"","fromEmail":"a@x.vn"}""", "host")]
    [InlineData("""{"host":"h","fromEmail":"not-mail"}""", "fromEmail")]
    [InlineData("""{"host":"h","fromEmail":"a@x.vn","port":70000}""", "port")]
    public void Smtp_validation(string json, string field) => Assert.True(Run(SettingsGroups.Smtp, json).V.Has(field));

    [Fact]
    public void S3_rejects_bad_endpoint()
    {
        var (_, v) = Run(SettingsGroups.S3, """{"region":"r","bucketFiles":"b","accessKey":"AK","serviceUrl":"ftp://x"}""", new() { ["secretKey"] = "s" });
        Assert.True(v.Has("serviceUrl"));
    }

    [Fact]
    public void Office_ips_accept_ip_and_cidr_and_normalize()
    {
        var (n, v) = Run(SettingsGroups.OfficeIps, """{"ranges":[{"cidr":"203.0.113.10","note":"Cáp quang"},{"cidr":" 10.0.0.0/8 "}]}""");
        Assert.False(v.Failed);
        var arr = n.Values["ranges"]!.AsArray();
        Assert.Equal("203.0.113.10/32", arr[0]!["cidr"]!.GetValue<string>());
        Assert.Equal("Cáp quang", arr[0]!["note"]!.GetValue<string>());
        Assert.Equal("10.0.0.0/8", arr[1]!["cidr"]!.GetValue<string>());
    }

    [Theory]
    [InlineData("abc")]
    [InlineData("10.0.0.1/8")]
    [InlineData("300.1.1.1")]
    [InlineData("")]
    public void Office_ips_reject_invalid(string cidr)
    {
        var (_, v) = Run(SettingsGroups.OfficeIps, $$"""{"ranges":[{"cidr":"{{cidr}}"}]}""");
        Assert.True(v.Has("ranges[0].cidr"));
    }

    [Fact]
    public void Fcm_requires_service_account_and_reads_project()
    {
        Assert.True(Run(SettingsGroups.Fcm, "{}").V.Has("serviceAccountJson"));
        Assert.True(Run(SettingsGroups.Fcm, "{}", new() { ["serviceAccountJson"] = "{not json" }).V.Has("serviceAccountJson"));
        Assert.True(Run(SettingsGroups.Fcm, "{}", new() { ["serviceAccountJson"] = """{"type":"user"}""" }).V.Has("serviceAccountJson"));
        var sa = """{"type":"service_account","project_id":"officehub-x","private_key":"k","client_email":"a@b.iam.gserviceaccount.com"}""";
        var (n, v) = Run(SettingsGroups.Fcm, "{}", new() { ["serviceAccountJson"] = sa });
        Assert.False(v.Failed);
        Assert.Equal("officehub-x", n.Values["projectId"]!.GetValue<string>());
    }

    [Fact]
    public void Ip_parse_helper()
    {
        Assert.NotNull(OfficeIpSettings.TryParse("2001:db8::1"));
        Assert.Null(OfficeIpSettings.TryParse(null));
        var s = new OfficeIpSettings([new("192.168.1.0/24", null), new("bad", null)]);
        Assert.Single(s.Networks);
    }
}
