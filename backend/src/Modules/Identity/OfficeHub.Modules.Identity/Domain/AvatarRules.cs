using System.Text.Json;
using System.Text.Json.Nodes;

namespace OfficeHub.Modules.Identity.Domain;

/// <summary>
/// Ngoại hình nhân vật trong văn phòng 3D (bảng <c>identity.user_avatars</c>). Chỉ là JSON nhỏ do FE dựng; server kiểm tra
/// theo danh mục <c>shared/avatar-catalog.json</c> (nhúng vào assembly, sinh bởi <c>scripts/dev/import-characters.ts</c>).
/// Không có dòng = nhân vật mặc định chung (<c>default</c> trong danh mục).
/// </summary>
public sealed class UserAvatar
{
    public Guid UserId { get; set; }
    /// <summary>JSON đã chuẩn hoá bởi <see cref="AvatarRules.Normalize"/>.</summary>
    public string Look { get; set; } = "{}";
    public DateTimeOffset UpdatedAt { get; set; }
}

/// <summary>Danh mục dáng người → id các phần (đầu, áo, quần, giày) + số màu của mỗi bảng màu.</summary>
public sealed record AvatarCatalog(
    IReadOnlyDictionary<string, IReadOnlyDictionary<string, HashSet<string>>> Bodies,
    IReadOnlyDictionary<string, int> PaletteSizes)
{
    public const string ResourceName = "avatar-catalog.json";

    public static AvatarCatalog Parse(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        var bodies = new Dictionary<string, IReadOnlyDictionary<string, HashSet<string>>>();
        foreach (var body in root.GetProperty("bodies").EnumerateObject())
        {
            var slots = new Dictionary<string, HashSet<string>>();
            foreach (var slot in body.Value.GetProperty("parts").EnumerateObject())
                slots[slot.Name] = slot.Value.EnumerateArray().Select(p => p.GetProperty("id").GetString()!).ToHashSet();
            bodies[body.Name] = slots;
        }
        var palettes = root.GetProperty("palettes").EnumerateObject().ToDictionary(p => p.Name, p => p.Value.GetArrayLength());
        return new AvatarCatalog(bodies, palettes);
    }

    /// <summary>Danh mục nhúng trong assembly (từ shared/avatar-catalog.json lúc build).</summary>
    public static AvatarCatalog Embedded { get; } = LoadEmbedded();

    private static AvatarCatalog LoadEmbedded()
    {
        var asm = typeof(AvatarCatalog).Assembly;
        using var s = asm.GetManifestResourceStream(ResourceName)
            ?? throw new InvalidOperationException($"Thiếu tài nguyên nhúng {ResourceName} (shared/avatar-catalog.json)");
        using var r = new StreamReader(s);
        return Parse(r.ReadToEnd());
    }
}

public static class AvatarRules
{
    public static readonly string[] Slots = ["head", "top", "bottom", "shoes"];
    /// <summary>Ô màu → bảng màu trong danh mục. Giá trị null = màu gốc của model.</summary>
    public static readonly (string Field, string Palette)[] Colors =
        [("skin", "skin"), ("hair", "hair"), ("eyes", "eyes"), ("topColor", "cloth"), ("bottomColor", "cloth"), ("shoesColor", "cloth")];

    /// <summary>
    /// Kiểm tra + chuẩn hoá (bỏ trường lạ, sắp xếp cố định). Trả về JSON gọn, hoặc null kèm lỗi (field → thông điệp tiếng Việt).
    /// </summary>
    public static string? Normalize(JsonElement look, AvatarCatalog catalog, out Dictionary<string, string> errors)
    {
        errors = [];
        if (look.ValueKind != JsonValueKind.Object) { errors["look"] = "Dữ liệu nhân vật không hợp lệ"; return null; }
        if (!look.TryGetProperty("v", out var v) || v.ValueKind != JsonValueKind.Number || !v.TryGetInt32(out var ver) || ver != 1)
            errors["v"] = "Phiên bản dữ liệu nhân vật không hỗ trợ";
        var body = Str(look, "body");
        if (body is null || !catalog.Bodies.TryGetValue(body, out var parts))
        {
            errors["body"] = "Dáng người không hợp lệ";
            return null;
        }

        var o = new JsonObject { ["v"] = 1, ["body"] = body };
        foreach (var slot in Slots)
        {
            var id = Str(look, slot);
            if (id is null || !parts.TryGetValue(slot, out var ids) || !ids.Contains(id)) errors[slot] = $"Lựa chọn \"{slot}\" không có trong danh mục";
            else o[slot] = id;
        }
        foreach (var (field, palette) in Colors)
        {
            if (!look.TryGetProperty(field, out var c) || c.ValueKind == JsonValueKind.Null) { o[field] = null; continue; }
            var size = catalog.PaletteSizes.GetValueOrDefault(palette);
            if (c.ValueKind != JsonValueKind.Number || !c.TryGetInt32(out var i) || i < 0 || i >= size) errors[field] = "Màu không hợp lệ";
            else o[field] = i;
        }
        return errors.Count > 0 ? null : o.ToJsonString();
    }

    private static string? Str(JsonElement o, string name) =>
        o.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null;
}
