using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OfficeHub.BuildingBlocks.Modules;
using OfficeHub.BuildingBlocks.Persistence;
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
        services.AddHostedService<NotificationMigrator>(); // trước EmailDispatcher: bảng phải có trước khi worker quét
        services.AddHostedService<EmailDispatcher>();
    }

    public void MapEndpoints(IEndpointRouteBuilder api) =>
        NotificationEndpoints.Map(api.MapGroup("/notifications").WithTags("Notification").RequireAuthorization());
}
