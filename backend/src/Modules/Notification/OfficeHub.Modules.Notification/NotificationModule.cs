using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OfficeHub.BuildingBlocks.Modules;
using OfficeHub.BuildingBlocks.Persistence;
using OfficeHub.BuildingBlocks.Security;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Notification.Features;
using OfficeHub.Modules.Notification.Infrastructure;

namespace OfficeHub.Modules.Notification;

/// <summary>Thông báo in-app (chuông trên header) + email gửi nền qua hàng đợi trong DB. Module khác gọi qua <see cref="INotifier"/>.</summary>
public sealed class NotificationModule : IModule
{
    public string Name => "notifications";

    public void Register(IServiceCollection services, IConfiguration config)
    {
        services.AddModuleDbContext<NotificationDbContext>(config, NotificationDbContext.Schema);
        services.AddOptions<FirebaseSettings>().Bind(config.GetSection(FirebaseSettings.Section));
        services.AddScoped<IPushSender, PushSender>();
        services.AddScoped<INotifier, Notifier>();
        services.AddFieldEncryption(config); // khoá ký webhook lưu mã hoá
        services.AddEncryptedColumns<NotificationDbContext, Domain.Webhook>(nameof(Domain.Webhook.SecretEncrypted)); // job xoay khoá (TEST-17)
        services.AddScoped<IWebhookPublisher, WebhookPublisher>();
        services.AddHttpClient(WebhookDispatcher.ClientName)
            .ConfigurePrimaryHttpMessageHandler(sp => WebhookDispatcher.CreateHandler(
                allowPrivate: sp.GetRequiredService<Microsoft.Extensions.Hosting.IHostEnvironment>().EnvironmentName == "Development"));
        services.AddScoped<IEmailOutbox, EmailOutbox>(); // trang Hệ thống → Vận hành
        services.AddHostedService<NotificationMigrator>(); // trước EmailDispatcher: bảng phải có trước khi worker quét
        services.AddHostedService<EmailDispatcher>();
        services.AddHostedService<WebhookDispatcher>();
    }

    public void MapEndpoints(IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/notifications").WithTags("Notification").RequireAuthorization();
        NotificationEndpoints.Map(g);
        WebhookEndpoints.Map(g.MapGroup("/webhook"));
    }
}
