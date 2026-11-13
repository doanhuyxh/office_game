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
using OfficeHub.Modules.Attendance.Domain;
using OfficeHub.Modules.Attendance.Features.Check;
using OfficeHub.Modules.Attendance.Features.Timesheets;
using OfficeHub.Modules.Attendance.Infrastructure;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Attendance.Features.Overtime;

/// <summary>startTime / endTime = "HH:mm", cùng một ngày (chưa hỗ trợ qua đêm).</summary>
public sealed record CreateOvertimeRequest(DateOnly WorkDate, string StartTime, string EndTime, string Reason);

/// <summary>kind = "Weekday" | "RestDay" | "Holiday" (hệ số 150 / 200 / 300%) — tính theo lịch + ngày lễ hiện tại.</summary>
public sealed record OvertimeDto(Guid Id, DateOnly WorkDate, string StartTime, string EndTime, int Minutes, string Kind, int Percent,
    string Reason, string Status, string? RejectReason, Guid? ApprovalRequestId, DateTimeOffset CreatedAt);

/// <summary>Xem trước khi gửi: số phút, loại ngày, tổng tháng / năm (đã duyệt + đang chờ, chưa tính đơn này), cảnh báo vượt giới hạn.</summary>
public sealed record OvertimePreviewDto(int Minutes, string Kind, int Percent, int MonthMinutes, int YearMinutes, IReadOnlyList<string> Warnings);

public sealed record TeamOvertimeDto(EmployeeBrief Employee, OvertimeDto Overtime);

public sealed record OvertimeCreatedDto(OvertimeDto Overtime, IReadOnlyList<string> Warnings);

internal static class OvertimeEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/overtime/preview", PreviewAsync);
        g.MapPost("/overtime", CreateAsync);
        g.MapGet("/overtime/my", MyAsync);
        g.MapGet("/overtime/pending", PendingAsync).RequireAuthorization(AuthPolicies.Manager);
    }

    private sealed record Checked(EmployeeRef Me, TimeOnly Start, TimeOnly End, int Minutes, OvertimeKind Kind, int MonthBefore, int YearBefore);

    private sealed record Failure(ValidationProblem? Invalid, ProblemHttpResult? Problem);

    /// <summary>Validate chung cho preview và tạo đơn. Lỗi theo field (400) hoặc lỗi chung (403 / 409).</summary>
    private static async Task<(Checked? Ok, Failure? Error)> CheckAsync(DateOnly workDate, string? startTime, string? endTime, string? reason,
        bool requireReason, ClaimsPrincipal user, IEmployeeDirectory dir, AttendanceDbContext db, AttendanceService svc, CancellationToken ct)
    {
        if (await CheckEndpoints.CurrentEmployeeAsync(user, dir, ct) is not { } me) return (null, new(null, CheckEndpoints.NoProfile()));
        if (!me.IsActive) return (null, new(null, TypedResults.Problem("Nhân viên đã nghỉ việc", statusCode: StatusCodes.Status403Forbidden)));

        var today = svc.Today;
        var v = new Validation()
            .When(!TryTime(startTime, out var start), "startTime", "Giờ phải có dạng HH:mm")
            .When(!TryTime(endTime, out var end), "endTime", "Giờ phải có dạng HH:mm")
            .When(workDate < today.AddDays(-OvertimeRules.MaxDaysAfter), "workDate", $"Chỉ khai bù tăng ca trong {OvertimeRules.MaxDaysAfter} ngày gần nhất")
            .When(workDate > today.AddDays(OvertimeRules.MaxDaysAhead), "workDate", $"Chỉ đăng ký trước tối đa {OvertimeRules.MaxDaysAhead} ngày")
            .When(workDate < me.JoinedAt, "workDate", "Ngày tăng ca trước ngày vào làm");
        if (requireReason) v.Required(reason, "reason", "Lý do").MaxLength(reason, 500, "reason", "Lý do");
        var minutes = OvertimeRules.MinutesOf(start, end);
        if (!v.Has("startTime") && !v.Has("endTime"))
        {
            if (minutes == 0) v.Add("endTime", "Giờ kết thúc phải sau giờ bắt đầu (chưa hỗ trợ tăng ca qua đêm)");
            else if (minutes < OvertimeRules.MinMinutes) v.Add("endTime", $"Tăng ca tối thiểu {OvertimeRules.MinMinutes} phút");
            else if (minutes > OvertimeRules.MaxMinutesPerRequest) v.Add("endTime", $"Mỗi đơn tối đa {OvertimeRules.MaxMinutesPerRequest / 60} giờ");
        }
        if (v.Failed) return (null, new(v.Problem(), null));

        var shift = await svc.ShiftForAsync(me.Id, workDate, ct);
        var isHoliday = await db.Holidays.AnyAsync(h => h.Date == workDate, ct);
        if (!isHoliday && OvertimeRules.ShiftOverlap(shift, start, end) is { } sh)
            return (null, new(new Validation().Add("startTime", $"Giờ tăng ca trùng giờ ca làm ({sh.Start:HH:mm}–{sh.End:HH:mm})").Problem(), null));

        var (yearStart, yearEnd) = (new DateOnly(workDate.Year, 1, 1), new DateOnly(workDate.Year + 1, 1, 1));
        var active = await db.Overtime.AsNoTracking()
            .Where(o => o.EmployeeId == me.Id && o.WorkDate >= yearStart && o.WorkDate < yearEnd
                        && (o.Status == OvertimeStatus.Pending || o.Status == OvertimeStatus.Approved))
            .Select(o => new { o.WorkDate, o.StartTime, o.EndTime, o.Minutes }).ToListAsync(ct);
        if (active.FirstOrDefault(o => o.WorkDate == workDate && OvertimeRules.Overlaps(start, end, o.StartTime, o.EndTime)) is { } dup)
            return (null, new(new Validation().Add("startTime", $"Trùng với đơn tăng ca khác trong ngày ({dup.StartTime:HH:mm}–{dup.EndTime:HH:mm})").Problem(), null));

        var monthBefore = active.Where(o => o.WorkDate.Month == workDate.Month).Sum(o => o.Minutes);
        var yearBefore = active.Sum(o => o.Minutes);
        return (new Checked(me, start, end, minutes, OvertimeRules.Classify(isHoliday, shift is not null), monthBefore, yearBefore), null);
    }

    private static async Task<Results<Ok<OvertimePreviewDto>, ValidationProblem, ProblemHttpResult>> PreviewAsync(DateOnly workDate, string? startTime, string? endTime, ClaimsPrincipal user,
        IEmployeeDirectory dir, AttendanceDbContext db, AttendanceService svc, CancellationToken ct)
    {
        var (c, error) = await CheckAsync(workDate, startTime, endTime, null, false, user, dir, db, svc, ct);
        if (c is null) return error!.Invalid is { } invalid ? invalid : error.Problem!;
        return TypedResults.Ok(new OvertimePreviewDto(c.Minutes, c.Kind.ToString(), OvertimeRules.Percent(c.Kind), c.MonthBefore, c.YearBefore,
            OvertimeRules.Warnings(workDate, c.MonthBefore, c.YearBefore, c.Minutes)));
    }

    /// <summary>Thứ tự (giữ nguyên): validate → lưu Pending → gửi luồng duyệt (quản lý → HR) → lưu ApprovalRequestId; gửi lỗi thì xoá.</summary>
    private static async Task<Results<Ok<OvertimeCreatedDto>, ValidationProblem, ProblemHttpResult>> CreateAsync(CreateOvertimeRequest req, ClaimsPrincipal user, IEmployeeDirectory dir,
        AttendanceDbContext db, AttendanceService svc, IApprovalService approvals, CancellationToken ct)
    {
        var (c, error) = await CheckAsync(req.WorkDate, req.StartTime, req.EndTime, req.Reason, true, user, dir, db, svc, ct);
        if (c is null) return error!.Invalid is { } invalid ? invalid : error.Problem!;
        var warnings = OvertimeRules.Warnings(req.WorkDate, c.MonthBefore, c.YearBefore, c.Minutes);

        var o = new OvertimeRequest
        {
            EmployeeId = c.Me.Id, WorkDate = req.WorkDate, StartTime = c.Start, EndTime = c.End, Minutes = c.Minutes,
            Reason = req.Reason.Trim(), Status = OvertimeStatus.Pending, CreatedAt = svc.Now,
        };
        db.Overtime.Add(o);
        await db.SaveChangesAsync(ct);
        try
        {
            // Người duyệt thấy cảnh báo vượt giới hạn ngay trong tóm tắt đơn.
            var summary = $"{c.Start:HH:mm}–{c.End:HH:mm} ({OvertimeRules.Hours(c.Minutes)} giờ, {OvertimeRules.Label(c.Kind)} {OvertimeRules.Percent(c.Kind)}%) · {o.Reason}"
                          + string.Concat(warnings.Select(w => $" · ⚠ {w}"));
            o.ApprovalRequestId = await approvals.SubmitAsync(new ApprovalSubmission(ApprovalTypes.Overtime, o.Id, c.Me.Id,
                $"Tăng ca {req.WorkDate:dd/MM/yyyy}", summary, [ApprovalStepKind.Manager, ApprovalStepKind.Hr]), ct);
            await db.SaveChangesAsync(ct);
        }
        catch
        {
            db.Overtime.Remove(o);
            await db.SaveChangesAsync(CancellationToken.None);
            throw;
        }
        return TypedResults.Ok(new OvertimeCreatedDto(ToDto(o, c.Kind), warnings));
    }

    /// <summary>Đơn tăng ca của tôi (theo tháng nếu có), kèm loại ngày tính theo lịch / ngày lễ hiện tại.</summary>
    /// <summary>Đơn tăng ca của tôi. Có <c>page</c> → trang (COUNT + OFFSET/LIMIT); không → 200 đơn mới nhất.</summary>
    private static async Task<Results<Ok<List<OvertimeDto>>, Ok<PagedResult<OvertimeDto>>, ProblemHttpResult>> MyAsync(string? month, int? page, int? pageSize,
        ClaimsPrincipal user, IEmployeeDirectory dir, AttendanceDbContext db, AttendanceService svc, CancellationToken ct)
    {
        if (await CheckEndpoints.CurrentEmployeeAsync(user, dir, ct) is not { } me) return CheckEndpoints.NoProfile();
        var q = db.Overtime.AsNoTracking().Where(o => o.EmployeeId == me.Id);
        if (DateOnly.TryParseExact((month ?? "") + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var m))
            q = q.Where(o => o.WorkDate >= m && o.WorkDate < m.AddMonths(1));
        var ordered = q.OrderByDescending(o => o.WorkDate).ThenByDescending(o => o.StartTime);
        var paged = page is { } pg ? await ordered.ToPagedAsync(pg, pageSize, ct) : null;
        var rows = paged?.Items.ToList() ?? await ordered.Take(200).ToListAsync(ct);

        List<OvertimeDto> dtos = [];
        if (rows.Count > 0)
        {
            var (from, to) = (rows.Min(r => r.WorkDate), rows.Max(r => r.WorkDate));
            var holidays = (await db.Holidays.AsNoTracking().Where(h => h.Date >= from && h.Date <= to).Select(h => h.Date).ToListAsync(ct)).ToHashSet();
            var schedules = await db.Schedules.AsNoTracking().Where(s => s.EmployeeId == null || s.EmployeeId == me.Id).ToListAsync(ct);
            dtos = rows.Select(o => ToDto(o, OvertimeRules.Classify(holidays.Contains(o.WorkDate),
                AttendanceService.ShiftIdForDate(schedules, me.Id, o.WorkDate) is not null))).ToList();
        }
        if (paged is null) return TypedResults.Ok(dtos);
        return TypedResults.Ok(paged.With(dtos));
    }

    /// <summary>
    /// Đơn tăng ca đang chờ duyệt (TEST-79, tool list_pending_overtime) của người tôi được xem: HR → mọi người đang làm,
    /// quản lý → bản thân + cấp dưới. Gồm cả đơn đang chờ bước khác — khác hộp duyệt chỉ có đơn chờ tôi. Không có tiền (chỉ phút + hệ số).
    /// </summary>
    private static async Task<Ok<List<TeamOvertimeDto>>> PendingAsync(ClaimsPrincipal user, IEmployeeDirectory dir, AttendanceDbContext db,
        CancellationToken ct)
    {
        var emps = (await TimesheetEndpoints.VisibleEmployeesAsync(user, dir, ct)).ToDictionary(e => e.Id);
        var ids = emps.Keys.ToList();
        var rows = await db.Overtime.AsNoTracking().Where(o => o.Status == OvertimeStatus.Pending && ids.Contains(o.EmployeeId))
            .OrderBy(o => o.WorkDate).ThenBy(o => o.StartTime).Take(500).ToListAsync(ct);
        if (rows.Count == 0) return TypedResults.Ok(new List<TeamOvertimeDto>());
        var (from, to) = (rows.Min(r => r.WorkDate), rows.Max(r => r.WorkDate));
        var holidays = (await db.Holidays.AsNoTracking().Where(h => h.Date >= from && h.Date <= to).Select(h => h.Date).ToListAsync(ct)).ToHashSet();
        var owners = rows.Select(r => r.EmployeeId).Distinct().ToList();
        var schedules = await db.Schedules.AsNoTracking().Where(s => s.EmployeeId == null || owners.Contains(s.EmployeeId.Value)).ToListAsync(ct);
        return TypedResults.Ok(rows.Select(o => new TeamOvertimeDto(DtoMap.Brief(emps[o.EmployeeId]), ToDto(o, OvertimeRules.Classify(holidays.Contains(o.WorkDate),
            AttendanceService.ShiftIdForDate(schedules, o.EmployeeId, o.WorkDate) is not null)))).ToList());
    }

    private static bool TryTime(string? s, out TimeOnly t) =>
        TimeOnly.TryParseExact(s ?? "", "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out t);

    private static OvertimeDto ToDto(OvertimeRequest o, OvertimeKind kind) => new(o.Id, o.WorkDate, o.StartTime.ToString("HH:mm"),
        o.EndTime.ToString("HH:mm"), o.Minutes, kind.ToString(), OvertimeRules.Percent(kind), o.Reason, o.Status.ToString(), o.RejectReason,
        o.ApprovalRequestId, o.CreatedAt);
}

/// <summary>Nhận kết quả duyệt tăng ca. Idempotent: chỉ đổi khi đơn còn Pending. Duyệt xong bảng công tự cộng giờ (tính lúc đọc).</summary>
internal sealed class OvertimeApprovalHandler(AttendanceDbContext db, AttendanceService svc) : IApprovalHandler
{
    public string Type => ApprovalTypes.Overtime;

    public Task OnApprovedAsync(Guid subjectId, CancellationToken ct) => SetAsync(subjectId, OvertimeStatus.Approved, null, ct);
    public Task OnRejectedAsync(Guid subjectId, string? comment, CancellationToken ct) => SetAsync(subjectId, OvertimeStatus.Rejected, comment, ct);
    public Task OnCancelledAsync(Guid subjectId, CancellationToken ct) => SetAsync(subjectId, OvertimeStatus.Cancelled, null, ct);

    private async Task SetAsync(Guid id, OvertimeStatus status, string? comment, CancellationToken ct)
    {
        var o = await db.Overtime.FindAsync([id], ct);
        if (o is null || o.Status != OvertimeStatus.Pending) return;
        o.Status = status;
        o.RejectReason = comment;
        o.DecidedAt = svc.Now;
        await db.SaveChangesAsync(ct);
    }
}
