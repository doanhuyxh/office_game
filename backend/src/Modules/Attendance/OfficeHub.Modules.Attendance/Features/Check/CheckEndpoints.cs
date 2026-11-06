using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Office;
using OfficeHub.Modules.Attendance.Domain;
using OfficeHub.Modules.Attendance.Infrastructure;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Attendance.Features.Check;

/// <summary>source = "web" | "office3d". Gọi bằng token AI (MCP) thì server bỏ qua source: luôn Mcp + Remote.</summary>
public sealed record CheckRequest(string? Source);

/// <summary>Nút chấm công (web + văn phòng 3D). Một nút đổi trạng thái vào ↔ ra; giờ và IP do server ghi.</summary>
internal static class CheckEndpoints
{
    private static readonly TimeSpan Debounce = TimeSpan.FromMinutes(1);

    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/today", TodayAsync);
        g.MapPost("/check", CheckAsync);
    }

    private static async Task<Results<Ok<TodayDto>, ProblemHttpResult>> TodayAsync(
        HttpContext http, ClaimsPrincipal user, IEmployeeDirectory dir, AttendanceService svc, AttendanceDbContext db,
        OfficeNetwork net, CancellationToken ct)
    {
        if (await CurrentEmployeeAsync(user, dir, ct) is not { } emp) return NoProfile();
        return TypedResults.Ok(await BuildTodayAsync(emp, http, svc, db, net, ct));
    }

    private static async Task<Results<Ok<TodayDto>, ProblemHttpResult>> CheckAsync(
        CheckRequest req, HttpContext http, ClaimsPrincipal user, IEmployeeDirectory dir, AttendanceService svc,
        AttendanceDbContext db, OfficeNetwork net, CancellationToken ct)
    {
        if (await CurrentEmployeeAsync(user, dir, ct) is not { } emp) return NoProfile();
        if (!emp.IsActive) return TypedResults.Problem("Nhân viên đã nghỉ việc", statusCode: StatusCodes.Status403Forbidden);

        var now = svc.Now;
        var today = svc.Today;
        var last = await db.Events.Where(e => e.EmployeeId == emp.Id && e.WorkDate == today)
            .OrderByDescending(e => e.OccurredAt).FirstOrDefaultAsync(ct);
        if (last is not null && now - last.OccurredAt < Debounce)
            return TypedResults.Problem(
                $"Bạn vừa chấm công lúc {TimeZoneInfo.ConvertTime(last.OccurredAt, svc.Tz):HH:mm}. Đợi 1 phút rồi thử lại.",
                statusCode: StatusCodes.Status409Conflict);

        var viaAi = user.IsAccessToken();
        db.Events.Add(new AttendanceEvent
        {
            EmployeeId = emp.Id,
            OccurredAt = now,
            WorkDate = today,
            Type = last?.Type == PunchType.In ? PunchType.Out : PunchType.In,
            Source = viaAi ? PunchSource.Mcp : req.Source?.ToLowerInvariant() == "office3d" ? PunchSource.Office3D : PunchSource.Web,
            // Qua MCP, IP là của máy chủ MCP chứ không phải của nhân viên → không thể biết có ở văn phòng hay không.
            WorkMode = !viaAi && net.IsOnsite(http.Connection.RemoteIpAddress) ? WorkMode.Onsite : WorkMode.Remote,
            Ip = http.Connection.RemoteIpAddress?.ToString(),
            UserAgent = http.Request.Headers.UserAgent.ToString() is { Length: > 0 } ua ? ua[..Math.Min(ua.Length, 512)] : null,
        });
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(await BuildTodayAsync(emp, http, svc, db, net, ct));
    }

    private static async Task<TodayDto> BuildTodayAsync(EmployeeRef emp, HttpContext http, AttendanceService svc, AttendanceDbContext db,
        OfficeNetwork net, CancellationToken ct)
    {
        var today = svc.Today;
        var day = (await svc.ComputeAsync([emp], today, today, ct))[emp.Id][0];
        var last = await db.Events.AsNoTracking().Where(e => e.EmployeeId == emp.Id && e.WorkDate == today)
            .OrderByDescending(e => e.OccurredAt).FirstOrDefaultAsync(ct);
        var checkedIn = last?.Type == PunchType.In;
        return new TodayDto(DtoMap.Brief(emp), checkedIn, checkedIn ? "out" : "in", DtoMap.Day(day),
            day.Shift is null ? null : DtoMap.Shift(day.Shift), svc.Now,
            !http.User.IsAccessToken() && net.IsOnsite(http.Connection.RemoteIpAddress) ? "Onsite" : "Remote");
    }

    internal static async Task<EmployeeRef?> CurrentEmployeeAsync(ClaimsPrincipal user, IEmployeeDirectory dir, CancellationToken ct) =>
        user.GetUserId() is { } uid ? await dir.GetByUserIdAsync(uid, ct) : null;

    internal static ProblemHttpResult NoProfile() => TypedResults.Problem(
        "Tài khoản chưa gắn hồ sơ nhân viên nên chưa chấm công được. Liên hệ HR.", statusCode: StatusCodes.Status409Conflict,
        title: "no_employee_profile");
}
