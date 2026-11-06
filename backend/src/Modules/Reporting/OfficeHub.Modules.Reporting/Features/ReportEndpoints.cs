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

    private static async Task<Results<Ok<OvertimePayReport>, ValidationProblem>> OvertimePayAsync(string? month, ReportService svc, CancellationToken ct) =>
        svc.ParseMonth(month) is { } m ? TypedResults.Ok(await svc.OvertimePayAsync(m, ct)) : BadMonth();

    private static async Task<Results<FileContentHttpResult, ValidationProblem>> OvertimePayExcelAsync(string? month, ReportService svc, CancellationToken ct)
    {
        if (svc.ParseMonth(month) is not { } m) return BadMonth();
        return TypedResults.File(ExcelExport.OvertimePay(await svc.OvertimePayAsync(m, ct)), ExcelExport.ContentType, $"tien-tang-ca-{m:yyyy-MM}.xlsx");
    }

    private static async Task<Ok<IReadOnlyList<LeavePayoutRow>>> LeavePayoutAsync(ReportService svc, CancellationToken ct) =>
        TypedResults.Ok(await svc.LeavePayoutAsync(ct));

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
