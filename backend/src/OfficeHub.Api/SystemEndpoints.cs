using System.Diagnostics;
using System.Reflection;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.Modules.Notification.Contracts;
using Scalar.AspNetCore;

namespace OfficeHub.Api;

/// <param name="Embeddable">Nhúng được vào trang (iframe) không: true / false / null = chưa kiểm tra được. <param name="EmbedNote">Lý do khi không / chưa biết.</param></param>
public sealed record SystemLinkDto(string Key, string Name, string? Url, string Note, bool? Embeddable = null, string? EmbedNote = null);
public sealed record HealthItemDto(string Name, string Status, string? Detail, double DurationMs);
public sealed record SmtpInfoDto(string Host, int Port, bool UseSsl, string? Username, string FromEmail, string FromName);
public sealed record SystemInfoDto(string Environment, string Version, DateTimeOffset ServerTime, string TimeZone, DateTimeOffset StartedAt,
    bool SeqEnabled, bool SentryEnabled, IReadOnlyList<SystemLinkDto> Links, SmtpInfoDto Smtp, IReadOnlyList<HealthItemDto> Health);

/// <summary>
/// Trang "Hệ thống" cho quản trị viên (role admin): đường dẫn tài liệu API, log (Seq), hộp thư / mail server, cấu hình SMTP và tình trạng
/// Postgres / S3 / SMTP. Prefix /api/system CỐ Ý ngoài allowlist token AI (AccessTokenAuth).
/// Link log / mail lấy từ SystemTools__LogsUrl / SystemTools__MailUrl (trống: Development dùng Seq :5341 / Mailpit :8025, Production ẩn link).
/// </summary>
internal static class SystemEndpoints
{
    public const string DocsPath = "/api/system/docs";
    private const string OpenApiPattern = "/api/system/openapi/{documentName}.json";

    public static void MapSystemEndpoints(this WebApplication app)
    {
        // Tài liệu API ở MỌI môi trường nhưng chỉ admin đã đăng nhập (cookie) xem được. Nằm dưới /api nên nginx production đã chuyển sang api.
        app.MapOpenApi(OpenApiPattern).RequireAuthorization(AuthPolicies.Admin);
        app.MapScalarApiReference(DocsPath, o => o.WithTitle("OfficeHub API").WithOpenApiRoutePattern(OpenApiPattern))
            .RequireAuthorization(AuthPolicies.Admin);

        app.MapGet("/api/system/info", InfoAsync).RequireAuthorization(AuthPolicies.Admin).WithTags("System");
        // Báo cáo dung lượng S3 (quét object, giữ 10 phút; refresh=true quét lại)
        app.MapGet("/api/system/storage", (bool? refresh, StorageReport report, CancellationToken ct) => report.GetAsync(refresh == true, ct))
            .RequireAuthorization(AuthPolicies.Admin).WithTags("System");
        // Vận hành: phiên bản, sao lưu, hàng đợi email, job nền (OpsReport.cs)
        app.MapGet("/api/system/ops", (OpsReport report, IEmailOutbox outbox, CancellationToken ct) => report.GetAsync(outbox, ct))
            .RequireAuthorization(AuthPolicies.Admin).WithTags("System");
        app.MapPost("/api/system/ops/email/retry", async (IEmailOutbox outbox, CancellationToken ct) => TypedResults.Ok(new { count = await outbox.RetryFailedAsync(ct) }))
            .RequireAuthorization(AuthPolicies.Admin).WithTags("System");
    }

    private static async Task<SystemInfoDto> InfoAsync(IConfiguration cfg, IHostEnvironment env, IOptions<SmtpSettings> smtp,
        IOptions<OfficeSettings> office, HealthCheckService health, TimeProvider clock, CancellationToken ct)
    {
        var dev = env.IsDevelopment();
        string? Link(string key, string devDefault)
        {
            var v = cfg[$"SystemTools:{key}"];
            return !string.IsNullOrWhiteSpace(v) ? v.Trim() : dev ? devDefault : null;
        }
        var seqEnabled = !string.IsNullOrWhiteSpace(cfg["Seq:Url"]);
        var (mailUrl, mailNote) = MailLink(cfg["SystemTools:MailUrl"], smtp.Value.Host);
        var links = new List<SystemLinkDto>
        {
            new("docs", "Tài liệu API (Scalar / OpenAPI)", DocsPath + "/",
                "Thử gọi API bằng phiên đăng nhập hiện tại — cẩn thận với các lệnh ghi dữ liệu trên production."),
            new("logs", "Log hệ thống (Seq)", Link("LogsUrl", "http://localhost:5341"),
                seqEnabled
                    ? "Production: Seq chỉ mở trên 127.0.0.1:5341 của VPS — dùng `ssh -L 5341:127.0.0.1:5341 <vps>` rồi mở http://localhost:5341, hoặc đặt SystemTools__LogsUrl."
                    : "Chưa bật gửi log sang Seq (Seq__Url trống) — log chỉ có ở `docker compose logs`."),
            new("mail", "Hộp thư / mail server", mailUrl, mailNote),
        };

        // Kiểm tra song song từng link có nhúng được vào trang không (nút "Xem trong trang")
        var checks = await Task.WhenAll(links.Select(l => EmbedCheck.CheckAsync(l.Url, cfg["App:BaseUrl"], clock, ct)));
        links = [.. links.Select((l, i) => l with { Embeddable = checks[i].Embeddable, EmbedNote = checks[i].Note })];

        var report = await health.CheckHealthAsync(r => r.Tags.Contains("ready"), ct);
        var items = report.Entries.Select(e => new HealthItemDto(e.Key, e.Value.Status.ToString(),
            e.Value.Status == HealthStatus.Healthy ? null : e.Value.Description ?? e.Value.Exception?.Message,
            Math.Round(e.Value.Duration.TotalMilliseconds))).ToList();

        var s = smtp.Value;
        var version = typeof(SystemEndpoints).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "?";
        return new SystemInfoDto(env.EnvironmentName, version, clock.GetUtcNow(), office.Value.TimeZone,
            new DateTimeOffset(Process.GetCurrentProcess().StartTime.ToUniversalTime(), TimeSpan.Zero),
            seqEnabled, !string.IsNullOrWhiteSpace(cfg["Sentry:Dsn"]), links,
            new SmtpInfoDto(s.Host, s.Port, s.UseSsl, string.IsNullOrWhiteSpace(s.Username) ? null : s.Username, s.FromEmail, s.FromName), items);
    }

    /// <summary>
    /// Link hộp thư: SystemTools__MailUrl nếu có; không thì suy từ Smtp__Host — Mailpit (localhost / mailpit → :8025), Gmail → mail.google.com.
    /// </summary>
    private static (string? Url, string Note) MailLink(string? configured, string smtpHost)
    {
        if (!string.IsNullOrWhiteSpace(configured)) return (configured.Trim(), $"Email gửi qua {smtpHost}.");
        var host = smtpHost.Trim().ToLowerInvariant();
        if (host is "localhost" or "127.0.0.1" or "mailpit")
            return ("http://localhost:8025", "Mailpit bắt mọi email gửi đi (không tới hộp thư thật).");
        if (host.EndsWith("gmail.com", StringComparison.Ordinal))
            return ("https://mail.google.com", $"Email gửi qua Gmail ({smtpHost}) — mở mục \"Đã gửi\" của tài khoản SMTP bên dưới.");
        return (null, $"Email gửi qua {smtpHost}. Đặt SystemTools__MailUrl = trang quản trị của nhà cung cấp SMTP.");
    }
}
