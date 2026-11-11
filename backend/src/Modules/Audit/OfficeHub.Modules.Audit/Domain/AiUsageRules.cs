using System.Globalization;

namespace OfficeHub.Modules.Audit.Domain;

/// <summary>Quy tắc thuần của báo cáo sử dụng trợ lý AI (trang Báo cáo → tab Trợ lý AI).</summary>
public static class AiUsageRules
{
    public const int DefaultDays = 30;

    /// <summary>
    /// Khoảng ngày (lịch VN, gồm cả 2 đầu) từ query <c>from</c>/<c>to</c> dạng yyyy-MM-dd. Trống → <see cref="DefaultDays"/> ngày gần nhất
    /// tính tới hôm nay. Không quá hôm nay, không cũ hơn hạn lưu nhật ký (<see cref="AuditRules.AiRetentionDays"/> ngày).
    /// Sai định dạng / from &gt; to → (null, field lỗi).
    /// </summary>
    public static (DateOnly From, DateOnly To)? ParseRange(string? from, string? to, DateOnly today, out string? errorField)
    {
        errorField = null;
        DateOnly? f = null, t = null;
        if (!string.IsNullOrWhiteSpace(from))
        {
            if (!TryDate(from, out var d)) { errorField = "from"; return null; }
            f = d;
        }
        if (!string.IsNullOrWhiteSpace(to))
        {
            if (!TryDate(to, out var d)) { errorField = "to"; return null; }
            t = d;
        }
        var end = t is { } te && te < today ? te : today;
        var start = f ?? end.AddDays(-(DefaultDays - 1));
        var oldest = today.AddDays(-(AuditRules.AiRetentionDays - 1));
        if (start < oldest) start = oldest;
        if (start > end) { errorField = "from"; return null; }
        return (start, end);
    }

    /// <summary>Mốc UTC của [00:00 ngày from, 00:00 ngày sau to) theo múi giờ văn phòng.</summary>
    public static (DateTimeOffset Start, DateTimeOffset End) ToInstants(DateOnly from, DateOnly to, TimeZoneInfo tz) =>
        (StartOfDay(from, tz), StartOfDay(to.AddDays(1), tz));

    private static DateTimeOffset StartOfDay(DateOnly d, TimeZoneInfo tz)
    {
        var local = d.ToDateTime(TimeOnly.MinValue, DateTimeKind.Unspecified);
        return new DateTimeOffset(local, tz.GetUtcOffset(local)).ToUniversalTime();
    }

    private static bool TryDate(string s, out DateOnly d) =>
        DateOnly.TryParseExact(s.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out d);

    /// <summary>Phòng ban <paramref name="rootId"/> và mọi phòng ban con cháu (cây ParentId).</summary>
    public static HashSet<Guid> WithDescendants(Guid rootId, IEnumerable<(Guid Id, Guid? ParentId)> departments)
    {
        var children = departments.Where(d => d.ParentId is not null).ToLookup(d => d.ParentId!.Value, d => d.Id);
        var result = new HashSet<Guid> { rootId };
        var stack = new Stack<Guid>([rootId]);
        while (stack.Count > 0)
            foreach (var c in children[stack.Pop()])
                if (result.Add(c)) stack.Push(c);
        return result;
    }

    /// <summary>Đủ các ngày trong khoảng (ngày không có request → 0) để biểu đồ không bị hụt cột.</summary>
    public static List<T> FillDays<T>(DateOnly from, DateOnly to, IReadOnlyDictionary<DateOnly, T> byDay, Func<DateOnly, T> empty)
    {
        var list = new List<T>();
        for (var d = from; d <= to; d = d.AddDays(1)) list.Add(byDay.TryGetValue(d, out var v) ? v : empty(d));
        return list;
    }
}
