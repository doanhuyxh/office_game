using Microsoft.Extensions.Caching.Memory;
using OfficeHub.BuildingBlocks.Office;
using OfficeHub.Mcp.Infrastructure;

namespace OfficeHub.Mcp.Tests;

/// <summary>Cửa vào POST /mcp/activity (TEST-94): cấu trúc lô sự kiện + giới hạn tần suất theo token.</summary>
public class BotActivityGateTests
{
    private static BotActivityEvent Event(string id = "e1", string kind = "command") => new(id, kind, Title: "Chạy lệnh");

    [Fact]
    public void Valid_batch_passes()
    {
        Assert.Null(BotActivityGate.Validate([Event()]));
        Assert.Null(BotActivityGate.Validate([Event("s", BotActivityFeedRoute.SessionStart), Event("e2", "thinking"), Event("e3", "say")]));
    }

    [Fact]
    public void Missing_or_empty_events_rejected()
    {
        Assert.Equal("Thiếu events", BotActivityGate.Validate(null));
        Assert.Equal("Thiếu events", BotActivityGate.Validate([]));
    }

    [Fact]
    public void Too_many_events_rejected()
    {
        var events = Enumerable.Range(0, BotActivityFeedRoute.MaxEvents + 1).Select(i => Event($"e{i}")).ToList();
        Assert.Contains($"Tối đa {BotActivityFeedRoute.MaxEvents}", BotActivityGate.Validate(events));
        Assert.Null(BotActivityGate.Validate(events.Take(BotActivityFeedRoute.MaxEvents).ToList()));
    }

    [Fact]
    public void Unknown_kind_and_missing_id_rejected_with_index()
    {
        Assert.StartsWith("events[1]: kind không hợp lệ", BotActivityGate.Validate([Event(), Event("e2", "screenshot")]));
        Assert.StartsWith("events[0]: kind không hợp lệ", BotActivityGate.Validate([Event() with { Kind = null! }]));
        Assert.Equal("events[1]: thiếu id", BotActivityGate.Validate([Event(), Event("  ")]));
    }

    [Fact]
    public void Rate_limit_is_per_token_per_second()
    {
        using var cache = new MemoryCache(new MemoryCacheOptions());
        for (var i = 0; i < BotActivityFeedRoute.McpMaxCallsPerSecond; i++)
            Assert.True(BotActivityGate.Allow(cache, "Bearer ohk_a", 100));
        Assert.False(BotActivityGate.Allow(cache, "Bearer ohk_a", 100)); // lần 6 cùng giây → 429
        Assert.True(BotActivityGate.Allow(cache, "Bearer ohk_b", 100));  // token khác không bị ảnh hưởng
        Assert.True(BotActivityGate.Allow(cache, "Bearer ohk_a", 101));  // sang giây mới → đếm lại
    }
}
