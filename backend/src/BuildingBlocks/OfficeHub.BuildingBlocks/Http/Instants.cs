using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace OfficeHub.BuildingBlocks.Http;

/// <summary>
/// Hợp đồng thời điểm (instant) giữa BE ↔ FE / AI: ISO 8601 LUÔN kèm múi giờ.
/// - BE trả: UTC dạng <c>2026-11-06T02:14:39.0137Z</c> (FE tự đổi sang giờ Việt Nam).
/// - BE nhận: phải có <c>Z</c> hoặc <c>±HH:mm</c> (vd <c>2026-11-06T09:14:39+07:00</c>); thiếu múi giờ → từ chối
///   (không đoán theo giờ máy chủ — máy dev giờ VN, container UTC sẽ lệch 7 tiếng).
/// Không áp cho ngày (<c>DateOnly</c> "yyyy-MM-dd") và giờ trong ngày (<c>"HH:mm"</c>): đó là lịch / giờ đồng hồ tại văn phòng
/// (Office__TimeZone), không phải thời điểm.
/// </summary>
public static partial class Instants
{
    public const string MissingZoneMessage = "Thời gian phải ở dạng ISO 8601 kèm múi giờ, ví dụ 2026-11-06T09:00:00+07:00 hoặc 2026-11-06T02:00:00Z";

    public static string Format(DateTimeOffset value) =>
        value.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.FFFFFFF'Z'", CultureInfo.InvariantCulture);

    /// <summary>Chỉ nhận chuỗi có ngày + giờ + múi giờ; kết quả quy về UTC.</summary>
    public static bool TryParse(string? value, out DateTimeOffset result)
    {
        result = default;
        if (string.IsNullOrWhiteSpace(value) || !WithZone().IsMatch(value.Trim())) return false;
        if (!DateTimeOffset.TryParse(value.Trim(), CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed)) return false;
        result = parsed.ToUniversalTime();
        return true;
    }

    [GeneratedRegex(@"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,7})?)?(Z|[+-]\d{2}:\d{2})$", RegexOptions.IgnoreCase)]
    private static partial Regex WithZone();
}

/// <summary>Converter JSON cho <see cref="DateTimeOffset"/> (và <c>DateTimeOffset?</c>) theo <see cref="Instants"/>. Đăng ký ở AddOfficeHubDefaults.</summary>
public sealed class UtcInstantJsonConverter : JsonConverter<DateTimeOffset>
{
    public override DateTimeOffset Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        reader.TokenType == JsonTokenType.String && Instants.TryParse(reader.GetString(), out var v)
            ? v : throw new JsonException(Instants.MissingZoneMessage);

    public override void Write(Utf8JsonWriter writer, DateTimeOffset value, JsonSerializerOptions options) =>
        writer.WriteStringValue(Instants.Format(value));
}
