using System.Text;
using System.Text.Json;
using OfficeHub.Modules.Audit.Domain;

namespace OfficeHub.Modules.Audit.Tests;

public class AiRequestSummaryTests
{
    private static string? Sum(string json) => AiRequestSummary.FromJson(Encoding.UTF8.GetBytes(json));

    [Fact]
    public void Keeps_small_body_as_is()
    {
        var s = Sum("""{"body":"Đã sửa lỗi đăng nhập","status":"Review","n":3,"ok":true,"x":null}""");
        Assert.Equal("""{"body":"Đã sửa lỗi đăng nhập","status":"Review","n":3,"ok":true,"x":null}""", s);
    }

    [Theory]
    [InlineData("password")]
    [InlineData("newPassword")]
    [InlineData("access_token")]
    [InlineData("clientSecret")]
    [InlineData("otp")]
    [InlineData("baseSalary")]
    [InlineData("bankAccount")]
    [InlineData("idNumber")]
    [InlineData("code_verifier")]
    public void Masks_sensitive_keys(string key)
    {
        var s = Sum($$"""{"{{key}}":"abc123","name":"x"}""");
        using var doc = JsonDocument.Parse(s!);
        Assert.Equal(AiRequestSummary.Masked, doc.RootElement.GetProperty(key).GetString());
        Assert.Equal("x", doc.RootElement.GetProperty("name").GetString());
    }

    [Fact]
    public void Masks_nested_and_keeps_null_sensitive_as_null()
    {
        var s = Sum("""{"a":{"token":{"deep":1}},"secret":null}""");
        Assert.Equal("""{"a":{"token":"•••"},"secret":null}""", s);
    }

    [Fact]
    public void Cuts_long_strings_without_breaking_emoji()
    {
        var text = new string('a', AiRequestSummary.MaxString - 1) + "😀tail";
        var s = Sum(JsonSerializer.Serialize(new { body = text }));
        using var doc = JsonDocument.Parse(s!);
        var v = doc.RootElement.GetProperty("body").GetString()!;
        Assert.EndsWith("…", v);
        Assert.True(v.Length <= AiRequestSummary.MaxString + 1);
        Assert.DoesNotContain("tail", v);
    }

    [Fact]
    public void Limits_array_items()
    {
        var s = Sum(JsonSerializer.Serialize(new { ids = Enumerable.Range(1, 30).ToArray() }));
        using var doc = JsonDocument.Parse(s!);
        var arr = doc.RootElement.GetProperty("ids");
        Assert.Equal(21, arr.GetArrayLength());
        Assert.Equal("… +10", arr[20].GetString());
    }

    [Fact]
    public void Limits_depth()
    {
        var s = Sum("""{"a":{"b":{"c":{"d":{"e":{"f":1}}}}}}""");
        Assert.Contains("{…}", s);
    }

    [Fact]
    public void Shrinks_strings_then_gives_up_when_still_too_big()
    {
        // 10 trường × 500 ký tự > 4 KB → thu chuỗi còn 100 ký tự, vừa.
        var ten = Enumerable.Range(0, 10).ToDictionary(i => $"f{i}", _ => new string('x', 600));
        var s = Sum(JsonSerializer.Serialize(ten))!;
        Assert.True(Encoding.UTF8.GetByteCount(s) <= AiRequestSummary.MaxBytes);
        Assert.Contains(new string('x', 100) + "…", s);

        // Quá nhiều trường → chỉ ghi kích thước.
        var many = Enumerable.Range(0, 20).ToDictionary(i => $"field_{i}", i => Enumerable.Range(0, 20).Select(_ => new string('y', 50)).ToArray());
        var raw = JsonSerializer.Serialize(many);
        Assert.Equal($$"""{"_type":"truncated","bytes":{{Encoding.UTF8.GetByteCount(raw)}}}""", Sum(raw));
    }

    [Fact]
    public void Invalid_or_empty_body()
    {
        Assert.Null(AiRequestSummary.FromJson([]));
        Assert.Equal("""{"_type":"invalid_json","bytes":4}""", Sum("{bad"));
    }

    [Theory]
    [InlineData("POST", 200, true)]
    [InlineData("PUT", 400, true)]
    [InlineData("DELETE", 204, true)]
    [InlineData("GET", 200, false)]
    [InlineData("post", 403, false)]
    [InlineData("PATCH", 429, false)]
    public void Keeps_summary_only_for_allowed_writes(string method, int status, bool expected) =>
        Assert.Equal(expected, AuditRules.KeepsSummary(method, status));
}
