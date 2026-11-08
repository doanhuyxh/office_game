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
        services.AddScoped<IProjectDirectory, ProjectDirectory>();
        services.AddHostedService<ProjectsMigrator>();
        services.AddHostedService<TaskReminderJob>();
        services.AddHostedService<AllocationFreezeJob>();
    }

    public void MapEndpoints(IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/projects").WithTags("Projects").RequireAuthorization();
        TaskEndpoints.Map(g);       // trước ProjectEndpoints: "/tasks/mine" không bị "/{id:guid}" nuốt (guid constraint đã chặn, giữ thứ tự cho rõ)
        MilestoneEndpoints.Map(g);
        ChangeRequestEndpoints.Map(g);
        ProjectEndpoints.Map(g);
    }
}
