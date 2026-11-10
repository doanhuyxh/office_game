using System.Diagnostics;
using System.Reflection;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Hosting;
using OfficeHub.Modules.Notification.Contracts;

namespace OfficeHub.Api;

/// <param name="Commit">Commit Git lúc build image (deploy.sh truyền GIT_SHA); null khi chạy dev / build tay.</param>
/// <param name="TimeZone">Múi giờ nghiệp vụ của server (<c>Office__TimeZone</c>), vd Asia/Ho_Chi_Minh.</param>
/// <param name="UtcOffset">Độ lệch hiện tại so với UTC, vd "+07:00".</param>
public sealed record BuildInfoDto(string? Commit, DateTimeOffset? BuiltAt, string AssemblyVersion, DateTimeOffset StartedAt, string Environment,
    string TimeZone = "", string UtcOffset = "");

/// <summary>Bản sao lưu mới nhất của một loại (db = Postgres .dump, keys = khoá DataProtection).</summary>
public sealed record BackupItemDto(string Kind, string? LatestKey, DateTimeOffset? LatestAt, long? LatestBytes, int Count, long TotalBytes);

/// <param name="Status">ok / stale (bản mới nhất quá <see cref="OpsReport.BackupMaxAge"/>) / missing (chưa có bản nào) / unconfigured / error.</param>
public sealed record BackupStatusDto(string Status, string? Bucket, string? Prefix, string? Message, IReadOnlyList<BackupItemDto> Items);

/// <param name="Status">ok / late (quá 2 chu kỳ chưa chạy xong) / failing (lần cuối lỗi) / waiting (chưa tới lần chạy đầu).</param>
public sealed record JobStatusDto(string Key, string Name, double IntervalMinutes, DateTimeOffset? LastStartedAt, DateTimeOffset? LastFinishedAt,
    double? LastDurationMs, bool? LastSucceeded, string? LastError, DateTimeOffset? LastErrorAt, int Runs, int Failures, bool Running, string Status);

public sealed record OpsReportDto(DateTimeOffset GeneratedAt, BuildInfoDto Build, BackupStatusDto Backup, EmailQueueStats Email, IReadOnlyList<JobStatusDto> Jobs);

/// <summary>
/// Tab "Vận hành" trang Hệ thống (chỉ admin): phiên bản đang chạy, bản sao lưu mới nhất trên S3 (<c>{S3__KeyPrefix}backup/db|keys/</c> ở
/// <c>S3__BucketBackup</c>, do container backup ghi mỗi 24 giờ), hàng đợi email, job nền của tiến trình Api (<see cref="JobMonitor"/>).
/// </summary>
public sealed class OpsReport(IAmazonS3 s3, IOptions<S3Settings> s3Options, IOptions<OfficeSettings> office, IConfiguration cfg, IHostEnvironment env,
    JobMonitor jobs, TimeProvider clock, ILogger<OpsReport> log)
{
    /// <summary>Backup chạy mỗi 24 giờ → quá 26 giờ chưa có bản mới là bất thường.</summary>
    public static readonly TimeSpan BackupMaxAge = TimeSpan.FromHours(26);

    public async Task<OpsReportDto> GetAsync(IEmailOutbox outbox, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        return new(now, Build(), await BackupAsync(now, ct), await outbox.StatsAsync(ct), [.. jobs.Snapshot().Select(j => ToDto(j, now))]);
    }

    private BuildInfoDto Build()
    {
        var commit = cfg["OFFICEHUB_COMMIT"];
        var built = DateTimeOffset.TryParse(cfg["OFFICEHUB_BUILD_TIME"], out var b) ? b : (DateTimeOffset?)null;
        var asm = typeof(OpsReport).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "?";
        if (string.IsNullOrWhiteSpace(commit) || commit == "unknown") commit = CommitFromVersion(asm);
        var tz = TimeZoneInfo.FindSystemTimeZoneById(office.Value.TimeZone);
        var offset = tz.GetUtcOffset(clock.GetUtcNow());
        return new(commit?.Trim(), built, asm, new DateTimeOffset(Process.GetCurrentProcess().StartTime.ToUniversalTime(), TimeSpan.Zero),
            env.EnvironmentName, tz.Id, $"{(offset < TimeSpan.Zero ? "-" : "+")}{offset:hh\\:mm}");
    }

    /// <summary>Build từ thư mục có .git (dev): SDK ghi "1.0.0+&lt;sha đầy đủ&gt;" → 7 ký tự đầu. Image Docker không có .git → dùng OFFICEHUB_COMMIT.</summary>
    public static string? CommitFromVersion(string informationalVersion)
    {
        var i = informationalVersion.IndexOf('+');
        if (i < 0) return null;
        var sha = informationalVersion[(i + 1)..];
        return sha.Length >= 7 && sha.All(char.IsAsciiHexDigit) ? sha[..7] : null;
    }

    public static string JobState(JobStatus j, DateTimeOffset now)
    {
        if (j.LastSucceeded == false) return "failing";
        // Quá 2 chu kỳ (+ 5 phút trễ khởi động) mà chưa chạy xong lần nào / kể từ lần cuối → trễ
        var since = j.LastFinishedAt ?? j.RegisteredAt;
        if (now - since > j.Interval * 2 + TimeSpan.FromMinutes(5)) return "late";
        return j.LastFinishedAt is null ? "waiting" : "ok";
    }

    private static JobStatusDto ToDto(JobStatus j, DateTimeOffset now) =>
        new(j.Key, j.Name, Math.Round(j.Interval.TotalMinutes, 2), j.LastStartedAt, j.LastFinishedAt, j.LastDurationMs, j.LastSucceeded, j.LastError,
            j.LastErrorAt, j.Runs, j.Failures, j.Running, JobState(j, now));

    private async Task<BackupStatusDto> BackupAsync(DateTimeOffset now, CancellationToken ct)
    {
        var bucket = cfg["S3:BucketBackup"]?.Trim();
        var keyPrefix = s3Options.Value.KeyPrefix;
        var prefix = (string.IsNullOrWhiteSpace(keyPrefix) ? "" : keyPrefix.Trim().Trim('/') + "/") + "backup/";
        if (string.IsNullOrWhiteSpace(bucket))
            return new("unconfigured", null, prefix, "Chưa đặt S3__BucketBackup — container backup không có nơi ghi.", []);
        var items = new List<BackupItemDto>();
        try
        {
            foreach (var kind in new[] { "db", "keys" })
            {
                S3Object? latest = null;
                int count = 0;
                long total = 0;
                string? token = null;
                do
                {
                    var page = await s3.ListObjectsV2Async(new ListObjectsV2Request { BucketName = bucket, Prefix = $"{prefix}{kind}/", ContinuationToken = token }, ct);
                    foreach (var o in page.S3Objects ?? [])
                    {
                        count++;
                        total += o.Size ?? 0;
                        if (latest is null || o.LastModified > latest.LastModified) latest = o;
                    }
                    token = page.IsTruncated == true ? page.NextContinuationToken : null;
                } while (token is not null && count < 10_000);
                var at = latest?.LastModified is { } lm ? new DateTimeOffset(lm.ToUniversalTime(), TimeSpan.Zero) : (DateTimeOffset?)null;
                items.Add(new(kind, latest?.Key, at, latest?.Size, count, total));
            }
        }
        catch (AmazonS3Exception ex)
        {
            log.LogWarning("Vận hành: không đọc được bucket sao lưu {Bucket} ({Status})", bucket, ex.StatusCode);
            return new("error", bucket, prefix, $"Không đọc được bucket sao lưu ({ex.StatusCode}). Kiểm tra quyền s3:ListBucket của khoá S3.", items);
        }
        var db = items.First(i => i.Kind == "db");
        var status = db.LatestAt is not { } last ? "missing" : now - last > BackupMaxAge ? "stale" : "ok";
        var msg = status switch
        {
            "missing" => "Chưa có bản sao lưu nào — kiểm tra container backup (docker compose logs backup).",
            "stale" => $"Bản sao lưu mới nhất đã quá {BackupMaxAge.TotalHours:0} giờ — container backup có thể đã dừng.",
            _ => null,
        };
        return new(status, bucket, prefix, msg, items);
    }
}
