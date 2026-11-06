using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OfficeHub.BuildingBlocks.Modules;
using OfficeHub.BuildingBlocks.Persistence;
using OfficeHub.BuildingBlocks.Security;
using OfficeHub.Modules.Payroll.Features;
using OfficeHub.Modules.Payroll.Infrastructure;

namespace OfficeHub.Modules.Payroll;

/// <summary>Bảng lương theo luật VN: thông số (HR sửa), hồ sơ thuế, kỳ lương (tính / chốt), phiếu lương mã hoá, Excel.</summary>
public sealed class PayrollModule : IModule
{
    public string Name => "payroll";

    public void Register(IServiceCollection services, IConfiguration config)
    {
        services.AddModuleDbContext<PayrollDbContext>(config, PayrollDbContext.Schema);
        services.AddFieldEncryption(config);
        services.AddScoped<PayrollService>();
        services.AddHostedService<PayrollMigrator>();
    }

    public void MapEndpoints(IEndpointRouteBuilder api) =>
        PayrollEndpoints.Map(api.MapGroup("/payroll").WithTags("Payroll").RequireAuthorization());
}
