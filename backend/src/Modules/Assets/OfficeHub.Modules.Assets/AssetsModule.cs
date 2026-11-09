using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OfficeHub.BuildingBlocks.Modules;
using OfficeHub.BuildingBlocks.Persistence;
using OfficeHub.BuildingBlocks.Security;
using OfficeHub.Modules.Assets.Features;
using OfficeHub.Modules.Assets.Infrastructure;

namespace OfficeHub.Modules.Assets;

/// <summary>
/// Tài sản công ty: thiết bị (máy tính, màn hình…) và dịch vụ / tài khoản phần mềm (Figma, Google Workspace…). Cấp phát / thu hồi, nhắc bảo hành
/// và gia hạn, thu hồi khi nhân viên nghỉ việc, rà soát quyền định kỳ, kiểm kê, xuất Excel. Không lưu mật khẩu.
/// Tài khoản mạng xã hội (Facebook Business Manager): bàn giao cho nhân viên, đăng bài lên Fanpage (token System User mã hoá).
/// </summary>
public sealed class AssetsModule : IModule
{
    public string Name => "assets";

    public void Register(IServiceCollection services, IConfiguration config)
    {
        services.AddModuleDbContext<AssetsDbContext>(config, AssetsDbContext.Schema);
        services.AddSingleton<AssetClock>();
        services.AddScoped<AssetAccess>();
        services.AddScoped<AssetOps>();
        services.AddHostedService<AssetsMigrator>();
        services.AddHostedService<AssetsMaintenanceJob>();
        // Mạng xã hội (Facebook BM): token mã hoá bằng Encryption__Key, gọi Graph API, job đăng bài
        services.AddFieldEncryption(config);
        services.AddOptions<FacebookSettings>().Bind(config.GetSection(FacebookSettings.Section));
        services.AddHttpClient(FacebookGraph.HttpClientName, c => c.Timeout = TimeSpan.FromSeconds(120));
        services.AddScoped<IFacebookGraph, FacebookGraph>();
        services.AddScoped<SocialService>();
        services.AddSingleton<SocialPublishSignal>();
        services.AddHostedService<SocialPublishJob>();
    }

    public void MapEndpoints(IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/assets").WithTags("Assets").RequireAuthorization();
        DeviceEndpoints.Map(g);
        ServiceEndpoints.Map(g);
        HoldingEndpoints.Map(g);
        ReviewEndpoints.Map(g);
        StocktakeEndpoints.Map(g);
        ExportEndpoints.Map(g);
        HandoverEndpoints.Map(g);
        AttachmentEndpoints.Map(g);
        SocialAccountEndpoints.Map(g);
        SocialPostEndpoints.Map(g);
    }
}
