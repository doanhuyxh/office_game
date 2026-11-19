using System.Globalization;
using OfficeHub.BuildingBlocks.Ai;

namespace OfficeHub.Modules.Audit.Domain;

/// <summary>Một dòng (phiên × model) đưa vào tổng hợp — <see cref="AiSessionLedger.Summarize"/>.</summary>
public sealed record AiUsageRow(Guid SessionId, DateTimeOffset FinishedAt, decimal? SessionCostUsd, string Model,
    long? InputTokens, long? OutputTokens, long? CacheReadTokens, long? CacheWriteTokens, decimal? ModelCostUsd);

/// <param name="Bucket">yyyy-MM-dd | yyyy-MM | yyyy theo giờ văn phòng.</param>
/// <param name="CostUsd">Tổng các chi phí có; <paramref name="CostMissing"/> = số phiên (của model này) không có chi phí.</param>
public sealed record AiUsageGroup(string Bucket, string Model, int Sessions, long InputTokens, long OutputTokens,
    long CacheReadTokens, long CacheWriteTokens, decimal CostUsd, int CostMissing);

/// <summary>Tổng một kỳ (Bucket) hoặc toàn khoảng (Bucket = null): đếm theo PHIÊN, chi phí = chi phí phiên.</summary>
public sealed record AiUsageTotal(string? Bucket, int Sessions, long InputTokens, long OutputTokens, long CacheReadTokens, long CacheWriteTokens,
    decimal CostUsd, int CostMissing);

public sealed record AiUsageSummaryData(IReadOnlyList<AiUsageGroup> Groups, IReadOnlyList<AiUsageTotal> Buckets, AiUsageTotal Total);

/// <summary>
/// Quy tắc thuần của mức dùng AI theo phiên agent (TEST-134): chuẩn hoá phiên runner gửi, khoảng ngày, gộp ngày / tháng / năm theo giờ VN, quyền xem.
/// </summary>
public static class AiSessionLedger
{
    public const string Day = "day", Month = "month", Year = "year";
    /// <summary>Khoảng xem tối đa (ngày).</summary>
    public const int MaxRangeDays = 366 * 10;

    /// <summary>Phiên đã chuẩn hoá để lưu.</summary>
    public sealed record Normalized(string SourceId, string Kind, string Executor, string? TaskCode, decimal? CostUsd, IReadOnlyList<AiSessionModel> Models);

    /// <summary>
    /// Chuẩn hoá phiên đã qua <see cref="AiUsageRoute.Validate"/>: cắt khoảng trắng, mặc định kind / executor, gộp model trùng tên,
    /// không có model → một dòng <see cref="AiUsageRoute.UnknownModel"/>. Chi phí: phiên một model mà model không báo → lấy chi phí phiên;
    /// phiên không báo mà mọi model đều có → tổng các model.
    /// </summary>
    public static Normalized Normalize(AiUsageSession s)
    {
        var models = new List<AiSessionModel>();
        foreach (var m in (s.Models ?? []).OfType<AiUsageModel>())
        {
            var name = string.IsNullOrWhiteSpace(m.Model) ? AiUsageRoute.UnknownModel : m.Model.Trim();
            if (models.FirstOrDefault(x => x.Model == name) is { } same)
            {
                same.InputTokens = Add(same.InputTokens, m.InputTokens);
                same.OutputTokens = Add(same.OutputTokens, m.OutputTokens);
                same.CacheReadTokens = Add(same.CacheReadTokens, m.CacheReadTokens);
                same.CacheWriteTokens = Add(same.CacheWriteTokens, m.CacheWriteTokens);
                same.CostUsd = Add(same.CostUsd, m.CostUsd);
                continue;
            }
            models.Add(new AiSessionModel
            {
                Model = name, InputTokens = m.InputTokens, OutputTokens = m.OutputTokens,
                CacheReadTokens = m.CacheReadTokens, CacheWriteTokens = m.CacheWriteTokens, CostUsd = m.CostUsd,
            });
        }
        if (models.Count == 0) models.Add(new AiSessionModel { Model = AiUsageRoute.UnknownModel });

        var cost = s.CostUsd;
        if (models.Count == 1 && models[0].CostUsd is null) models[0].CostUsd = cost;
        if (cost is null && models.All(m => m.CostUsd is not null)) cost = models.Sum(m => m.CostUsd!.Value);

        return new Normalized(s.SourceId!.Trim(), s.Kind ?? AiUsageRoute.DefaultKind,
            string.IsNullOrWhiteSpace(s.Executor) ? AiUsageRoute.DefaultExecutor : s.Executor.Trim(),
            string.IsNullOrWhiteSpace(s.TaskCode) ? null : s.TaskCode.Trim(), cost, models);
    }

    /// <summary>Cộng hai giá trị có thể trống: cả hai trống → trống.</summary>
    private static long? Add(long? a, long? b) => a is null && b is null ? null : (a ?? 0) + (b ?? 0);
    private static decimal? Add(decimal? a, decimal? b) => a is null && b is null ? null : (a ?? 0) + (b ?? 0);

    public static bool IsGroup(string? group) => group is Day or Month or Year;

    /// <summary>Bộ lọc loại phiên (TEST-136): trống → null (mọi loại); khác <see cref="AiUsageRoute.Kinds"/> → false.</summary>
    public static bool TryKind(string? kind, out string? value)
    {
        value = string.IsNullOrWhiteSpace(kind) ? null : kind.Trim().ToLowerInvariant();
        return value is null || AiUsageRoute.Kinds.Contains(value);
    }

    /// <summary>Bộ lọc trạng thái phiên (TEST-195): trống → null (mọi trạng thái); khác <see cref="AiUsageRoute.Statuses"/> → false.</summary>
    public static bool TryStatus(string? status, out string? value)
    {
        value = string.IsNullOrWhiteSpace(status) ? null : status.Trim().ToLowerInvariant();
        return value is null || AiUsageRoute.Statuses.Contains(value);
    }

    /// <summary>
    /// Khoảng ngày (lịch VN, gồm 2 đầu) từ <c>from</c>/<c>to</c> yyyy-MM-dd. Trống: <c>to</c> = hôm nay; <c>from</c> theo nhóm —
    /// day: 30 ngày, month: đầu tháng 11 tháng trước (12 tháng), year: 1/1 bốn năm trước (5 năm).
    /// Sai định dạng / from &gt; to / quá <see cref="MaxRangeDays"/> ngày → null + field lỗi.
    /// </summary>
    public static (DateOnly From, DateOnly To)? ParseRange(string? from, string? to, string group, DateOnly today, out string? errorField)
    {
        errorField = null;
        DateOnly t = today, f;
        if (!string.IsNullOrWhiteSpace(to) && !TryDate(to, out t)) { errorField = "to"; return null; }
        if (!string.IsNullOrWhiteSpace(from))
        {
            if (!TryDate(from, out f)) { errorField = "from"; return null; }
        }
        else f = group switch
        {
            Month => new DateOnly(t.Year, t.Month, 1).AddMonths(-11),
            Year => new DateOnly(t.Year - 4, 1, 1),
            _ => t.AddDays(-29),
        };
        if (f > t || t.DayNumber - f.DayNumber > MaxRangeDays) { errorField = "from"; return null; }
        return (f, t);
    }

    private static bool TryDate(string s, out DateOnly d) =>
        DateOnly.TryParseExact(s.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out d);

    /// <summary>Kỳ của thời điểm kết thúc phiên theo giờ văn phòng: yyyy-MM-dd | yyyy-MM | yyyy.</summary>
    public static string BucketOf(DateTimeOffset finishedAt, TimeZoneInfo tz, string group)
    {
        var local = TimeZoneInfo.ConvertTime(finishedAt, tz);
        return group switch
        {
            Month => local.ToString("yyyy-MM", CultureInfo.InvariantCulture),
            Year => local.ToString("yyyy", CultureInfo.InvariantCulture),
            _ => local.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        };
    }

    /// <summary>
    /// Gộp theo (kỳ, model) + tổng từng kỳ + tổng cả khoảng. Một phiên nhiều model → đếm ở mỗi model, nhưng tổng kỳ / tổng chung đếm một lần
    /// với chi phí của phiên. Sắp theo kỳ tăng dần, rồi chi phí giảm dần, rồi tên model.
    /// </summary>
    public static AiUsageSummaryData Summarize(IEnumerable<AiUsageRow> rows, string group, TimeZoneInfo tz)
    {
        var list = rows.Select(r => (Bucket: BucketOf(r.FinishedAt, tz, group), Row: r)).ToList();
        var groups = list.GroupBy(x => (x.Bucket, x.Row.Model))
            .Select(g => new AiUsageGroup(g.Key.Bucket, g.Key.Model,
                g.Select(x => x.Row.SessionId).Distinct().Count(),
                g.Sum(x => x.Row.InputTokens ?? 0), g.Sum(x => x.Row.OutputTokens ?? 0),
                g.Sum(x => x.Row.CacheReadTokens ?? 0), g.Sum(x => x.Row.CacheWriteTokens ?? 0),
                g.Sum(x => x.Row.ModelCostUsd ?? 0), g.Count(x => x.Row.ModelCostUsd is null)))
            .OrderBy(g => g.Bucket, StringComparer.Ordinal).ThenByDescending(g => g.CostUsd).ThenBy(g => g.Model, StringComparer.Ordinal)
            .ToList();
        var buckets = list.GroupBy(x => x.Bucket).OrderBy(g => g.Key, StringComparer.Ordinal)
            .Select(g => Total(g.Key, g.Select(x => x.Row))).ToList();
        return new AiUsageSummaryData(groups, buckets, Total(null, list.Select(x => x.Row)));
    }

    private static AiUsageTotal Total(string? bucket, IEnumerable<AiUsageRow> rows)
    {
        var all = rows.ToList();
        var sessions = all.GroupBy(r => r.SessionId).Select(g => g.First().SessionCostUsd).ToList();
        return new AiUsageTotal(bucket, sessions.Count,
            all.Sum(r => r.InputTokens ?? 0), all.Sum(r => r.OutputTokens ?? 0), all.Sum(r => r.CacheReadTokens ?? 0), all.Sum(r => r.CacheWriteTokens ?? 0),
            sessions.Sum(c => c ?? 0), sessions.Count(c => c is null));
    }

    /// <summary>Kết quả quyền xem: <see cref="UserId"/> null = mọi người.</summary>
    public sealed record Scope(Guid? UserId);

    /// <summary>
    /// Ai được xem mức dùng của ai: không có <paramref name="userId"/> = của mình; id người khác hoặc <c>all</c> → chỉ admin / HR.
    /// Trả (scope, null) hoặc (null, lỗi): "invalid" (userId sai định dạng) | "forbidden".
    /// </summary>
    public static (Scope? Scope, string? Error) ResolveScope(Guid me, bool isAdminOrHr, string? userId)
    {
        if (string.IsNullOrWhiteSpace(userId)) return (new Scope(me), null);
        var v = userId.Trim();
        if (string.Equals(v, "all", StringComparison.OrdinalIgnoreCase)) return isAdminOrHr ? (new Scope(null), null) : (null, "forbidden");
        if (!Guid.TryParse(v, out var id)) return (null, "invalid");
        return id == me || isAdminOrHr ? (new Scope(id), null) : (null, "forbidden");
    }
}
