using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OfficeHub.BuildingBlocks.Modules;
using OfficeHub.BuildingBlocks.Persistence;
using OfficeHub.Modules.Projects.Contracts;
using OfficeHub.Modules.Projects.Features;
using OfficeHub.Modules.Projects.Infrastructure;

namespace OfficeHub.Modules.Projects;

/// <summary>
/// Dự án: thành viên + phân bổ %, mốc nghiệm thu (gắn đợt thu hợp đồng bán), công việc kanban, ngày công theo chấm công.
/// Sở hữu dự án từ 2026-11-08 (trước đó ở module Documents — kho tài liệu dự án đọc qua <see cref="IProjectDirectory"/>). Đăng ký SAU DocumentsModule.
/// </summary>
public sealed class ProjectsModule : IModule
{
    public string Name => "projects";

    public void Register(IServiceCollection services, IConfiguration config)
    {
        services.AddModuleDbContext<ProjectsDbContext>(config, ProjectsDbContext.Schema);
        services.AddSingleton<ProjectClock>();
        services.AddScoped<ProjectAccess>();
        services.AddScoped<EffortCalculator>();
        services.AddScoped<ProjectFinance>();
        services.AddScoped<BotStreakGuard>(); // chặn chuỗi bot + chuông quản lý dự án (TEST-182)
        services.AddScoped<IProjectDirectory, ProjectDirectory>();
        services.AddScoped<ICommentFileLookup, CommentFileLookup>(); // Chat chuyển tiếp tệp bình luận việc (TEST-156)
        UploadLinkEndpoints.AddRateLimit(services); // link tải lên từ thiết bị khác — endpoint công khai theo IP (TEST-175)
        services.AddHostedService<ProjectsMigrator>();
        services.AddHostedService<TaskReminderJob>();
        services.AddHostedService<AllocationFreezeJob>();
    }

    public void MapEndpoints(IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/projects").WithTags("Projects").RequireAuthorization();
        TaskEndpoints.Map(g);       // trước ProjectEndpoints: "/tasks/mine" không bị "/{id:guid}" nuốt (guid constraint đã chặn, giữ thứ tự cho rõ)
        CommentFileEndpoints.Map(g); // tệp đính kèm bình luận việc (TEST-153)
        UploadLinkEndpoints.Map(g);  // link tải tệp từ thiết bị khác (TEST-175)
        BulkTaskEndpoints.Map(g);     // thao tác hàng loạt trên việc (web)
        TaskFollowerEndpoints.Map(g); // người theo dõi việc (TEST-160)
        TaskColumnEndpoints.Map(g);
        ActivityFeedEndpoints.Map(g); // /activity — bảng việc tự cập nhật + toast
        AgentSettingsEndpoints.Map(g); // /agent-settings — giới hạn bot, chỉ admin
        MilestoneEndpoints.Map(g);
        ChangeRequestEndpoints.Map(g);
        WikiEndpoints.Map(g); // /{id}/wiki — sổ tay dự án (TEST-215)
        ProjectAppendixEndpoints.Map(g); // /{id}/appendix — tab Phụ lục (TEST-40)
        ProjectEndpoints.Map(g);
        // Trang công khai /u/{token} (TEST-175): không đăng nhập, chỉ token link; giới hạn theo IP
        UploadLinkEndpoints.MapPublic(api.MapGroup("/projects/public/upload-links").WithTags("Projects").AllowAnonymous()
            .RequireRateLimiting(UploadLinkEndpoints.RateLimitPolicy));
        // Realtime hỏi việc bot đang chờ người (TEST-119) — khoá nội bộ, không cookie; nginx chặn từ ngoài
        BotWaitingEndpoints.Map(api.MapGroup("/projects/internal").WithTags("Projects").AllowAnonymous()
            .WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(16 * 1024)));
    }
}
