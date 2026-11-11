using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Audit.Domain;
using OfficeHub.Modules.Audit.Infrastructure;
using OfficeHub.Modules.Identity.Contracts;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Audit.Features;

public sealed record AiAlertDto(Guid Id, DateTimeOffset CreatedAt, Guid UserId, string? FullName, string? UserName, string? DepartmentName,
    bool IsBot, string Rule, string Title, string Body, int Count, int Total, DateTimeOffset WindowStart, DateTimeOffset WindowEnd);

/// <summary>
/// Cảnh báo AI bất thường (job <see cref="AiAlertMonitor"/>), trang Báo cáo → Trợ lý AI. Cùng phạm vi với báo cáo sử dụng
/// (<see cref="AiUsageScope"/>): HR / admin mọi người, quản lý bản thân + cấp dưới. Token AI 403.
/// </summary>
internal static class AiAlertEndpoints
{
    public static void Map(RouteGroupBuilder g) => g.MapGet("/ai-alerts", ListAsync).RequireAuthorization(AuthPolicies.Manager);

    private static async Task<Results<Ok<PagedResult<AiAlertDto>>, ProblemHttpResult>> ListAsync(int? page, int? pageSize, Guid? userId,
        ClaimsPrincipal user, AuditDbContext db, IAccountService accounts, IEmployeeDirectory dir, IOptions<OfficeSettings> office,
        TimeProvider clock, CancellationToken ct)
    {
        if (user.IsAccessToken()) return TypedResults.Problem("Chỉ xem khi đăng nhập trên web", statusCode: StatusCodes.Status403Forbidden);
        var today = AiUsageEndpoints.Today(office, clock);
        var scope = await AiUsageScope.ResolveAsync(user, dir, today.AddDays(-(AuditRules.AiRetentionDays - 1)), today, null, ct);
        if (scope is null) return TypedResults.Problem("Không có quyền xem", statusCode: StatusCodes.Status403Forbidden);
        if (userId is { } one && !scope.Contains(one)) return TypedResults.Problem("Không có quyền xem người này", statusCode: StatusCodes.Status403Forbidden);

        var q = db.AiAlerts.AsNoTracking();
        if (scope.UserIds is { } ids) q = q.Where(a => ids.Contains(a.UserId));
        if (userId is { } uid) q = q.Where(a => a.UserId == uid);
        var paged = await q.OrderByDescending(a => a.CreatedAt).ThenByDescending(a => a.Id).ToPagedAsync(page ?? 1, pageSize, ct);

        var people = await accounts.GetManyAsync(paged.Items.Select(a => a.UserId).Distinct().ToList(), ct);
        var dtos = paged.Items.Select(a =>
        {
            people.TryGetValue(a.UserId, out var acc);
            scope.Employees.TryGetValue(a.UserId, out var emp);
            var name = acc is null ? "(tài khoản đã xoá)" : string.IsNullOrWhiteSpace(acc.FullName) ? acc.UserName : acc.FullName;
            return new AiAlertDto(a.Id, a.CreatedAt, a.UserId, acc?.FullName, acc?.UserName, emp?.DepartmentName, acc?.IsBot == true, a.Rule,
                AiAlertRules.Title(a.Rule, name), AiAlertRules.Body(a.Rule, a.Count, a.Total), a.Count, a.Total, a.WindowStart, a.WindowEnd);
        }).ToList();
        return TypedResults.Ok(paged.With(dtos));
    }
}
