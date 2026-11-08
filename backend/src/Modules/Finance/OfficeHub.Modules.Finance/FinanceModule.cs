using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OfficeHub.BuildingBlocks.Modules;
using OfficeHub.BuildingBlocks.Persistence;
using OfficeHub.Modules.Approval.Contracts;
using OfficeHub.Modules.Finance.Features;
using OfficeHub.Modules.Finance.Infrastructure;

namespace OfficeHub.Modules.Finance;

/// <summary>
/// Sổ thu chi nội bộ: quỹ tiền mặt / ngân hàng, giao dịch, đề nghị chi qua luồng duyệt, khoá sổ. Quyền theo chức vụ (<c>IFinanceAccess</c>).
/// Là sổ QUẢN TRỊ — không phát hành hoá đơn điện tử, không thay sổ sách kế toán theo luật.
/// </summary>
public sealed class FinanceModule : IModule
{
    public string Name => "finance";

    public void Register(IServiceCollection services, IConfiguration config)
    {
        services.AddModuleDbContext<FinanceDbContext>(config, FinanceDbContext.Schema);
        services.AddSingleton<FinanceClock>();
        services.AddScoped<IApprovalHandler, ExpenseApprovalHandler>();
        services.AddScoped<OfficeHub.Modules.Finance.Contracts.IFinanceLedger, FinanceLedger>();
        services.AddHostedService<FinanceMigrator>();
    }

    public void MapEndpoints(IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/finance").WithTags("Finance").RequireAuthorization();
        SetupEndpoints.Map(g);
        LedgerEndpoints.Map(g);
        ExpenseEndpoints.Map(g);
        AttachmentEndpoints.Map(g);
    }
}
