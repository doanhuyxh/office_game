using System.Text.Json;

namespace OfficeHub.Realtime.Simulation;

/// <summary>
/// Bản đồ văn phòng v2 đọc từ shared/office-map.json (cùng file FE dùng để vẽ). Kiểu dữ liệu khớp
/// frontend/src/features/office/engine/mapTypes.ts. Lưới va chạm: <see cref="NavGrid"/>.
/// </summary>
public sealed record OfficeMap(int Version, string Name, double Grid, Rect Floor, Point Spawn, Door[] OuterDoors, Room[] Rooms, Area[] Areas,
    Seat[] Seats, MapObject[] Objects)
{
    /// <summary>Đứng trên ghế (ngồi) được chấp nhận dù ô có thể bị bàn chạm vào. Sai số theo toạ độ client gửi.</summary>
    public const double SeatTolerance = 0.05;

    public NavGrid Nav { get; private init; } = null!;

    /// <summary>Footprint các đồ ngồi được (<see cref="Sittable"/>), tính một lần lúc nạp bản đồ.</summary>
    public Rect[] SitAreas { get; private init; } = [];

    public static OfficeMap Load(string path)
    {
        var map = JsonSerializer.Deserialize<OfficeMap>(File.ReadAllText(path), new JsonSerializerOptions(JsonSerializerDefaults.Web))
                  ?? throw new InvalidOperationException($"Không đọc được bản đồ {path}");
        if (map.Version != 2) throw new InvalidOperationException($"Bản đồ {path} phải là version 2 (đang là {map.Version})");
        return map with
        {
            Nav = new NavGrid(map),
            SitAreas = map.Objects.Where(o => Sittable.Contains(o.Prefab)).Select(NavGrid.Footprint).ToArray(),
        };
    }

    /// <summary>
    /// Đồ ngồi được ngoài bàn làm việc (ghế phòng họp / phòng gọi / pantry, ghế lười, sofa). Khớp SITTABLE_PREFABS ở FE
    /// (frontend/src/features/office/engine/sitSpots.ts) — FE tính chỗ ngồi cụ thể, server chỉ cần điểm nằm trong footprint đồ đó.
    /// </summary>
    public static readonly string[] Sittable = ["chair", "beanbag", "loungeSofa", "loungeSofaCorner"];

    /// <summary>Vị trí hợp lệ: ô trống trong lưới, đúng chỗ ngồi ở bàn làm việc, hoặc trên một đồ ngồi được.</summary>
    public bool CanStand(double x, double z) =>
        Nav.Walkable(x, z)
        || Seats.Any(s => Math.Abs(s.X - x) <= SeatTolerance && Math.Abs(s.Z - z) <= SeatTolerance)
        || SitAreas.Any(f => x >= f.X0 - SeatTolerance && x <= f.X1 + SeatTolerance && z >= f.Z0 - SeatTolerance && z <= f.Z1 + SeatTolerance);

    /// <summary>Khu phòng ban trong khu mở trước, rồi tới phòng (giống NavGrid.zoneAt ở FE).</summary>
    public string? ZoneAt(double x, double z) =>
        Areas.FirstOrDefault(a => a.Contains(x, z))?.Id
        ?? (Rooms.FirstOrDefault(r => r.Walls && r.Contains(x, z)) ?? Rooms.FirstOrDefault(r => r.Contains(x, z)))?.Zone;

    /// <summary>
    /// Kênh voice tại vị trí: đứng trong phòng có tường → kênh riêng của phòng đó (người ngoài không nghe được);
    /// còn lại → kênh chung "open" (FE giảm âm lượng theo khoảng cách). Giống voiceChannelAt ở FE (engine/voiceChannel.ts).
    /// </summary>
    public VoiceChannel VoiceAt(double x, double z) =>
        Rooms.FirstOrDefault(r => r.Walls && r.Contains(x, z)) is { } room
            ? new VoiceChannel(room.Id, room.Voice == "room")
            : new VoiceChannel(VoiceChannel.Open, false);

    /// <summary>Ngưỡng nghe theo khoảng cách (m) — PHẢI khớp VOICE_FAR ở FE (engine/voiceChannel.ts: voiceVolume tắt hẳn từ 6 m).</summary>
    public const double HearRange = 6;

    /// <summary>
    /// Hai vị trí nghe được nhau (luật voice — TEST-95 dùng cho phạm vi xem bot): phải cùng kênh (<see cref="VoiceAt"/>);
    /// phòng <c>voice: "room"</c> (họp) → cả phòng; còn lại (khu mở, phòng có tường khác) → cách nhau ≤ <see cref="HearRange"/> + <paramref name="slack"/>.
    /// </summary>
    public bool CanHear(double x1, double z1, double x2, double z2, double slack = 0)
    {
        var channel = VoiceAt(x1, z1);
        if (channel.Id != VoiceAt(x2, z2).Id) return false;
        if (channel.Meeting) return true;
        double dx = x1 - x2, dz = z1 - z2, range = HearRange + slack;
        return dx * dx + dz * dz <= range * range;
    }
}

/// <summary>Kênh voice. <c>Meeting</c> = phòng có <c>voice: "room"</c>: cả phòng nghe rõ như nhau.</summary>
public sealed record VoiceChannel(string Id, bool Meeting)
{
    public const string Open = "open";
    /// <summary>Mọi phòng có tường (kênh riêng, server bảo vệ) được chia sẻ màn hình — chỉ người trong phòng xem được. Khu mở thì không.</summary>
    public bool ScreenShare => Id != Open;
    /// <summary>Tên room LiveKit (có tiền tố để không đụng project khác dùng chung server LiveKit).</summary>
    public string LiveKitRoom => $"officehub-{Id}";
}

public record Rect(double X0, double X1, double Z0, double Z1)
{
    public bool Contains(double x, double z) => x >= X0 && x <= X1 && z >= Z0 && z <= Z1;
}
public sealed record Point(double X, double Z);
public sealed record Door(string Side, double At, double W, string? Id = null, string? Name = null);
public sealed record Room(string Id, string Name, string Kind, string Zone, bool Walls, double X0, double X1, double Z0, double Z1, Door[]? Doors = null,
    bool Glass = false, int? Capacity = null, string? Voice = null) : Rect(X0, X1, Z0, Z1);
public sealed record Area(string Id, string Name, string Dept, double X0, double X1, double Z0, double Z1) : Rect(X0, X1, Z0, Z1);
public sealed record Seat(string Id, string Dept, string Zone, double X, double Z, string Facing);
public sealed record MapObject(string Id, string Prefab, double X, double Z, double W, double D, double Rot, bool Solid, string? Action = null, string? Interact = null);
