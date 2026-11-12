using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Storage;

namespace OfficeHub.Api;

public sealed record StorageGroupDto(string Bucket, string Prefix, string Label, long Objects, long Bytes, DateTimeOffset? LastModified);
public sealed record StorageObjectDto(string Bucket, string Key, long Bytes, DateTimeOffset? LastModified, string StorageClass);
public sealed record StorageCountDto(string Key, string Label, long Objects, long Bytes);
public sealed record StorageReportDto(DateTimeOffset GeneratedAt, string KeyPrefix, IReadOnlyList<string> Buckets, long TotalObjects, long TotalBytes,
    bool Truncated, decimal EstimatedUsdPerMonth, IReadOnlyList<StorageGroupDto> Groups, IReadOnlyList<StorageCountDto> ByClass,
    IReadOnlyList<StorageCountDto> Monthly, IReadOnlyList<StorageObjectDto> Largest);

/// <summary>
/// Báo cáo dung lượng S3 của OfficeHub (trang Hệ thống, chỉ admin): liệt kê mọi object dưới <c>{S3__KeyPrefix}</c> ở các bucket
/// <c>S3__BucketFiles</c> / <c>S3__BucketBackup</c> / <c>S3__BucketWeb</c> (trùng thì quét 1 lần), gom theo mục đích (2 cấp thư mục đầu),
/// lớp lưu trữ, tháng tải lên (12 tháng), 15 file lớn nhất. Quét tối đa <see cref="MaxObjects"/> object; kết quả giữ 10 phút (nút "Quét lại" bỏ qua).
/// Chi phí chỉ là ước tính theo giá S3 Standard tham khảo (<see cref="UsdPerGbMonth"/>), chưa gồm request / băng thông.
/// </summary>
public sealed class StorageReport(S3ClientProvider s3Provider, IConfiguration cfg, TimeProvider clock, ILogger<StorageReport> log)
{
    public const int MaxObjects = 200_000;
    public const decimal UsdPerGbMonth = 0.025m;
    private static readonly TimeSpan CacheFor = TimeSpan.FromMinutes(10);
    private static readonly SemaphoreSlim Gate = new(1, 1);
    private static StorageReportDto? _cached;

    /// <summary>Nhãn tiếng Việt theo thư mục (sau KeyPrefix) — khớp key mà code / script đang ghi.</summary>
    private static readonly (string Prefix, string Label)[] Labels =
    [
        ("files/documents", "Kho tài liệu (tài sản số)"),
        ("files/contracts", "Hợp đồng lao động + file đã ký"),
        ("files/contract-templates", "Mẫu hợp đồng Word"),
        ("files/employees", "Ảnh đại diện nhân viên"),
        ("backup/db", "Sao lưu cơ sở dữ liệu"),
        ("backup/keys", "Sao lưu khoá mã hoá"),
        ("web/releases", "Bản build giao diện web"),
    ];

    public async Task<StorageReportDto> GetAsync(bool refresh, CancellationToken ct)
    {
        if (!refresh && _cached is { } c && clock.GetUtcNow() - c.GeneratedAt < CacheFor) return c;
        await Gate.WaitAsync(ct);
        try
        {
            if (!refresh && _cached is { } c2 && clock.GetUtcNow() - c2.GeneratedAt < CacheFor) return c2;
            return _cached = await ScanAsync(ct);
        }
        finally { Gate.Release(); }
    }

    private async Task<StorageReportDto> ScanAsync(CancellationToken ct)
    {
        var (s3, o) = s3Provider.Get();
        var prefix = string.IsNullOrWhiteSpace(o.KeyPrefix) ? "" : o.KeyPrefix.Trim().Trim('/') + "/";
        var buckets = new[] { o.BucketFiles, cfg["S3:BucketBackup"], cfg["S3:BucketWeb"] }
            .Where(b => !string.IsNullOrWhiteSpace(b)).Select(b => b!.Trim()).Distinct().ToList();

        var groups = new Dictionary<(string, string), (long N, long B, DateTimeOffset? Last)>();
        var classes = new Dictionary<string, (long N, long B)>();
        var monthly = new Dictionary<string, (long N, long B)>();
        var largest = new List<StorageObjectDto>();
        long total = 0, bytes = 0;
        var truncated = false;
        foreach (var bucket in buckets)
        {
            string? token = null;
            do
            {
                ListObjectsV2Response page;
                try
                {
                    page = await s3.ListObjectsV2Async(new ListObjectsV2Request { BucketName = bucket, Prefix = prefix, ContinuationToken = token }, ct);
                }
                catch (AmazonS3Exception ex) when (ex.StatusCode is System.Net.HttpStatusCode.Forbidden or System.Net.HttpStatusCode.NotFound)
                {
                    log.LogWarning("Báo cáo S3: không đọc được bucket {Bucket} ({Status})", bucket, ex.StatusCode);
                    break;
                }
                foreach (var obj in page.S3Objects ?? [])
                {
                    var size = obj.Size ?? 0;
                    var modified = obj.LastModified is { } lm ? new DateTimeOffset(lm.ToUniversalTime(), TimeSpan.Zero) : (DateTimeOffset?)null;
                    var rel = obj.Key.Length > prefix.Length ? obj.Key[prefix.Length..] : obj.Key;
                    var parts = rel.Split('/');
                    var group = parts.Length > 2 ? $"{parts[0]}/{parts[1]}" : parts.Length == 2 ? parts[0] : "(gốc)";
                    var g = groups.GetValueOrDefault((bucket, group));
                    groups[(bucket, group)] = (g.N + 1, g.B + size, modified > g.Last || g.Last is null ? modified : g.Last);
                    var cls = obj.StorageClass?.Value ?? "STANDARD";
                    var cc = classes.GetValueOrDefault(cls);
                    classes[cls] = (cc.N + 1, cc.B + size);
                    if (modified is { } m)
                    {
                        var key = m.ToString("yyyy-MM");
                        var mm = monthly.GetValueOrDefault(key);
                        monthly[key] = (mm.N + 1, mm.B + size);
                    }
                    largest.Add(new StorageObjectDto(bucket, rel, size, modified, cls));
                    if (largest.Count > 200) largest = [.. largest.OrderByDescending(x => x.Bytes).Take(15)];
                    total++;
                    bytes += size;
                }
                token = page.IsTruncated == true ? page.NextContinuationToken : null;
                if (total >= MaxObjects && token is not null) { truncated = true; token = null; }
            } while (token is not null);
        }

        var now = clock.GetUtcNow();
        var firstMonth = new DateTime(now.Year, now.Month, 1).AddMonths(-11);
        var months = Enumerable.Range(0, 12).Select(i => firstMonth.AddMonths(i)).Select(m =>
        {
            var v = monthly.GetValueOrDefault(m.ToString("yyyy-MM"));
            return new StorageCountDto(m.ToString("yyyy-MM"), $"T{m.Month}/{m.Year % 100:D2}", v.N, v.B);
        }).ToList();
        return new StorageReportDto(now, prefix, buckets, total, bytes, truncated,
            Math.Round(bytes / 1024m / 1024m / 1024m * UsdPerGbMonth, 2),
            groups.Select(kv => new StorageGroupDto(kv.Key.Item1, kv.Key.Item2, LabelOf(kv.Key.Item2), kv.Value.N, kv.Value.B, kv.Value.Last))
                .OrderByDescending(x => x.Bytes).ToList(),
            classes.Select(kv => new StorageCountDto(kv.Key, kv.Key, kv.Value.N, kv.Value.B)).OrderByDescending(x => x.Bytes).ToList(),
            months,
            [.. largest.OrderByDescending(x => x.Bytes).Take(15)]);
    }

    internal static string LabelOf(string group) =>
        Labels.FirstOrDefault(l => group == l.Prefix || group.StartsWith(l.Prefix + "/", StringComparison.Ordinal)).Label ?? group switch
        {
            "files" => "File nghiệp vụ khác",
            "backup" => "Sao lưu khác",
            "web" => "Web khác",
            _ => "Khác",
        };
}
