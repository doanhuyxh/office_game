using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Projects.Domain;
using OfficeHub.Modules.Projects.Infrastructure;

namespace OfficeHub.Modules.Projects.Features;

/// <param name="IsDefault">Chưa ai chỉnh — đang dùng giá trị mặc định.</param>
public sealed record AgentSettingsDto(int MaxBotTasksPerDay, int MaxBotStreak, bool IsDefault, DateTimeOffset? UpdatedAt, string? UpdatedByName,
    int DefaultTasksPerDay, int DefaultStreak, int TasksPerDayMin, int TasksPerDayMax, int StreakMin, int StreakMax);
public sealed record UpdateAgentSettings(int MaxBotTasksPerDay, int MaxBotStreak);

/// <summary>
/// Giới hạn đội agent (TEST-36): số việc / ngày qua token AI và số lần bot liên tiếp trên một việc. Chỉ quản trị viên (trang Hệ thống → Cấu hình);
/// token AI không gọi được (ngoài danh sách AccessTokenAuth) — bot không tự nới giới hạn. Áp dụng ngay cho request kế tiếp.
/// </summary>
internal static class AgentSettingsEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        var s = g.MapGroup("/agent-settings").RequireAuthorization(AuthPolicies.Admin);
        s.MapGet("", GetAsync);
        s.MapPut("", UpdateAsync);
    }

    private static AgentSettingsDto Dto(AgentSettings? row)
    {
        var d = AgentLimits.Default;
        return new AgentSettingsDto(row?.MaxBotTasksPerDay ?? d.TasksPerDay, row?.MaxBotStreak ?? d.Streak, row is null, row?.UpdatedAt, row?.UpdatedByName,
            d.TasksPerDay, d.Streak, AgentTeamRules.TasksPerDayMin, AgentTeamRules.TasksPerDayMax, AgentTeamRules.StreakMin, AgentTeamRules.StreakMax);
    }

    private static async Task<Ok<AgentSettingsDto>> GetAsync(ProjectsDbContext db, CancellationToken ct) =>
        TypedResults.Ok(Dto(await db.AgentSettings.AsNoTracking().FirstOrDefaultAsync(x => x.Id == AgentSettings.SingletonId, ct)));

    private static async Task<Results<Ok<AgentSettingsDto>, ValidationProblem>> UpdateAsync(UpdateAgentSettings r, ClaimsPrincipal user, ProjectsDbContext db,
        ProjectClock clock, CancellationToken ct)
    {
        var errors = AgentTeamRules.LimitErrors(r.MaxBotTasksPerDay, r.MaxBotStreak);
        if (errors.Count > 0)
        {
            var val = new Validation();
            foreach (var (field, msg) in errors) val.Add(field, msg);
            return val.Problem();
        }
        var row = await db.AgentSettings.FirstOrDefaultAsync(x => x.Id == AgentSettings.SingletonId, ct);
        if (row is null) db.AgentSettings.Add(row = new AgentSettings());
        if (row.MaxBotTasksPerDay != r.MaxBotTasksPerDay || row.MaxBotStreak != r.MaxBotStreak || db.Entry(row).State == EntityState.Added)
        {
            row.MaxBotTasksPerDay = r.MaxBotTasksPerDay;
            row.MaxBotStreak = r.MaxBotStreak;
            row.UpdatedAt = clock.Now;
            row.UpdatedByName = user.FindFirstValue(ClaimNames.FullName) ?? user.Identity?.Name;
            await db.SaveChangesAsync(ct);
        }
        return TypedResults.Ok(Dto(row));
    }
}
