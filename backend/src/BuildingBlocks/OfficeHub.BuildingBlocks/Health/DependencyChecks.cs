using System.Text.Json;
using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Hosting;
using Npgsql;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Storage;

namespace OfficeHub.BuildingBlocks.Health;

// Kiểm tra key trong .env có ĐÚNG không (không chỉ có hay không): thử kết nối thật tới từng dịch vụ.
// Xem kết quả: GET /health/ready

public sealed class PostgresCheck(IConfiguration cfg) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken ct = default)
    {
        await using var conn = new NpgsqlConnection(cfg.GetConnectionString("Default"));
        await conn.OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("select version()", conn);
        return HealthCheckResult.Healthy((string?)await cmd.ExecuteScalarAsync(ct));
    }
}

public sealed class S3Check(S3ClientProvider s3Provider) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken ct = default)
    {
        var (s3, cfg) = s3Provider.Get();
        var bucket = cfg.BucketFiles;
        var prefix = cfg.FilesPrefix;
        await s3.ListObjectsV2Async(new() { BucketName = bucket, Prefix = prefix, MaxKeys = 1 }, ct);
        return HealthCheckResult.Healthy($"s3://{bucket}/{prefix} truy cập được");
    }
}

public sealed class SmtpCheck(RuntimeConfig config) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken ct = default)
    {
        var c = config.Smtp;
        using var client = new SmtpClient { Timeout = 10_000, CheckCertificateRevocation = c.CheckCertificateRevocation };
        await client.ConnectAsync(c.Host, c.Port, c.UseSsl ? SecureSocketOptions.SslOnConnect : SecureSocketOptions.StartTlsWhenAvailable, ct);
        if (!string.IsNullOrEmpty(c.Username)) await client.AuthenticateAsync(c.Username, c.Password ?? "", ct);
        await client.DisconnectAsync(true, ct);
        return HealthCheckResult.Healthy($"{c.Host}:{c.Port} đăng nhập được");
    }
}

public static class HealthEndpoints
{
    /// <summary>/health: còn sống (cho Docker/Traefik). /health/ready: kiểm tra DB, S3, SMTP.</summary>
    public static void MapOfficeHubHealth(this WebApplication app)
    {
        app.MapHealthChecks("/health", new HealthCheckOptions { Predicate = _ => false });
        var showErrors = app.Environment.IsDevelopment();
        app.MapHealthChecks("/health/ready", new HealthCheckOptions
        {
            Predicate = r => r.Tags.Contains("ready"),
            ResponseWriter = (ctx, report) =>
            {
                ctx.Response.ContentType = "application/json; charset=utf-8";
                var body = new
                {
                    status = report.Status.ToString(),
                    checks = report.Entries.ToDictionary(e => e.Key, e => new
                    {
                        status = e.Value.Status.ToString(),
                        // Production không lộ chi tiết lỗi (có thể chứa host / user).
                        detail = showErrors ? e.Value.Exception?.Message ?? e.Value.Description : null,
                    }),
                };
                return ctx.Response.WriteAsync(JsonSerializer.Serialize(body, new JsonSerializerOptions { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping }));
            },
        });
    }
}
