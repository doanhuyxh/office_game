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

    public static OfficeMap Load(string path)
    {
        var map = JsonSerializer.Deserialize<OfficeMap>(File.ReadAllText(path), new JsonSerializerOptions(JsonSerializerDefaults.Web))
                  ?? throw new InvalidOperationException($"Không đọc được bản đồ {path}");
        if (map.Version != 2) throw new InvalidOperationException($"Bản đồ {path} phải là version 2 (đang là {map.Version})");
        return map with { Nav = new NavGrid(map) };
    }

    /// <summary>Vị trí hợp lệ: ô trống trong lưới, hoặc đúng chỗ ngồi.</summary>
    public bool CanStand(double x, double z) => Nav.Walkable(x, z) || Seats.Any(s => Math.Abs(s.X - x) <= SeatTolerance && Math.Abs(s.Z - z) <= SeatTolerance);

    /// <summary>Khu phòng ban trong khu mở trước, rồi tới phòng (giống NavGrid.zoneAt ở FE).</summary>
    public string? ZoneAt(double x, double z) =>
        Areas.FirstOrDefault(a => a.Contains(x, z))?.Id
        ?? (Rooms.FirstOrDefault(r => r.Walls && r.Contains(x, z)) ?? Rooms.FirstOrDefault(r => r.Contains(x, z)))?.Zone;
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
