using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Approval.Contracts;
using OfficeHub.Modules.Attendance.Domain;
using OfficeHub.Modules.Attendance.Features.Check;
using OfficeHub.Modules.Attendance.Infrastructure;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Attendance.Features.Corrections;

/// <summary>type = "In" | "Out"; time = "HH:mm"; workMode = "Onsite" | "Remote".</summary>
public sealed record CreateCorrectionRequest(DateOnly WorkDate, string Type, string Time, string WorkMode, string Reason);
public sealed record CorrectionDto(Guid Id, DateOnly WorkDate, string Type, string Time, string WorkMode, string Reason, string Status,
    string? RejectReason, Guid? ApprovalRequestId, DateTimeOffset CreatedAt);

internal static class CorrectionEndpoints
{
    /// <summary>Chỉ giải trình trong khoảng ngày gần đây để bảng công không bị sửa lùi quá xa.</summary>
    public const int MaxDaysBack = 31;

    public static void Map(RouteGroupBuilder g)
    {
        g.MapPost("/corrections", CreateAsync);
        g.MapGet("/corrections/my", MyAsync);
    }

    /// <summary>Thứ tự (giữ nguyên): validate → lưu Pending → gửi luồng duyệt (quản lý → HR) → lưu ApprovalRequestId; gửi lỗi thì xoá.</summary>
    private static async Task<Results<Ok<CorrectionDto>, ValidationProblem, ProblemHttpResult>> CreateAsync(CreateCorrectionRequest req,
        ClaimsPrincipal user, IEmployeeDirectory dir, AttendanceDbContext db, AttendanceService svc, IApprovalService approvals, CancellationToken ct)
    {
        if (await CheckEndpoints.CurrentEmployeeAsync(user, dir, ct) is not { } me) return CheckEndpoints.NoProfile();
        if (!me.IsActive) return TypedResults.Problem("Nhân viên đã nghỉ việc", statusCode: StatusCodes.Status403Forbidden);
        var today = svc.Today;
        var v = new Validation()
            .When(!Enum.TryParse<PunchType>(req.Type, true, out var type), "type", "Chọn giờ vào hoặc giờ ra")
            .When(!TimeOnly.TryParseExact(req.Time ?? "", "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var time), "time", "Giờ phải có dạng HH:mm")
            .When(!Enum.TryParse<WorkMode>(req.WorkMode, true, out var mode), "workMode", "Chọn hình thức làm việc")
            .Required(req.Reason, "reason", "Lý do").MaxLength(req.Reason, 500, "reason", "Lý do")
            .When(req.WorkDate > today, "workDate", "Không giải trình cho ngày trong tương lai")
            .When(req.WorkDate < today.AddDays(-MaxDaysBack), "workDate", $"Chỉ giải trình được trong {MaxDaysBack} ngày gần nhất")
            .When(req.WorkDate < me.JoinedAt, "workDate", "Ngày giải trình trước ngày vào làm");
        if (!v.Failed && req.WorkDate == today && TimesheetCalculator.At(today, time, svc.Tz) > svc.Now)
            v.Add("time", "Giờ giải trình chưa tới");
        if (v.Failed) return v.Problem();
        if (await db.Corrections.AnyAsync(c => c.EmployeeId == me.Id && c.WorkDate == req.WorkDate && c.Type == type
                                               && c.Status == CorrectionStatus.Pending, ct))
            return new Validation().Add("type", "Đã có giải trình cùng ngày, cùng loại đang chờ duyệt").Problem();

        var c = new AttendanceCorrection
        {
            EmployeeId = me.Id, WorkDate = req.WorkDate, Type = type, Time = time, WorkMode = mode, Reason = req.Reason.Trim(),
            Status = CorrectionStatus.Pending, CreatedAt = svc.Now,
        };
        db.Corrections.Add(c);
        await db.SaveChangesAsync(ct);
        try
        {
            var label = type == PunchType.In ? "giờ vào" : "giờ ra";
            c.ApprovalRequestId = await approvals.SubmitAsync(new ApprovalSubmission(ApprovalTypes.AttendanceCorrection, c.Id, me.Id,
                $"Giải trình chấm công {req.WorkDate:dd/MM/yyyy}",
                $"Bổ sung {label} {time:HH:mm} ({(mode == WorkMode.Onsite ? "văn phòng" : "từ xa")}) · {c.Reason}",
                [ApprovalStepKind.Manager, ApprovalStepKind.Hr]), ct);
            await db.SaveChangesAsync(ct);
        }
        catch
        {
            db.Corrections.Remove(c);
            await db.SaveChangesAsync(CancellationToken.None);
            throw;
        }
        return TypedResults.Ok(ToDto(c));
    }

    private static async Task<Results<Ok<List<CorrectionDto>>, ProblemHttpResult>> MyAsync(string? month, ClaimsPrincipal user, IEmployeeDirectory dir,
        AttendanceDbContext db, CancellationToken ct)
    {
        if (await CheckEndpoints.CurrentEmployeeAsync(user, dir, ct) is not { } me) return CheckEndpoints.NoProfile();
        var q = db.Corrections.AsNoTracking().Where(c => c.EmployeeId == me.Id);
        if (DateOnly.TryParseExact((month ?? "") + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var m))
            q = q.Where(c => c.WorkDate >= m && c.WorkDate < m.AddMonths(1));
        var rows = await q.OrderByDescending(c => c.WorkDate).ThenByDescending(c => c.CreatedAt).Take(200).ToListAsync(ct);
        return TypedResults.Ok(rows.Select(ToDto).ToList());
    }

    private static CorrectionDto ToDto(AttendanceCorrection c) => new(c.Id, c.WorkDate, c.Type.ToString(), c.Time.ToString("HH:mm"),
        c.WorkMode.ToString(), c.Reason, c.Status.ToString(), c.RejectReason, c.ApprovalRequestId, c.CreatedAt);
}

/// <summary>Nhận kết quả duyệt giải trình. Idempotent: chỉ xử lý khi còn Pending; sự kiện có IdempotencyKey duy nhất.</summary>
internal sealed class CorrectionApprovalHandler(AttendanceDbContext db, AttendanceService svc) : IApprovalHandler
{
    public string Type => ApprovalTypes.AttendanceCorrection;

    public async Task OnApprovedAsync(Guid subjectId, CancellationToken ct)
    {
        var c = await db.Corrections.FindAsync([subjectId], ct);
        if (c is null || c.Status != CorrectionStatus.Pending) return;
        var key = $"correction:{c.Id}";
        if (!await db.Events.AnyAsync(e => e.IdempotencyKey == key, ct))
            db.Events.Add(new AttendanceEvent
            {
                EmployeeId = c.EmployeeId, WorkDate = c.WorkDate, // Npgsql chỉ nhận DateTimeOffset UTC cho timestamptz → đổi về UTC trước khi lưu
                OccurredAt = TimesheetCalculator.At(c.WorkDate, c.Time, svc.Tz).ToUniversalTime(),
                Type = c.Type, Source = PunchSource.Manual, WorkMode = c.WorkMode, Note = c.Reason, IdempotencyKey = key,
            });
        c.Status = CorrectionStatus.Approved;
        c.DecidedAt = svc.Now;
        await db.SaveChangesAsync(ct);
    }

    public Task OnRejectedAsync(Guid subjectId, string? comment, CancellationToken ct) => SetAsync(subjectId, CorrectionStatus.Rejected, comment, ct);
    public Task OnCancelledAsync(Guid subjectId, CancellationToken ct) => SetAsync(subjectId, CorrectionStatus.Cancelled, null, ct);

    private async Task SetAsync(Guid id, CorrectionStatus status, string? comment, CancellationToken ct)
    {
        var c = await db.Corrections.FindAsync([id], ct);
        if (c is null || c.Status != CorrectionStatus.Pending) return;
        c.Status = status;
        c.RejectReason = comment;
        c.DecidedAt = svc.Now;
        await db.SaveChangesAsync(ct);
    }
}
