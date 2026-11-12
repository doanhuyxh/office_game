using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Email;
using OfficeHub.BuildingBlocks.Health;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.BuildingBlocks.Office;
using OfficeHub.BuildingBlocks.Storage;
using Serilog;

namespace OfficeHub.BuildingBlocks.Hosting;

public static class HostingExtensions
{
    /// <summary>Proxy được tin X-Forwarded-*: loopback + dải IP riêng (mạng Docker dùng 172.16/12, 192.168/16 hoặc 10/8).</summary>
    public static readonly string[] TrustedProxyNetworks = ["127.0.0.0/8", "::1/128", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7"];

    /// <summary>Cấu hình chung cho mọi host: log, Sentry, DataProtection, health check, proxy headers.</summary>
    public static WebApplicationBuilder AddOfficeHubDefaults(this WebApplicationBuilder builder, string serviceName)
    {
        var cfg = builder.Configuration;

        // Log: console + Seq (nếu có Seq__Url)
        builder.Host.UseSerilog((ctx, log) =>
        {
            log.ReadFrom.Configuration(ctx.Configuration)
               .Enrich.FromLogContext()
               .Enrich.WithProperty("service", serviceName)
               .WriteTo.Console();
            var seqUrl = ctx.Configuration["Seq:Url"];
            if (!string.IsNullOrWhiteSpace(seqUrl))
                log.WriteTo.Seq(seqUrl, apiKey: ctx.Configuration["Seq:ApiKey"]);
        });

        // Sentry: chỉ bật khi có Sentry__Dsn
        if (!string.IsNullOrWhiteSpace(cfg["Sentry:Dsn"]))
            builder.WebHost.UseSentry(o => o.Environment = builder.Environment.EnvironmentName);

        builder.Services.AddValidatedOptions<AppSettings>(cfg, AppSettings.Section);
        builder.Services.AddValidatedOptions<OfficeSettings>(cfg, OfficeSettings.Section);
        builder.Services.AddValidatedOptions<DataProtectionSettings>(cfg, DataProtectionSettings.Section);

        var keysPath = EnvLoader.ResolvePath(cfg["DataProtection:KeysPath"] ?? ".keys", builder.Environment.ContentRootPath);
        builder.Services.AddDataProtection()
            .SetApplicationName("OfficeHub")
            .PersistKeysToFileSystem(new DirectoryInfo(keysPath));

        builder.Services.AddSingleton(TimeProvider.System);
        builder.Services.AddSingleton<JobMonitor>(); // trạng thái job nền cho trang Hệ thống → Vận hành
        builder.Services.AddSingleton<RuntimeConfig>(); // cấu hình S3 / SMTP / FCM / IP văn phòng: DB (module Settings) rồi mới tới .env — TEST-41
        builder.Services.AddSingleton<OfficeNetwork>();
        // Body JSON sai (kiểu dữ liệu, thời điểm thiếu múi giờ…) → 400 ở MỌI môi trường (mặc định Development ném ra thành 500,
        // Production trả 400 không nội dung). Thông điệp tiếng Việt của Instants được giữ để FE / AI hiển thị.
        builder.Services.Configure<Microsoft.AspNetCore.Routing.RouteHandlerOptions>(o => o.ThrowOnBadRequest = true);
        builder.Services.Configure<ExceptionHandlerOptions>(o =>
            o.StatusCodeSelector = ex => ex is Microsoft.AspNetCore.Http.BadHttpRequestException bad ? bad.StatusCode : 500);
        builder.Services.AddProblemDetails(o => o.CustomizeProblemDetails = ctx =>
        {
            if (ctx.Exception is not Microsoft.AspNetCore.Http.BadHttpRequestException bad) return;
            ctx.ProblemDetails.Status = bad.StatusCode;
            ctx.ProblemDetails.Title = "Dữ liệu gửi lên không hợp lệ";
            ctx.ProblemDetails.Detail = bad.InnerException is System.Text.Json.JsonException { Message: Instants.MissingZoneMessage }
                ? Instants.MissingZoneMessage
                : "Dữ liệu gửi lên không đúng định dạng";
        });
        // Thời điểm trong JSON: trả UTC 'Z', nhận bắt buộc kèm múi giờ (Http/Instants.cs).
        builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.Converters.Add(new UtcInstantJsonConverter()));
        builder.Services.AddHealthChecks().AddCheck<PostgresCheck>("postgres", tags: ["ready"]);
        builder.Services.Configure<ForwardedHeadersOptions>(o =>
        {
            // Chạy sau nginx (container web) trong mạng Docker: tin X-Forwarded-* để lấy đúng IP client (chấm công văn phòng / từ xa).
            // CHỈ tin khi request tới từ loopback / dải mạng riêng (mạng Docker) — client gọi thẳng từ Internet không giả được IP / scheme.
            o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto | ForwardedHeaders.XForwardedHost;
            o.KnownIPNetworks.Clear();
            o.KnownProxies.Clear();
            foreach (var net in TrustedProxyNetworks) o.KnownIPNetworks.Add(System.Net.IPNetwork.Parse(net));
        });
        // Ngoài Development: cookie đăng nhập / 2FA luôn có cờ Secure, kể cả khi request tới qua HTTP (vd gọi thẳng cổng 7080).
        if (!builder.Environment.IsDevelopment())
            builder.Services.PostConfigureAll<Microsoft.AspNetCore.Authentication.Cookies.CookieAuthenticationOptions>(o =>
                o.Cookie.SecurePolicy = Microsoft.AspNetCore.Http.CookieSecurePolicy.Always);
        return builder;
    }

    public static IServiceCollection AddOfficeHubFileStorage(this IServiceCollection services, Microsoft.Extensions.Configuration.IConfiguration cfg)
    {
        services.AddValidatedOptions<S3Settings>(cfg, S3Settings.Section);
        services.AddSingleton<S3ClientProvider>(); // client tạo lại khi cấu hình S3 trong DB đổi
        services.AddSingleton<IFileStorage, S3FileStorage>();
        services.AddHealthChecks().AddCheck<S3Check>("s3", tags: ["ready"]);
        return services;
    }

    public static IServiceCollection AddOfficeHubEmail(this IServiceCollection services, Microsoft.Extensions.Configuration.IConfiguration cfg)
    {
        services.AddValidatedOptions<SmtpSettings>(cfg, SmtpSettings.Section);
        services.AddSingleton<IEmailSender, SmtpEmailSender>();
        services.AddHealthChecks().AddCheck<SmtpCheck>("smtp", tags: ["ready"]);
        return services;
    }

    public static WebApplication UseOfficeHubDefaults(this WebApplication app)
    {
        app.UseForwardedHeaders();
        app.UseExceptionHandler();
        app.UseStatusCodePages();
        app.UseSerilogRequestLogging();
        app.MapOfficeHubHealth();
        return app;
    }
}
