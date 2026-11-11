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

    public (int I, int J) CellOf(double x, double z) => ((int)Math.Floor((x - _floor.X0) / G), (int)Math.Floor((z - _floor.Z0) / G));
    public (double X, double Z) Center(int i, int j) => (_floor.X0 + (i + 0.5) * G, _floor.Z0 + (j + 0.5) * G);

    /// <summary>Hình tròn bán kính r đứng được không (tâm + 4 góc) — như fits() ở FE.</summary>
    public bool Fits(double x, double z, double r) =>
        Walkable(x, z) && Walkable(x - r, z - r) && Walkable(x + r, z - r) && Walkable(x - r, z + r) && Walkable(x + r, z + r);

    /// <summary>Ô trống gần (x, z) nhất (loang theo vòng vuông) — như nearestFree() ở FE.</summary>
    public (int I, int J)? NearestFree(double x, double z)
    {
        var (si, sj) = CellOf(x, z);
        for (var rad = 0; rad < Math.Max(Cols, Rows); rad++)
            for (var j = sj - rad; j <= sj + rad; j++)
                for (var i = si - rad; i <= si + rad; i++)
                    if ((Math.Abs(i - si) == rad || Math.Abs(j - sj) == rad) && FreeCell(i, j)) return (i, j);
        return null;
    }

    /// <summary>Đi thẳng a → b (hình tròn bán kính r) không vướng.</summary>
    public bool ClearLine((double X, double Z) a, (double X, double Z) b, double r)
    {
        var len = Math.Sqrt((b.X - a.X) * (b.X - a.X) + (b.Z - a.Z) * (b.Z - a.Z));
        var steps = Math.Max(1, (int)Math.Ceiling(len / 0.1));
        for (var k = 0; k <= steps; k++)
        {
            var t = (double)k / steps;
            if (!Fits(a.X + (b.X - a.X) * t, a.Z + (b.Z - a.Z) * t, r)) return false;
        }
        return true;
    }

    /// <summary>
    /// A* 8 hướng (không cắt góc tường) → các điểm đi qua đã làm mượt; rỗng nếu không tới được. PORT GIỐNG findPath() ở
    /// frontend/src/features/office/engine/navGrid.ts (bot đi bộ trên server — 2026-11-11).
    /// </summary>
    public List<(double X, double Z)> FindPath(double fromX, double fromZ, double toX, double toZ, double radius = 0.22)
    {
        (int I, int J)? start = Walkable(fromX, fromZ) ? CellOf(fromX, fromZ) : NearestFree(fromX, fromZ);
        (int I, int J)? goal = Walkable(toX, toZ) ? CellOf(toX, toZ) : NearestFree(toX, toZ);
        if (start is null || goal is null) return [];
        var n = Cols * Rows;
        int Idx(int i, int j) => j * Cols + i;
        var gScore = new double[n];
        Array.Fill(gScore, double.PositiveInfinity);
        var came = new int[n];
        Array.Fill(came, -1);
        var closed = new bool[n];
        var (gi, gj) = goal.Value;
        double H(int i, int j) { double dx = Math.Abs(i - gi), dy = Math.Abs(j - gj); return dx + dy + (Math.Sqrt(2) - 2) * Math.Min(dx, dy); }
        var open = new PriorityQueue<int, double>();
        int s = Idx(start.Value.I, start.Value.J), gl = Idx(gi, gj);
        gScore[s] = 0;
        open.Enqueue(s, H(start.Value.I, start.Value.J));
        while (open.TryDequeue(out var cur, out _))
        {
            if (cur == gl) break;
            if (closed[cur]) continue;
            closed[cur] = true;
            int ci = cur % Cols, cj = cur / Cols;
            for (var dj = -1; dj <= 1; dj++)
                for (var di = -1; di <= 1; di++)
                {
                    if (di == 0 && dj == 0) continue;
                    int ni = ci + di, nj = cj + dj;
                    if (!FreeCell(ni, nj)) continue;
                    if (di != 0 && dj != 0 && (!FreeCell(ci + di, cj) || !FreeCell(ci, cj + dj))) continue; // không cắt góc
                    var next = Idx(ni, nj);
                    var tentative = gScore[cur] + (di != 0 && dj != 0 ? Math.Sqrt(2) : 1);
                    if (tentative < gScore[next]) { gScore[next] = tentative; came[next] = cur; open.Enqueue(next, tentative + H(ni, nj)); }
                }
        }
        if (s != gl && came[gl] < 0) return [];
        var cells = new List<(double X, double Z)>();
        for (var c = gl; c != -1; c = c == s ? -1 : came[c]) cells.Add(Center(c % Cols, c / Cols));
        cells.Reverse();
        if (Walkable(toX, toZ) && Fits(toX, toZ, radius)) cells[^1] = (toX, toZ);
        var path = new List<(double X, double Z)>();
        var from = (fromX, fromZ);
        var k = 1;
        while (k < cells.Count)
        {
            var far = k;
            while (far + 1 < cells.Count && ClearLine(from, cells[far + 1], radius)) far++;
            path.Add(cells[far]);
            from = cells[far];
            k = far + 1;
        }
        if (path.Count == 0 && cells.Count > 0) path.Add(cells[^1]);
        return path;
    }

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
