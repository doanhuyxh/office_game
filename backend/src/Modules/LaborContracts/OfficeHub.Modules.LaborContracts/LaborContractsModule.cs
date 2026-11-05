using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OfficeHub.BuildingBlocks.Modules;
using OfficeHub.BuildingBlocks.Persistence;
using OfficeHub.BuildingBlocks.Security;
using OfficeHub.Modules.LaborContracts.Features;
using OfficeHub.Modules.LaborContracts.Infrastructure;

namespace OfficeHub.Modules.LaborContracts;

/// <summary>Hợp đồng lao động: hợp đồng + phụ lục theo nhân viên, lương mã hoá, file scan trên S3, nhắc HR / quản lý khi sắp hết hạn.</summary>
public sealed class LaborContractsModule : IModule
{
    public string Name => "contracts";

    public void Register(IServiceCollection services, IConfiguration config)
    {
        services.AddModuleDbContext<ContractsDbContext>(config, ContractsDbContext.Schema);
        services.AddFieldEncryption(config);
        services.AddHostedService<ContractsMigrator>();
        services.AddHostedService<ContractReminderJob>();
    }

    public void MapEndpoints(IEndpointRouteBuilder api) =>
        ContractEndpoints.Map(api.MapGroup("/contracts").WithTags("LaborContracts").RequireAuthorization());
}
