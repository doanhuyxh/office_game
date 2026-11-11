using System.Globalization;
using System.Text;

namespace OfficeHub.Realtime.Simulation;

/// <summary>Chỗ bot đi tới được (tool MCP <c>go_to</c> / <c>list_office_places</c>). Kind: room | zone | desk | person.</summary>
public sealed record OfficePlace(string Id, string Kind, string Name);

/// <summary>Điểm đứng / ngồi cụ thể khi tới nơi. <see cref="SpotKey"/>: id bàn / ghế để không ngồi chồng lên nhau (null = đứng).</summary>
public sealed record BotSpot(double X, double Z, float Angle, bool Sit, string? SpotKey, string PlaceName, string? RoomId);

/// <summary>Ghế rời ngồi được (chair / beanbag) + góc quay mặt về bàn gần nhất — port chairAngle() ở FE (engine/sitSpots.ts).</summary>
public sealed record ChairSpot(string Id, double X, double Z, float Angle);

public static class OfficePlaces
{
    public const string DeskId = "desk";
    private static readonly string[] DeskAliases = ["desk", "ban cua toi", "ban lam viec", "cho ngoi", "ve ban", "my desk"];

    /// <summary>Bỏ dấu tiếng Việt + chữ thường + gộp khoảng trắng để so tên chỗ.</summary>
    public static string Fold(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return "";
        var d = s.Trim().ToLowerInvariant().Replace('đ', 'd').Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder(d.Length);
        foreach (var c in d)
            if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark) sb.Append(char.IsWhiteSpace(c) || c is '-' or '_' ? ' ' : c);
        return string.Join(' ', sb.ToString().Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }

    /// <summary>Phòng (có tên), khu phòng ban, "bàn của tôi", người đang trong văn phòng (trừ chính mình).</summary>
    public static List<OfficePlace> List(OfficeMap map, IEnumerable<(string Id, string Name)> people, string? exceptUserId = null)
    {
        var list = new List<OfficePlace> { new(DeskId, "desk", "Bàn của tôi") };
        list.AddRange(map.Rooms.Where(r => !string.IsNullOrWhiteSpace(r.Name)).Select(r => new OfficePlace(r.Id, "room", r.Name)));
        list.AddRange(map.Areas.Select(a => new OfficePlace(a.Id, "zone", a.Name)));
        list.AddRange(people.Where(p => p.Id != exceptUserId).Select(p => new OfficePlace(p.Id, "person", p.Name)));
        return list;
    }

    /// <summary>
    /// Tìm chỗ theo chữ người / AI gõ: "bàn của tôi" → desk; khớp đúng id / tên (bỏ dấu) → chỗ đó; không thì chứa chuỗi, chỉ khi duy nhất.
    /// Bỏ tiền tố "cạnh / gần / phòng …" khi tìm người. Null + <paramref name="ambiguous"/> khi khớp nhiều chỗ.
    /// </summary>
    public static OfficePlace? Resolve(string? query, IReadOnlyList<OfficePlace> places, out List<OfficePlace> ambiguous)
    {
        ambiguous = [];
        var q = Fold(query);
        if (q.Length == 0) return null;
        if (DeskAliases.Contains(q)) return places.FirstOrDefault(p => p.Kind == "desk");
        foreach (var prefix in new[] { "canh ", "gan ", "toi ", "den ", "vao " })
            if (q.StartsWith(prefix, StringComparison.Ordinal)) { q = q[prefix.Length..]; break; }
        var exact = places.Where(p => Fold(p.Id) == q || Fold(p.Name) == q).ToList();
        if (exact.Count == 1) return exact[0];
        if (exact.Count > 1) { ambiguous = exact; return null; }
        var partial = places.Where(p => p.Kind != "desk" && (Fold(p.Name).Contains(q, StringComparison.Ordinal) || Fold(p.Id).Contains(q, StringComparison.Ordinal))).ToList();
        if (partial.Count == 1) return partial[0];
        ambiguous = partial;
        return null;
    }

    /// <summary>Ghế rời trong bản đồ + góc ngồi (quay về bàn / quầy gần nhất ≤ 2,5 m).</summary>
    public static ChairSpot[] Chairs(OfficeMap map) =>
        map.Objects.Where(o => o.Prefab is "chair" or "beanbag").Select(o => new ChairSpot(o.Id, o.X, o.Z, ChairAngle(o, map.Objects))).ToArray();

    private static float ChairAngle(MapObject o, MapObject[] all)
    {
        MapObject? best = null;
        var bd = 2.5;
        foreach (var t in all)
        {
            if (ReferenceEquals(t, o) || !(t.Prefab.StartsWith("table", StringComparison.Ordinal) || t.Prefab.StartsWith("desk", StringComparison.Ordinal)
                                           || t.Prefab.StartsWith("kitchenCounter", StringComparison.Ordinal))) continue;
            var dist = Math.Sqrt((t.X - o.X) * (t.X - o.X) + (t.Z - o.Z) * (t.Z - o.Z));
            if (dist < bd) { bd = dist; best = t; }
        }
        return best is null ? 0f : (float)Math.Atan2(best.X - o.X, best.Z - o.Z);
    }
}
