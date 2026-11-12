using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Modules;
using OfficeHub.BuildingBlocks.Persistence;
using OfficeHub.BuildingBlocks.Security;
using OfficeHub.Modules.Settings.Features;
using OfficeHub.Modules.Settings.Infrastructure;

namespace OfficeHub.Modules.Settings;

/// <summary>
/// Cấu hình hệ thống lưu trong DB (TEST-41): S3, SMTP, FCM, IP văn phòng. Admin sửa ở trang Hệ thống → Cấu hình; có hiệu lực ngay qua
/// <see cref="RuntimeConfig"/> (BuildingBlocks). Nhóm chưa lưu → đọc .env như trước.
/// </summary>
public sealed class SettingsModule : IModule
{
    public string Name => "settings";

    public void Register(IServiceCollection services, IConfiguration config)
    {
        services.AddModuleDbContext<SettingsDbContext>(config, SettingsDbContext.Schema);
        services.AddFieldEncryption(config); // secret key S3, mật khẩu SMTP, service account FCM
        services.AddEncryptedColumns<SettingsDbContext, Domain.SystemSetting>(nameof(Domain.SystemSetting.SecretsEncrypted));
        services.AddScoped<ISystemSettingsStore, SettingsStore>();
        services.AddHostedService<SettingsMigrator>();
    }

    public void MapEndpoints(IEndpointRouteBuilder api) =>
        SettingsEndpoints.Map(api.MapGroup("/system/settings").WithTags("System").RequireAuthorization(AuthPolicies.Admin));
}
