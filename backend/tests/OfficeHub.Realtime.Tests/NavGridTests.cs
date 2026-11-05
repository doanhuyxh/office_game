using OfficeHub.Realtime.Simulation;

namespace OfficeHub.Realtime.Tests;

/// <summary>Kiểm tra bản đồ thật (shared/office-map.json) + lưới va chạm của server.</summary>
public class NavGridTests
{
    private static readonly string Shared = FindShared();
    private static readonly OfficeMap Map = OfficeMap.Load(Path.Combine(Shared, "office-map.json"));

    private static string FindShared()
    {
        for (var d = new DirectoryInfo(AppContext.BaseDirectory); d is not null; d = d.Parent)
            if (File.Exists(Path.Combine(d.FullName, "shared", "office-map.json"))) return Path.Combine(d.FullName, "shared");
        throw new InvalidOperationException("Không tìm thấy shared/office-map.json");
    }

    [Fact]
    public void Server_grid_matches_frontend_grid()
    {
        var expected = File.ReadAllText(Path.Combine(Shared, "office-map.grid.txt")).Replace("\r\n", "\n");
        Assert.True(expected == Map.Nav.ToText(),
            "Lưới C# (NavGrid.cs) khác lưới FE (navGrid.ts). Sửa bản đồ / thuật toán xong phải chạy: bun design/tools/render-plan.ts, và giữ 2 bản code giống hệt.");
    }

    [Fact]
    public void Spawn_is_walkable_and_outside_floor_is_not()
    {
        Assert.True(Map.CanStand(Map.Spawn.X, Map.Spawn.Z));
        Assert.False(Map.CanStand(-1, 5));
        Assert.False(Map.CanStand(12, 16.2));
    }

    [Fact]
    public void Walls_block_except_doors()
    {
        // Tường nam phòng Giám đốc (z = 5.5), cửa ở x 4–5
        Assert.False(Map.CanStand(2.25, 5.45));
        Assert.True(Map.CanStand(4.25, 5.45));
        Assert.True(Map.CanStand(4.75, 5.6));
        // Tường giữa phòng Giám đốc và phòng họp lớn (x = 6)
        Assert.False(Map.CanStand(5.95, 2.75));
    }

    [Fact]
    public void Solid_objects_block_but_seats_are_allowed()
    {
        var table = Map.Objects.Single(o => o.Id == "ml-table");
        Assert.False(Map.CanStand(table.X, table.Z));
        Assert.All(Map.Seats, s => Assert.True(Map.CanStand(s.X, s.Z), $"Không ngồi được ghế {s.Id}"));
    }

    [Theory]
    [InlineData(3.5, 7.0, "dept-kth")]
    [InlineData(11.0, 6.5, "dept-kd")]
    [InlineData(10.0, 3.0, "meeting")]
    [InlineData(11.5, 14.0, "reception")]
    [InlineData(10.5, 10.5, "work")]
    public void Zone_lookup(double x, double z, string zone) => Assert.Equal(zone, Map.ZoneAt(x, z));

    [Theory]
    [InlineData(10.0, 3.0, "meeting-large", true)] // phòng họp: kênh riêng, chia sẻ màn hình
    [InlineData(22.5, 7.0, "booth-1", true)]
    [InlineData(3.0, 3.0, "bgd", false)] // phòng có tường nhưng không phải phòng họp: vẫn kênh riêng
    [InlineData(10.5, 10.5, "open", false)] // khu mở, sảnh, pantry: kênh chung theo khoảng cách
    [InlineData(11.5, 14.0, "open", false)]
    public void Voice_channel_by_position(double x, double z, string channel, bool meeting)
    {
        var ch = Map.VoiceAt(x, z);
        Assert.Equal(channel, ch.Id);
        Assert.Equal(meeting, ch.Meeting);
        Assert.Equal($"officehub-{channel}", ch.LiveKitRoom);
    }
}
