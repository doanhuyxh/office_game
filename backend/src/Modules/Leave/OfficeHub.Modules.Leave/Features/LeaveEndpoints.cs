using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Approval.Contracts;
using OfficeHub.Modules.Attendance.Contracts;
using OfficeHub.Modules.Leave.Domain;
using OfficeHub.Modules.Leave.Infrastructure;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Leave.Features;

public sealed record LeaveTypeDto(Guid Id, string Code, string Name, bool IsPaid, bool UsesAnnualBalance);
public sealed record EmployeeBrief(Guid Id, string Code, string FullName, string? DepartmentName);
public sealed record LeaveRequestDto(Guid Id, EmployeeBrief Employee, Guid LeaveTypeId, string LeaveTypeName, DateOnly StartDate, DateOnly EndDate,
    string Period, decimal Days, string? Reason, string Status, string? RejectReason, Guid? ApprovalRequestId, DateTimeOffset CreatedAt);
public sealed record CreateLeaveRequest(Guid LeaveTypeId, DateOnly StartDate, DateOnly EndDate, string? Period, string? Reason);
public sealed record PreviewDto(decimal Days, IReadOnlyList<DateOnly> WorkingDays);
public sealed record EmployeeBalanceDto(EmployeeBrief Employee, BalanceDto Balance);
public sealed record CreateAdjustmentRequest(Guid EmployeeId, decimal Days, string Reason);
public sealed record AdjustmentDto(Guid Id, Guid EmployeeId, decimal Days, string Reason, DateTimeOffset CreatedAt, string? CreatedByName);

internal static class LeaveEndpoints
{
    private const int MaxRangeDays = 60;

    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/types", TypesAsync);
        g.MapGet("/balance", MyBalanceAsync);
        g.MapGet("/balances", AllBalancesAsync).RequireAuthorization(AuthPolicies.Hr);
        g.MapGet("/preview", PreviewAsync);
        g.MapPost("/requests", CreateAsync);
        g.MapGet("/requests/my", MyRequestsAsync);
        g.MapGet("/requests", TeamRequestsAsync).RequireAuthorization(AuthPolicies.Manager);
        g.MapGet("/adjustments", AdjustmentsAsync).RequireAuthorization(AuthPolicies.Hr);
        g.MapPost("/adjustments", CreateAdjustmentAsync).RequireAuthorization(AuthPolicies.Hr);
    }

    private static ProblemHttpResult NoProfile() => TypedResults.Problem(
        "Tài khoản chưa gắn hồ sơ nhân viên nên chưa xin nghỉ được. Liên hệ HR.", statusCode: StatusCodes.Status409Conflict, title: "no_employee_profile");

    private static async Task<EmployeeRef?> MeAsync(ClaimsPrincipal user, IEmployeeDirectory dir, CancellationToken ct) =>
        user.GetUserId() is { } uid ? await dir.GetByUserIdAsync(uid, ct) : null;

    private static EmployeeBrief Brief(EmployeeRef e) => new(e.Id, e.Code, e.FullName, e.DepartmentName);

    private static async Task<Ok<List<LeaveTypeDto>>> TypesAsync(LeaveDbContext db, CancellationToken ct) =>
        TypedResults.Ok(await db.Types.AsNoTracking().Where(t => t.IsActive).OrderBy(t => t.SortOrder)
            .Select(t => new LeaveTypeDto(t.Id, t.Code, t.Name, t.IsPaid, t.UsesAnnualBalance)).ToListAsync(ct));

    private static async Task<Results<Ok<BalanceDto>, ProblemHttpResult>> MyBalanceAsync(ClaimsPrincipal user, IEmployeeDirectory dir,
        LeaveBalanceService balances, CancellationToken ct)
    {
        if (await MeAsync(user, dir, ct) is not { } me) return NoProfile();
        return TypedResults.Ok((await balances.ComputeAsync([me], ct))[me.Id]);
    }

    private static async Task<Ok<List<EmployeeBalanceDto>>> AllBalancesAsync(IEmployeeDirectory dir, LeaveBalanceService balances, CancellationToken ct)
    {
        var emps = await dir.ListActiveAsync(ct);
        var b = await balances.ComputeAsync(emps, ct);
        return TypedResults.Ok(emps.Select(e => new EmployeeBalanceDto(Brief(e), b[e.Id])).ToList());
    }

    /// <summary>Đếm trước số ngày nghỉ (FE hiện khi chọn ngày).</summary>
    private static async Task<Results<Ok<PreviewDto>, ValidationProblem, ProblemHttpResult>> PreviewAsync(DateOnly startDate, DateOnly endDate,
        string? period, ClaimsPrincipal user, IEmployeeDirectory dir, IWorkCalendar calendar, CancellationToken ct)
    {
        if (await MeAsync(user, dir, ct) is not { } me) return NoProfile();
        var v = ValidateRange(startDate, endDate, period, out var p);
        if (v.Failed) return v.Problem();
        var days = await calendar.WorkingDaysAsync(me.Id, startDate, endDate, ct);
        return TypedResults.Ok(new PreviewDto(CountDays(days, p), days));
    }

    /// <summary>
    /// Gửi đơn nghỉ. Thứ tự (giữ nguyên khi sửa): validate → lưu đơn Pending → gửi vào luồng duyệt (quản lý → HR)
    /// → lưu ApprovalRequestId. Gửi duyệt lỗi thì xoá đơn vừa tạo (không để đơn treo không ai duyệt).
    /// </summary>
    private static async Task<Results<Ok<LeaveRequestDto>, ValidationProblem, ProblemHttpResult>> CreateAsync(CreateLeaveRequest req,
        ClaimsPrincipal user, IEmployeeDirectory dir, IWorkCalendar calendar, LeaveDbContext db, LeaveBalanceService balances,
        IApprovalService approvals, TimeProvider clock, CancellationToken ct)
    {
        if (await MeAsync(user, dir, ct) is not { } me) return NoProfile();
        if (!me.IsActive) return TypedResults.Problem("Nhân viên đã nghỉ việc", statusCode: StatusCodes.Status403Forbidden);
        var type = await db.Types.FirstOrDefaultAsync(t => t.Id == req.LeaveTypeId && t.IsActive, ct);
        var v = ValidateRange(req.StartDate, req.EndDate, req.Period, out var period)
            .When(type is null, "leaveTypeId", "Loại nghỉ không hợp lệ")
            .MaxLength(req.Reason, 500, "reason", "Lý do")
            .When(req.StartDate < me.JoinedAt, "startDate", "Không xin nghỉ được trước ngày vào làm");
        if (v.Failed) return v.Problem();

        var working = await calendar.WorkingDaysAsync(me.Id, req.StartDate, req.EndDate, ct);
        var days = CountDays(working, period);
        if (days == 0) return new Validation().Add("startDate", "Khoảng ngày đã chọn không có ngày làm việc nào (ngày nghỉ / ngày lễ)").Problem();

        var overlapping = await db.Requests.Where(r => r.EmployeeId == me.Id && (r.Status == LeaveStatus.Pending || r.Status == LeaveStatus.Approved)
                                                       && r.StartDate <= req.EndDate && r.EndDate >= req.StartDate).ToListAsync(ct);
        // Cho phép sáng + chiều cùng một ngày là 2 đơn nửa ngày khác buổi.
        var clash = overlapping.FirstOrDefault(r => !(period != LeavePeriod.FullDay && r.Period != LeavePeriod.FullDay && r.Period != period));
        if (clash is not null)
            return new Validation().Add("startDate", $"Đã có đơn nghỉ {clash.StartDate:dd/MM/yyyy}–{clash.EndDate:dd/MM/yyyy} trùng ngày").Problem();

        if (type!.UsesAnnualBalance)
        {
            var available = (await balances.ComputeAsync([me], ct))[me.Id].Available;
            if (days > available)
                return new Validation().Add("leaveTypeId", $"Không đủ phép năm: còn {available:0.##} ngày, đơn này cần {days:0.##} ngày").Problem();
        }

        var entity = new LeaveRequest
        {
            EmployeeId = me.Id, LeaveTypeId = type.Id, StartDate = req.StartDate, EndDate = req.EndDate, Period = period, Days = days,
            Reason = string.IsNullOrWhiteSpace(req.Reason) ? null : req.Reason.Trim(), Status = LeaveStatus.Pending, CreatedAt = clock.GetUtcNow(),
        };
        db.Requests.Add(entity);
        await db.SaveChangesAsync(ct);
        try
        {
            var range = req.StartDate == req.EndDate ? $"{req.StartDate:dd/MM/yyyy}{PeriodLabel(period)}" : $"{req.StartDate:dd/MM/yyyy} – {req.EndDate:dd/MM/yyyy}";
            entity.ApprovalRequestId = await approvals.SubmitAsync(new ApprovalSubmission(ApprovalTypes.Leave, entity.Id, me.Id,
                $"Xin nghỉ: {type.Name}", $"{range} · {days:0.##} ngày{(entity.Reason is null ? "" : $" · {entity.Reason}")}",
                [ApprovalStepKind.Manager, ApprovalStepKind.Hr]), ct);
            await db.SaveChangesAsync(ct);
        }
        catch
        {
            db.Requests.Remove(entity);
            await db.SaveChangesAsync(CancellationToken.None);
            throw;
        }
        return TypedResults.Ok(ToDto(entity, type.Name, me));
    }

    private static async Task<Results<Ok<List<LeaveRequestDto>>, ProblemHttpResult>> MyRequestsAsync(int? year, ClaimsPrincipal user, IEmployeeDirectory dir,
        LeaveDbContext db, CancellationToken ct)
    {
        if (await MeAsync(user, dir, ct) is not { } me) return NoProfile();
        var types = await db.Types.ToDictionaryAsync(t => t.Id, t => t.Name, ct);
        var q = db.Requests.AsNoTracking().Where(r => r.EmployeeId == me.Id);
        if (year is { } y) q = q.Where(r => r.StartDate.Year == y || r.EndDate.Year == y);
        var rows = await q.OrderByDescending(r => r.StartDate).Take(200).ToListAsync(ct);
        return TypedResults.Ok(rows.Select(r => ToDto(r, types.GetValueOrDefault(r.LeaveTypeId, "?"), me)).ToList());
    }

    /// <summary>Lịch nghỉ (đã duyệt + chờ duyệt) trong khoảng ngày: HR thấy cả công ty, quản lý thấy bản thân + cấp dưới.</summary>
    private static async Task<Ok<List<LeaveRequestDto>>> TeamRequestsAsync(DateOnly from, DateOnly to, ClaimsPrincipal user, IEmployeeDirectory dir,
        LeaveDbContext db, CancellationToken ct)
    {
        var all = (await dir.ListActiveAsync(ct)).ToDictionary(e => e.Id);
        HashSet<Guid> visible;
        if (user.IsHr()) visible = [.. all.Keys];
        else if (await MeAsync(user, dir, ct) is { } me) visible = [me.Id, .. await dir.GetSubordinateIdsAsync(me.Id, ct)];
        else visible = [];
        var types = await db.Types.ToDictionaryAsync(t => t.Id, t => t.Name, ct);
        var rows = await db.Requests.AsNoTracking()
            .Where(r => (r.Status == LeaveStatus.Approved || r.Status == LeaveStatus.Pending) && r.StartDate <= to && r.EndDate >= from)
            .OrderBy(r => r.StartDate).ToListAsync(ct);
        return TypedResults.Ok(rows.Where(r => visible.Contains(r.EmployeeId) && all.ContainsKey(r.EmployeeId))
            .Select(r => ToDto(r, types.GetValueOrDefault(r.LeaveTypeId, "?"), all[r.EmployeeId])).ToList());
    }

    private static async Task<Ok<List<AdjustmentDto>>> AdjustmentsAsync(Guid? employeeId, LeaveDbContext db, CancellationToken ct)
    {
        var q = db.Adjustments.AsNoTracking();
        if (employeeId is { } id) q = q.Where(a => a.EmployeeId == id);
        return TypedResults.Ok(await q.OrderByDescending(a => a.CreatedAt).Take(500)
            .Select(a => new AdjustmentDto(a.Id, a.EmployeeId, a.Days, a.Reason, a.CreatedAt, a.CreatedByName)).ToListAsync(ct));
    }

    /// <summary>HR cộng / trừ phép năm (vd nhập số dư ban đầu). Không sửa / xoá — sai thì thêm dòng điều chỉnh ngược lại.</summary>
    private static async Task<Results<Ok<AdjustmentDto>, ValidationProblem>> CreateAdjustmentAsync(CreateAdjustmentRequest req, ClaimsPrincipal user,
        IEmployeeDirectory dir, LeaveDbContext db, TimeProvider clock, CancellationToken ct)
    {
        var v = new Validation()
            .When(req.Days == 0 || Math.Abs(req.Days) > 365, "days", "Số ngày điều chỉnh khác 0 và không quá 365")
            .When(req.Days * 2 != Math.Round(req.Days * 2), "days", "Số ngày phải là bội số của 0.5")
            .Required(req.Reason, "reason", "Lý do").MaxLength(req.Reason, 500, "reason", "Lý do");
        if (await dir.GetAsync(req.EmployeeId, ct) is null) v.Add("employeeId", "Nhân viên không tồn tại");
        if (v.Failed) return v.Problem();
        var a = new LeaveAdjustment
        {
            EmployeeId = req.EmployeeId, Days = req.Days, Reason = req.Reason.Trim(), CreatedAt = clock.GetUtcNow(),
            CreatedByName = user.FindFirstValue(ClaimNames.FullName),
        };
        db.Adjustments.Add(a);
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(new AdjustmentDto(a.Id, a.EmployeeId, a.Days, a.Reason, a.CreatedAt, a.CreatedByName));
    }

    // ---------------- hỗ trợ ----------------

    private static Validation ValidateRange(DateOnly start, DateOnly end, string? periodRaw, out LeavePeriod period)
    {
        var v = new Validation();
        if (!Enum.TryParse(periodRaw ?? nameof(LeavePeriod.FullDay), true, out period)) v.Add("period", "Buổi nghỉ không hợp lệ");
        v.When(start == default || end == default, "startDate", "Chọn ngày bắt đầu và kết thúc")
         .When(end < start, "endDate", "Ngày kết thúc phải từ ngày bắt đầu trở đi")
         .When(end.DayNumber - start.DayNumber + 1 > MaxRangeDays, "endDate", $"Một đơn tối đa {MaxRangeDays} ngày")
         .When(period != LeavePeriod.FullDay && start != end, "period", "Nghỉ nửa ngày chỉ áp dụng cho một ngày");
        return v;
    }

    private static decimal CountDays(IReadOnlyList<DateOnly> workingDays, LeavePeriod p) =>
        workingDays.Count == 0 ? 0 : p == LeavePeriod.FullDay ? workingDays.Count : 0.5m;

    private static string PeriodLabel(LeavePeriod p) => p switch { LeavePeriod.Morning => " (sáng)", LeavePeriod.Afternoon => " (chiều)", _ => "" };

    private static LeaveRequestDto ToDto(LeaveRequest r, string typeName, EmployeeRef e) =>
        new(r.Id, Brief(e), r.LeaveTypeId, typeName, r.StartDate, r.EndDate, r.Period.ToString(), r.Days, r.Reason, r.Status.ToString(),
            r.RejectReason, r.ApprovalRequestId, r.CreatedAt);
}
