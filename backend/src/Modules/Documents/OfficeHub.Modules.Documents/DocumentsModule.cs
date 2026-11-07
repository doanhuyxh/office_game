using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OfficeHub.BuildingBlocks.Modules;
using OfficeHub.BuildingBlocks.Persistence;
using OfficeHub.Modules.Approval.Contracts;
using OfficeHub.Modules.Documents.Features;
using OfficeHub.Modules.Documents.Infrastructure;

namespace OfficeHub.Modules.Documents;

/// <summary>
/// Kho tài sản số: tài liệu / ảnh / video của công ty theo kho (công ty, phòng ban, dự án) + thư mục, file trên S3 (tải lên thẳng bằng
/// presigned PUT), phiên bản, nhật ký truy cập, ban hành qua luồng duyệt, hạn lưu trữ, thùng rác, bàn giao khi nghỉ việc.
/// </summary>
public sealed class DocumentsModule : IModule
{
    public string Name => "documents";

    public void Register(IServiceCollection services, IConfiguration config)
    {
        services.AddModuleDbContext<DocumentsDbContext>(config, DocumentsDbContext.Schema);
        services.AddScoped<DocumentAccess>();
        services.AddSingleton<DocClock>();
        services.AddScoped<IApprovalHandler, DocumentPublishHandler>();
        services.AddHostedService<DocumentsMigrator>();
        services.AddHostedService<DocumentsMaintenanceJob>();
    }

    public void MapEndpoints(IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/documents").WithTags("Documents").RequireAuthorization();
        SpaceEndpoints.Map(g);
        AssetEndpoints.Map(g);
        AdminEndpoints.Map(g);
    }
}
