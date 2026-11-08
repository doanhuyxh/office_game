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
        Assert.False(Map.CanStand(12, 30.2));
    }

    [Fact]
    public void Walls_block_except_doors()
    {
        // Tường nam phòng Giám đốc (z = 8), cửa ở x 8.5–9.5
        Assert.False(Map.CanStand(2.25, 7.95));
        Assert.True(Map.CanStand(8.75, 7.95));
        Assert.True(Map.CanStand(9.25, 8.1));
        // Tường giữa phòng Giám đốc và Hội trường (x = 10)
        Assert.False(Map.CanStand(9.95, 2.75));
    }

    [Fact]
    public void Solid_objects_block_but_seats_are_allowed()
    {
        var table = Map.Objects.Single(o => o.Id == "ml-table");
        Assert.False(Map.CanStand(table.X, table.Z));
        Assert.All(Map.Seats, s => Assert.True(Map.CanStand(s.X, s.Z), $"Không ngồi được ghế {s.Id}"));
    }

    [Fact]
    public void Can_sit_on_chairs_beanbags_and_sofas()
    {
        var sittable = Map.Objects.Where(o => OfficeMap.Sittable.Contains(o.Prefab)).ToList();
        Assert.Contains(sittable, o => o.Id.StartsWith("booth-1-chair"));   // phòng gọi
        Assert.Contains(sittable, o => o.Id.StartsWith("pantry-table-1-chair")); // pantry
        Assert.All(sittable, o => Assert.True(Map.CanStand(o.X, o.Z), $"Không ngồi được {o.Id}"));
        // sofa là vật cản trong lưới nhưng vẫn ngồi được
        var sofa = Map.Objects.First(o => o.Id == "lounge-sofa-2");
        Assert.False(Map.Nav.Walkable(sofa.X, sofa.Z));
        Assert.True(Map.CanStand(sofa.X, sofa.Z));
        // bàn (không phải đồ ngồi) vẫn bị chặn
        var table = Map.Objects.First(o => o.Id == "pantry-table-1");
        Assert.False(Map.CanStand(table.X, table.Z));
    }

    [Theory]
    [InlineData(7.85, 13.0, "dept-kth")]
    [InlineData(2.8, 11.0, "dept-kd")]
    [InlineData(26.0, 3.0, "meeting")]
    [InlineData(25.0, 28.0, "reception")]
    [InlineData(23.0, 19.0, "work")]
    [InlineData(46.5, 6.0, "quiet")]
    [InlineData(55.0, 5.0, "dept-studio")] // cánh đông Nội dung số
    [InlineData(56.0, 22.0, "studio-prep")]
    public void Zone_lookup(double x, double z, string zone) => Assert.Equal(zone, Map.ZoneAt(x, z));

    [Theory]
    [InlineData(26.0, 3.0, "meeting-large", true)] // phòng họp: kênh riêng, cả phòng nghe rõ
    [InlineData(16.0, 6.5, "meeting-hall", true)]
    [InlineData(48.0, 9.5, "booth-1", true)]
    [InlineData(3.0, 3.0, "bgd", false)] // phòng có tường nhưng không phải phòng họp: vẫn kênh riêng + chia sẻ màn hình
    [InlineData(55.0, 5.0, "studio", false)] // Studio Nội dung: kênh riêng của đội, nghe theo khoảng cách
    [InlineData(63.5, 5.0, "film-main", true)] // phòng quay / livestream / thu âm: như phòng họp
    [InlineData(65.0, 15.0, "live-1", true)]
    [InlineData(65.0, 27.0, "recording", true)]
    [InlineData(56.0, 22.0, "open", false)] // khu chuẩn bị Studio: kênh chung
    [InlineData(23.0, 19.0, "open", false)] // khu mở, sảnh, pantry: kênh chung theo khoảng cách
    [InlineData(25.0, 28.0, "open", false)]
    public void Voice_channel_by_position(double x, double z, string channel, bool meeting)
    {
        var ch = Map.VoiceAt(x, z);
        Assert.Equal(channel, ch.Id);
        Assert.Equal(meeting, ch.Meeting);
        Assert.Equal(channel != "open", ch.ScreenShare); // mọi phòng có tường được chia sẻ màn hình
        Assert.Equal($"officehub-{channel}", ch.LiveKitRoom);
    }
}
