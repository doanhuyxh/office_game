using System.Text.Json;

namespace OfficeHub.Realtime.Simulation;

/// <summary>Bản đồ văn phòng đọc từ shared/office-map.json (cùng file FE dùng để vẽ).</summary>
public sealed record OfficeMap(int Version, string Name, Rect Floor, Point Spawn, Zone[] Zones)
{
    public static OfficeMap Load(string path) =>
        JsonSerializer.Deserialize<OfficeMap>(File.ReadAllText(path), new JsonSerializerOptions(JsonSerializerDefaults.Web))
        ?? throw new InvalidOperationException($"Không đọc được bản đồ {path}");

    public string? ZoneAt(float x, float z) => Zones.FirstOrDefault(zn => zn.Contains(x, z))?.Id;
}

public record Rect(float X0, float X1, float Z0, float Z1)
{
    public bool Contains(float x, float z) => x >= X0 && x <= X1 && z >= Z0 && z <= Z1;
}
public sealed record Zone(string Id, string Name, float X0, float X1, float Z0, float Z1) : Rect(X0, X1, Z0, Z1);
public sealed record Point(float X, float Z);
