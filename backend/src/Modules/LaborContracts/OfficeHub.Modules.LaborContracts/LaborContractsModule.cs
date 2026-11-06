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

using OfficeHub.Modules.LaborContracts.Contracts;

namespace OfficeHub.Modules.LaborContracts;

/// <summary>Hợp đồng lao động: hợp đồng + phụ lục theo nhân viên, lương mã hoá, file scan trên S3, nhắc HR / quản lý khi sắp hết hạn.</summary>
public sealed class LaborContractsModule : IModule
{
    public string Name => "contracts";

    public void Register(IServiceCollection services, IConfiguration config)
    {
        services.AddModuleDbContext<ContractsDbContext>(config, ContractsDbContext.Schema);
        services.AddFieldEncryption(config);
        services.AddScoped<ISalaryLookup, SalaryLookup>();
        services.AddHostedService<ContractsMigrator>();
        services.AddHostedService<ContractReminderJob>();
    }

    public void MapEndpoints(IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/contracts").WithTags("LaborContracts").RequireAuthorization();
        TemplateEndpoints.Map(g); // trước ContractEndpoints: /templates không bị hiểu nhầm là /{id}
        ContractEndpoints.Map(g);
    }
}
