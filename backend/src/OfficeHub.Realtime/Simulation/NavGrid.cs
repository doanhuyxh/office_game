namespace OfficeHub.Realtime.Simulation;

/// <summary>
/// Lưới va chạm của văn phòng — PORT GIỐNG HỆT frontend/src/features/office/engine/navGrid.ts (phần dựng lưới + walkable).
/// Test tests/OfficeHub.Realtime.Tests so sánh <see cref="ToText"/> với shared/office-map.grid.txt (do bản TS ghi ra).
/// Dùng double (như số JS) để kết quả làm tròn trùng khớp.
/// </summary>
public sealed class NavGrid
{
    public const double WallHalf = 0.05;
    private const double Eps = 1e-6;
    private readonly Rect _floor;
    private readonly bool[] _blocked;

    public int Cols { get; }
    public int Rows { get; }
    public double G { get; }

    public NavGrid(OfficeMap map)
    {
        _floor = map.Floor;
        G = map.Grid;
        Cols = (int)Math.Round((_floor.X1 - _floor.X0) / G, MidpointRounding.AwayFromZero);
        Rows = (int)Math.Round((_floor.Z1 - _floor.Z0) / G, MidpointRounding.AwayFromZero);
        _blocked = new bool[Cols * Rows];
        foreach (var room in map.Rooms.Where(r => r.Walls))
            foreach (var s in WallSegments(room, room.Doors ?? [])) Mark(WallRect(room, s));
        foreach (var s in WallSegments(map.Floor, map.OuterDoors)) Mark(WallRect(map.Floor, s));
        foreach (var o in map.Objects.Where(o => o.Solid)) Mark(Footprint(o));
    }

    public static Rect Footprint(MapObject o)
    {
        var (w, d) = (long)Math.Round(o.Rot) % 180 == 0 ? (o.W, o.D) : (o.D, o.W);
        return new Rect(o.X - w / 2, o.X + w / 2, o.Z - d / 2, o.Z + d / 2);
    }

    private static double SideLength(Rect r, string side) => side is "n" or "s" ? r.X1 - r.X0 : r.Z1 - r.Z0;

    public static List<(string Side, double A, double B)> WallSegments(Rect r, IEnumerable<Door> doors)
    {
        var list = doors.ToList();
        var outList = new List<(string, double, double)>();
        foreach (var side in new[] { "n", "s", "w", "e" })
        {
            var len = SideLength(r, side);
            var gaps = list.Where(d => d.Side == side).Select(d => (A: d.At, B: d.At + d.W)).OrderBy(g => g.A).Append((A: len, B: len));
            double t = 0;
            foreach (var (a, b) in gaps)
            {
                if (a > t + Eps) outList.Add((side, t, a));
                t = Math.Max(t, b);
            }
        }
        return outList;
    }

    public static Rect WallRect(Rect r, (string Side, double A, double B) s) => s.Side switch
    {
        "n" => new Rect(r.X0 + s.A, r.X0 + s.B, r.Z0 - WallHalf, r.Z0 + WallHalf),
        "s" => new Rect(r.X0 + s.A, r.X0 + s.B, r.Z1 - WallHalf, r.Z1 + WallHalf),
        "w" => new Rect(r.X0 - WallHalf, r.X0 + WallHalf, r.Z0 + s.A, r.Z0 + s.B),
        _ => new Rect(r.X1 - WallHalf, r.X1 + WallHalf, r.Z0 + s.A, r.Z0 + s.B),
    };

    private void Mark(Rect r)
    {
        int i0 = Math.Max(0, (int)Math.Floor((r.X0 - _floor.X0) / G)), i1 = Math.Min(Cols - 1, (int)Math.Ceiling((r.X1 - _floor.X0) / G) - 1);
        int j0 = Math.Max(0, (int)Math.Floor((r.Z0 - _floor.Z0) / G)), j1 = Math.Min(Rows - 1, (int)Math.Ceiling((r.Z1 - _floor.Z0) / G) - 1);
        for (var j = j0; j <= j1; j++)
            for (var i = i0; i <= i1; i++)
            {
                double cx0 = _floor.X0 + i * G, cz0 = _floor.Z0 + j * G;
                if (r.X0 < cx0 + G - Eps && r.X1 > cx0 + Eps && r.Z0 < cz0 + G - Eps && r.Z1 > cz0 + Eps) _blocked[j * Cols + i] = true;
            }
    }

    public bool FreeCell(int i, int j) => i >= 0 && j >= 0 && i < Cols && j < Rows && !_blocked[j * Cols + i];

    public bool Walkable(double x, double z) =>
        FreeCell((int)Math.Floor((x - _floor.X0) / G), (int)Math.Floor((z - _floor.Z0) / G));

    /// <summary>'#' = chặn, '.' = trống, mỗi dòng một hàng z (giống NavGrid.toText ở FE).</summary>
    public string ToText()
    {
        var sb = new System.Text.StringBuilder();
        for (var j = 0; j < Rows; j++)
        {
            for (var i = 0; i < Cols; i++) sb.Append(_blocked[j * Cols + i] ? '#' : '.');
            sb.Append('\n');
        }
        return sb.ToString();
    }
}
