using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.Modules.Attendance.Features.Check;
using OfficeHub.Modules.Attendance.Infrastructure;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Attendance.Features.Timesheets;

/// <summary>Bảng công: của tôi, của một nhân viên (HR / quản lý), bảng hôm nay và tổng hợp tháng (HR / quản lý).</summary>
internal static class TimesheetEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/my", MyMonthAsync);
        g.MapGet("/employees/{employeeId:guid}", EmployeeMonthAsync).RequireAuthorization(AuthPolicies.Manager);
        g.MapGet("/board", BoardAsync).RequireAuthorization(AuthPolicies.Manager);
        g.MapGet("/report", ReportAsync).RequireAuthorization(AuthPolicies.Manager);
    }

    private static async Task<Results<Ok<MonthDto>, ProblemHttpResult>> MyMonthAsync(string? month, ClaimsPrincipal user,
        IEmployeeDirectory dir, AttendanceService svc, CancellationToken ct)
    {
        if (await CheckEndpoints.CurrentEmployeeAsync(user, dir, ct) is not { } emp) return CheckEndpoints.NoProfile();
        if (ParseMonth(month, svc) is not { } m) return BadMonth();
        return TypedResults.Ok(await MonthAsync(emp, m, svc, ct));
    }

    private static async Task<Results<Ok<MonthDto>, NotFound, ProblemHttpResult>> EmployeeMonthAsync(Guid employeeId, string? month,
        ClaimsPrincipal user, IEmployeeDirectory dir, AttendanceService svc, CancellationToken ct)
    {
        if (await dir.GetAsync(employeeId, ct) is not { } emp) return TypedResults.NotFound();
        if (!await CanViewAsync(user, emp.Id, dir, ct)) return Forbidden();
        if (ParseMonth(month, svc) is not { } m) return BadMonth();
        return TypedResults.Ok(await MonthAsync(emp, m, svc, ct));
    }

    /// <summary>Tình trạng chấm công của mọi người trong một ngày (mặc định hôm nay).</summary>
    private static async Task<Ok<List<BoardRow>>> BoardAsync(DateOnly? date, ClaimsPrincipal user, IEmployeeDirectory dir,
        AttendanceService svc, CancellationToken ct)
    {
        var d = date ?? svc.Today;
        var emps = await VisibleEmployeesAsync(user, dir, ct);
        var computed = await svc.ComputeAsync(emps, d, d, ct);
        return TypedResults.Ok(emps.Select(e => new BoardRow(DtoMap.Brief(e), DtoMap.Day(computed[e.Id][0]))).ToList());
    }

    /// <summary>Tổng hợp tháng cho từng nhân viên (đến hôm nay nếu là tháng hiện tại).</summary>
    private static async Task<Results<Ok<List<ReportRow>>, ProblemHttpResult>> ReportAsync(string? month, ClaimsPrincipal user,
        IEmployeeDirectory dir, AttendanceService svc, CancellationToken ct)
    {
        if (ParseMonth(month, svc) is not { } m) return BadMonth();
        var (from, to) = Range(m, svc);
        var emps = await VisibleEmployeesAsync(user, dir, ct);
        var computed = await svc.ComputeAsync(emps, from, to, ct);
        return TypedResults.Ok(emps.Select(e => new ReportRow(DtoMap.Brief(e), DtoMap.Summary(computed[e.Id]))).ToList());
    }

    private static async Task<MonthDto> MonthAsync(EmployeeRef emp, DateOnly month, AttendanceService svc, CancellationToken ct)
    {
        var (from, to) = (month, month.AddMonths(1).AddDays(-1));
        var days = (await svc.ComputeAsync([emp], from, to, ct))[emp.Id];
        var upToToday = days.Where(d => d.Result.Date <= svc.Today);
        return new MonthDto(DtoMap.Brief(emp), month.ToString("yyyy-MM"), [.. days.Select(DtoMap.Day)], DtoMap.Summary(upToToday));
    }

    /// <summary>HR thấy tất cả; quản lý thấy cấp dưới (trực tiếp + gián tiếp) và chính mình.</summary>
    private static async Task<List<EmployeeRef>> VisibleEmployeesAsync(ClaimsPrincipal user, IEmployeeDirectory dir, CancellationToken ct)
    {
        var all = await dir.ListActiveAsync(ct);
        if (user.IsHr()) return [.. all];
        if (await CheckEndpoints.CurrentEmployeeAsync(user, dir, ct) is not { } me) return [];
        var subs = await dir.GetSubordinateIdsAsync(me.Id, ct);
        return [.. all.Where(e => e.Id == me.Id || subs.Contains(e.Id))];
    }

    private static async Task<bool> CanViewAsync(ClaimsPrincipal user, Guid employeeId, IEmployeeDirectory dir, CancellationToken ct)
    {
        if (user.IsHr()) return true;
        if (await CheckEndpoints.CurrentEmployeeAsync(user, dir, ct) is not { } me) return false;
        return me.Id == employeeId || (await dir.GetSubordinateIdsAsync(me.Id, ct)).Contains(employeeId);
    }

    private static DateOnly? ParseMonth(string? month, AttendanceService svc)
    {
        if (string.IsNullOrWhiteSpace(month)) return new DateOnly(svc.Today.Year, svc.Today.Month, 1);
        return DateOnly.TryParseExact(month + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;
    }

    private static (DateOnly From, DateOnly To) Range(DateOnly month, AttendanceService svc)
    {
        var end = month.AddMonths(1).AddDays(-1);
        return (month, end < svc.Today ? end : svc.Today < month ? month : svc.Today);
    }

    private static ProblemHttpResult BadMonth() => TypedResults.Problem("Tháng không hợp lệ (định dạng yyyy-MM)", statusCode: 400);
    private static ProblemHttpResult Forbidden() => TypedResults.Problem("Bạn không có quyền xem bảng công của nhân viên này", statusCode: 403);
}
