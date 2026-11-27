using System.Text.Json.Nodes;
using OfficeHub.Mcp.Tools;

namespace OfficeHub.Mcp.Tests;

/// <summary>TEST-256: kết quả tool giữ nguyên chữ tiếng Việt (không escape \uXXXX) — ít token hơn cho agent, JSON vẫn hợp lệ.</summary>
public class ToolOutputEncodingTests
{
    [Fact]
    public void Out_keeps_vietnamese_and_stays_valid_json()
    {
        var node = new JsonObject { ["title"] = "Đặc tả yêu cầu — \"trích\" <b>&", ["n"] = 1 };
        var s = ToolHelpers.Out(node);
        Assert.Contains("Đặc tả yêu cầu — ", s);
        Assert.DoesNotContain("\\u0110", s);
        Assert.Equal("Đặc tả yêu cầu — \"trích\" <b>&", (string)JsonNode.Parse(s)!["title"]!);
    }

    [Fact]
    public void Out_object_overload_keeps_vietnamese()
    {
        var s = ToolHelpers.Out((object)new { ten = "Nguyễn Văn Á" });
        Assert.Contains("Nguyễn Văn Á", s);
    }
}
