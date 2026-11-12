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
        services.AddSingleton<FirebaseProvider>(); // FCM theo cấu hình DB / .env (TEST-41)
        services.AddScoped<IPushSender, PushSender>();
        services.AddScoped<INotifier, Notifier>();
        services.AddFieldEncryption(config); // khoá ký webhook lưu mã hoá
        services.AddEncryptedColumns<NotificationDbContext, Domain.Webhook>(nameof(Domain.Webhook.SecretEncrypted)); // job xoay khoá (TEST-17)
        services.AddScoped<IWebhookPublisher, WebhookPublisher>();
        services.AddHttpClient(WebhookDispatcher.ClientName)
            .ConfigurePrimaryHttpMessageHandler(sp => WebhookDispatcher.CreateHandler(
                allowPrivate: sp.GetRequiredService<Microsoft.Extensions.Hosting.IHostEnvironment>().EnvironmentName == "Development"));
        // TEST-42: kênh Telegram đánh thức agent. URL Bot API chứa token → tắt log của HttpClient này.
        services.AddHttpClient(TelegramClient.ClientName).RemoveAllLoggers();
        services.AddSingleton<TelegramClient>();
        services.AddScoped<ITelegramWakeup, TelegramWakeup>();
        services.AddScoped<IEmailOutbox, EmailOutbox>(); // trang Hệ thống → Vận hành
        services.AddHostedService<NotificationMigrator>(); // trước EmailDispatcher: bảng phải có trước khi worker quét
        services.AddHostedService<EmailDispatcher>();
        services.AddHostedService<WebhookDispatcher>();
        services.AddHostedService<TelegramDispatcher>();
    }

    public void MapEndpoints(IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/notifications").WithTags("Notification").RequireAuthorization();
        NotificationEndpoints.Map(g);
        WebhookEndpoints.Map(g.MapGroup("/webhook"));
    }
}
