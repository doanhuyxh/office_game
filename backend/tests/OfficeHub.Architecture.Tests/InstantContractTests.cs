using System.Text.Json;
using OfficeHub.BuildingBlocks.Http;

namespace OfficeHub.Architecture.Tests;

/// <summary>Hợp đồng thời điểm BE ↔ FE: trả UTC 'Z', nhận bắt buộc kèm múi giờ (Http/Instants.cs).</summary>
public class InstantContractTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { Converters = { new UtcInstantJsonConverter() } };
    private sealed record Box(DateTimeOffset At, DateTimeOffset? Maybe);

    [Fact]
    public void Writes_utc_with_Z_even_for_local_offset()
    {
        var vn = new DateTimeOffset(2026, 11, 6, 9, 14, 39, TimeSpan.FromHours(7));
        var json = JsonSerializer.Serialize(new Box(vn, null), Json);
        Assert.Contains("\"at\":\"2026-11-06T02:14:39Z\"", json);
        Assert.Contains("\"maybe\":null", json);
    }

    [Theory]
    [InlineData("2026-11-06T09:14:39+07:00")]
    [InlineData("2026-11-06T02:14:39Z")]
    [InlineData("2026-11-06T02:14:39.123Z")]
    public void Reads_instants_with_zone_as_utc(string value)
    {
        var box = JsonSerializer.Deserialize<Box>($$"""{"at":"{{value}}","maybe":"{{value}}"}""", Json)!;
        Assert.Equal(TimeSpan.Zero, box.At.Offset);
        Assert.Equal(new DateTime(2026, 11, 6, 2, 14, 39), new DateTime(box.At.UtcDateTime.Ticks - box.At.UtcDateTime.Ticks % TimeSpan.TicksPerSecond));
        Assert.Equal(box.At, box.Maybe);
    }

    [Theory]
    [InlineData("2026-11-06T09:14:39")]   // thiếu múi giờ → không đoán theo giờ máy chủ
    [InlineData("2026-11-06")]
    [InlineData("06/11/2026 09:14")]
    public void Rejects_instants_without_zone(string value)
    {
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<Box>($$"""{"at":"{{value}}"}""", Json));
        Assert.False(Instants.TryParse(value, out _));
    }
}
