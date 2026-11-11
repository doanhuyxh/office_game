using System.Text;
using System.Text.Json;

namespace OfficeHub.Modules.Audit.Domain;

/// <summary>
/// Tóm tắt body JSON của lệnh ghi bằng token AI để người quản lý xem agent đã ghi gì.
/// Cắt chuỗi dài, giới hạn mảng / độ sâu, che khoá nhạy cảm; kết quả luôn là JSON hợp lệ ≤ <see cref="MaxBytes"/>.
/// </summary>
public static class AiRequestSummary
{
    /// <summary>Đọc tối đa từng này byte body (lớn hơn → coi như quá lớn, chỉ ghi kích thước).</summary>
    public const int MaxBodyBytes = 8 * 1024;
    public const int MaxBytes = 4 * 1024;
    public const int MaxString = 500;
    private const int ShortString = 100;
    private const int MaxArrayItems = 20;
    private const int MaxDepth = 5;
    public const string Masked = "•••";

    /// <summary>Khoá chứa một trong các chuỗi này (không phân biệt hoa thường) → che giá trị.</summary>
    private static readonly string[] SensitiveKeys =
        ["password", "token", "secret", "otp", "salary", "bank", "idnumber", "nationalid", "cccd", "apikey", "code_verifier"];

    public static bool IsSensitiveKey(string key)
    {
        var k = key.Replace("_", "").Replace("-", "");
        foreach (var s in SensitiveKeys)
            if (k.Contains(s.Replace("_", ""), StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    /// <summary>Body JSON → tóm tắt; body không phải JSON hợp lệ → <c>{"_type":"invalid_json","bytes":N}</c>; rỗng → null.</summary>
    public static string? FromJson(ReadOnlySpan<byte> body)
    {
        if (body.IsEmpty) return null;
        JsonDocument doc;
        try { doc = JsonDocument.Parse(body.ToArray()); }
        catch (JsonException) { return Meta("invalid_json", body.Length); }
        using (doc)
        {
            foreach (var max in new[] { MaxString, ShortString })
            {
                var s = Write(doc.RootElement, max);
                if (Encoding.UTF8.GetByteCount(s) <= MaxBytes) return s;
            }
            return Meta("truncated", body.Length);
        }
    }

    /// <summary>Body không đọc / không phải JSON (multipart, quá lớn…) → chỉ ghi loại + kích thước.</summary>
    public static string Meta(string type, long? bytes) =>
        bytes is { } n ? $"{{\"_type\":\"{type}\",\"bytes\":{n}}}" : $"{{\"_type\":\"{type}\"}}";

    private static string Write(JsonElement root, int maxString)
    {
        using var ms = new MemoryStream();
        using (var w = new Utf8JsonWriter(ms, new JsonWriterOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping }))
            WriteValue(w, root, maxString, 0);
        return Encoding.UTF8.GetString(ms.ToArray());
    }

    private static void WriteValue(Utf8JsonWriter w, JsonElement e, int maxString, int depth)
    {
        switch (e.ValueKind)
        {
            case JsonValueKind.Object:
                if (depth >= MaxDepth) { w.WriteStringValue("{…}"); return; }
                w.WriteStartObject();
                foreach (var p in e.EnumerateObject())
                {
                    w.WritePropertyName(Cut(p.Name, 64));
                    if (IsSensitiveKey(p.Name) && p.Value.ValueKind is not (JsonValueKind.Null or JsonValueKind.Undefined)) w.WriteStringValue(Masked);
                    else WriteValue(w, p.Value, maxString, depth + 1);
                }
                w.WriteEndObject();
                return;
            case JsonValueKind.Array:
                if (depth >= MaxDepth) { w.WriteStringValue("[…]"); return; }
                w.WriteStartArray();
                var i = 0;
                var total = e.GetArrayLength();
                foreach (var item in e.EnumerateArray())
                {
                    if (i++ == MaxArrayItems) { w.WriteStringValue($"… +{total - MaxArrayItems}"); break; }
                    WriteValue(w, item, maxString, depth + 1);
                }
                w.WriteEndArray();
                return;
            case JsonValueKind.String:
                w.WriteStringValue(Cut(e.GetString() ?? "", maxString));
                return;
            default:
                e.WriteTo(w); // số, true / false, null
                return;
        }
    }

    /// <summary>Cắt không tách đôi cặp surrogate (emoji) — Utf8JsonWriter từ chối UTF-16 lỗi.</summary>
    private static string Cut(string s, int max)
    {
        if (s.Length <= max) return s;
        var n = char.IsHighSurrogate(s[max - 1]) ? max - 1 : max;
        return s[..n] + "…";
    }
}
