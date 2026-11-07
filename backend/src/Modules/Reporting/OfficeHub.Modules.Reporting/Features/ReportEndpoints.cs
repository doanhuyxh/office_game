using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Organization.Contracts;
using OfficeHub.Modules.Reporting.Infrastructure;

namespace OfficeHub.Modules.Reporting.Features;

/// <summary>Trang tiền tăng ca: chỉ người có tăng ca; tổng tháng tính trên toàn bộ.</summary>
public sealed record OvertimePayPage(IReadOnlyList<OvertimePayRow> Items, int Total, int Page, int PageSize, string Month, int TotalMinutes, decimal TotalAmount)
    : PagedResult<OvertimePayRow>(Items, Total, Page, PageSize);
/// <summary>Trang phép năm → tiền; <c>Due</c> = người đã nghỉ việc trong năm còn phép phải trả (toàn bộ, không theo trang).</summary>
public sealed record LeavePayoutPage(IReadOnlyList<LeavePayoutRow> Items, int Total, int Page, int PageSize, IReadOnlyList<LeavePayoutRow> Due)
    : PagedResult<LeavePayoutRow>(Items, Total, Page, PageSize);

/// <summary>
/// Báo cáo + xuất Excel. Tiền (lương, tăng ca, phép) chỉ HR; bảng công Excel: HR (tất cả) / quản lý (bản thân + cấp dưới);
/// tiền phép ước tính của chính mình: ai cũng xem. Không có trong danh sách route của token AI (AccessTokenAuth).
/// </summary>
internal static class ReportEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/timesheet.xlsx", TimesheetExcelAsync).RequireAuthorization(AuthPolicies.Manager);
        g.MapGet("/overtime-pay", OvertimePayAsync).RequireAuthorization(AuthPolicies.Hr);
        g.MapGet("/overtime-pay.xlsx", OvertimePayExcelAsync).RequireAuthorization(AuthPolicies.Hr);
        g.MapGet("/leave-payout", LeavePayoutAsync).RequireAuthorization(AuthPolicies.Hr);
        g.MapGet("/leave-payout.xlsx", LeavePayoutExcelAsync).RequireAuthorization(AuthPolicies.Hr);
        g.MapGet("/leave-payout/me", MyLeavePayoutAsync);
    }

    private static ValidationProblem BadMonth() => new Validation().Add("month", "Tháng phải có dạng yyyy-MM").Problem();

    private static async Task<Results<FileContentHttpResult, ValidationProblem>> TimesheetExcelAsync(string? month, ClaimsPrincipal user,
        ReportService svc, CancellationToken ct)
    {
        if (svc.ParseMonth(month) is not { } m) return BadMonth();
        var employees = await svc.VisibleAsync(user, m, m.AddMonths(1).AddDays(-1), ct);
        var data = await svc.TimesheetAsync(employees, m, ct);
        return TypedResults.File(ExcelExport.Timesheet(m, employees, data, svc.Tz), ExcelExport.ContentType, $"bang-cong-{m:yyyy-MM}.xlsx");
    }

    private static async Task<Results<Ok<OvertimePayReport>, Ok<OvertimePayPage>, ValidationProblem>> OvertimePayAsync(string? month, int? page, int? pageSize,
        ReportService svc, CancellationToken ct)
    {
        if (svc.ParseMonth(month) is not { } m) return BadMonth();
        var report = await svc.OvertimePayAsync(m, ct);
        if (page is not { } pg) return TypedResults.Ok(report);
        var paged = Paging.Of(report.Rows.Where(r => r.TotalMinutes > 0).ToList(), pg, pageSize);
        return TypedResults.Ok(new OvertimePayPage(paged.Items, paged.Total, paged.Page, paged.PageSize, report.Month, report.TotalMinutes, report.TotalAmount));
    }

    private static async Task<Results<FileContentHttpResult, ValidationProblem>> OvertimePayExcelAsync(string? month, ReportService svc, CancellationToken ct)
    {
        if (svc.ParseMonth(month) is not { } m) return BadMonth();
        return TypedResults.File(ExcelExport.OvertimePay(await svc.OvertimePayAsync(m, ct)), ExcelExport.ContentType, $"tien-tang-ca-{m:yyyy-MM}.xlsx");
    }

    /// <summary>Có <c>page</c> → cắt trang danh sách nhân viên (theo mã) rồi chỉ tính cho trang; <c>Due</c> tính riêng cho người đã nghỉ.</summary>
    private static async Task<Results<Ok<IReadOnlyList<LeavePayoutRow>>, Ok<LeavePayoutPage>>> LeavePayoutAsync(int? page, int? pageSize, ReportService svc,
        CancellationToken ct)
    {
        if (page is not { } pg) return TypedResults.Ok(await svc.LeavePayoutAsync(ct));
        var employees = await svc.LeavePayoutEmployeesAsync(ct);
        var paged = Paging.Of(employees, pg, pageSize);
        var rows = await svc.LeavePayoutForAsync(paged.Items, ct);
        var due = await svc.LeavePayoutForAsync([.. employees.Where(e => !e.IsActive)], ct);
        return TypedResults.Ok(new LeavePayoutPage(rows, paged.Total, paged.Page, paged.PageSize, [.. due.Where(r => r.PayoutDue)]));
    }

    private static async Task<FileContentHttpResult> LeavePayoutExcelAsync(ReportService svc, CancellationToken ct) =>
        TypedResults.File(ExcelExport.Leave(await svc.LeavePayoutAsync(ct), svc.Today), ExcelExport.ContentType, $"phep-nam-{svc.Today:yyyy-MM-dd}.xlsx");

    /// <summary>Tiền phép ước tính của chính tôi (nếu nghỉ việc hôm nay). Không có hồ sơ nhân viên → 404.</summary>
    private static async Task<Results<Ok<LeavePayoutRow>, NotFound, ProblemHttpResult>> MyLeavePayoutAsync(ClaimsPrincipal user,
        IEmployeeDirectory dir, ReportService svc, CancellationToken ct)
    {
        if (user.IsAccessToken()) return TypedResults.Problem("Chỉ xem khi đăng nhập trên web", statusCode: StatusCodes.Status403Forbidden);
        if (user.GetUserId() is not { } uid || await dir.GetByUserIdAsync(uid, ct) is not { } me) return TypedResults.NotFound();
        var rows = await svc.LeavePayoutForAsync([me], ct);
        return rows.Count == 0 ? TypedResults.NotFound() : TypedResults.Ok(rows[0]);
    }
}
