using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OfficeHub.BuildingBlocks.Modules;
using OfficeHub.BuildingBlocks.Persistence;
using OfficeHub.Modules.Sales.Features;
using OfficeHub.Modules.Sales.Infrastructure;

namespace OfficeHub.Modules.Sales;

/// <summary>
/// Kinh doanh (CRM): khách hàng, người liên hệ, chăm sóc, cơ hội bán, hợp đồng bán, lịch thu + công nợ. Tiền thu ghi vào sổ module Finance.
/// Người thấy = người phụ trách + quản lý của họ + người có quyền Xem tài chính theo chức vụ. Không mở cho token AI.
/// </summary>
public sealed class SalesModule : IModule
{
    public string Name => "sales";

    public void Register(IServiceCollection services, IConfiguration config)
    {
        services.AddModuleDbContext<SalesDbContext>(config, SalesDbContext.Schema);
        services.AddSingleton<SalesClock>();
        services.AddScoped<SalesAccess>();
        services.AddScoped<CollectedCalculator>();
        services.AddScoped<OfficeHub.Modules.Sales.Contracts.ISalesContractsLookup, SalesContractsLookup>();
        services.AddScoped<OfficeHub.Modules.Sales.Contracts.ISalesRevenueLookup, SalesRevenueLookup>();
        services.AddHostedService<SalesMigrator>();
        services.AddHostedService<SalesReminderJob>();
    }

    public void MapEndpoints(IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/sales").WithTags("Sales").RequireAuthorization();
        CustomerEndpoints.Map(g);
        OpportunityEndpoints.Map(g);
        ContractEndpoints.Map(g);
        AppendixEndpoints.Map(g);
    }
}
