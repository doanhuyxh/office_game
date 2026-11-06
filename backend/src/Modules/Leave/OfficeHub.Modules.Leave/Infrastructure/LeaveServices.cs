using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.Modules.Approval.Contracts;
using OfficeHub.Modules.Leave.Contracts;
using OfficeHub.Modules.Leave.Domain;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Leave.Infrastructure;

/// <summary>Số dư phép năm. Năm = năm hiện tại theo giờ văn phòng.</summary>
public sealed record BalanceDto(int Year, int EntitlementThisYear, decimal AccruedThisYear, decimal CarriedFromPreviousYears,
    decimal AdjustedThisYear, decimal UsedThisYear, decimal Pending, decimal Available);

internal sealed class LeaveBalanceService(LeaveDbContext db, IOptions<OfficeSettings> office, TimeProvider clock)
{
    private readonly TimeZoneInfo _tz = TimeZoneInfo.FindSystemTimeZoneById(office.Value.TimeZone);
    public DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), _tz).DateTime);

    public async Task<Dictionary<Guid, BalanceDto>> ComputeAsync(IReadOnlyCollection<EmployeeRef> employees, CancellationToken ct)
    {
        var ids = employees.Select(e => e.Id).ToList();
        var annualTypes = await db.Types.Where(t => t.UsesAnnualBalance).Select(t => t.Id).ToListAsync(ct);
        var requests = await db.Requests.AsNoTracking()
            .Where(r => ids.Contains(r.EmployeeId) && annualTypes.Contains(r.LeaveTypeId)
                        && (r.Status == LeaveStatus.Approved || r.Status == LeaveStatus.Pending))
            .ToListAsync(ct);
        var adjustments = await db.Adjustments.AsNoTracking().Where(a => ids.Contains(a.EmployeeId)).ToListAsync(ct);
        var today = Today;
        var year = today.Year;
        var jan1Utc = new DateTimeOffset(new DateTime(year, 1, 1), _tz.GetUtcOffset(new DateTime(year, 1, 1)));

        var result = new Dictionary<Guid, BalanceDto>();
        foreach (var e in employees)
        {
            var total = AnnualLeavePolicy.AccruedTotal(e.JoinedAt, e.LeftAt, today);
            var thisYear = AnnualLeavePolicy.AccruedInYear(year, e.JoinedAt, e.LeftAt, today);
            var mine = requests.Where(r => r.EmployeeId == e.Id).ToList();
            var usedBefore = mine.Where(r => r.Status == LeaveStatus.Approved && r.StartDate.Year < year).Sum(r => r.Days);
            var usedThisYear = mine.Where(r => r.Status == LeaveStatus.Approved && r.StartDate.Year >= year).Sum(r => r.Days);
            var pending = mine.Where(r => r.Status == LeaveStatus.Pending).Sum(r => r.Days);
            var adj = adjustments.Where(a => a.EmployeeId == e.Id).ToList();
            var adjBefore = adj.Where(a => a.CreatedAt < jan1Utc).Sum(a => a.Days);
            var adjThisYear = adj.Where(a => a.CreatedAt >= jan1Utc).Sum(a => a.Days);
            result[e.Id] = new BalanceDto(year, AnnualLeavePolicy.EntitlementForYear(year, e.JoinedAt), thisYear,
                CarriedFromPreviousYears: total - thisYear + adjBefore - usedBefore,
                AdjustedThisYear: adjThisYear, UsedThisYear: usedThisYear, Pending: pending,
                Available: total + adjBefore + adjThisYear - usedBefore - usedThisYear - pending);
        }
        return result;
    }
}

/// <summary>Attendance đọc ngày nghỉ đã duyệt để hiện "Nghỉ phép" trong bảng công.</summary>
internal sealed class LeaveCalendar(LeaveDbContext db) : ILeaveCalendar
{
    public async Task<IReadOnlyList<LeaveDay>> GetApprovedAsync(IReadOnlyCollection<Guid> employeeIds, DateOnly fromDate, DateOnly toDate, CancellationToken ct = default)
    {
        var rows = await db.Requests.AsNoTracking()
            .Where(r => employeeIds.Contains(r.EmployeeId) && r.Status == LeaveStatus.Approved && r.StartDate <= toDate && r.EndDate >= fromDate)
            .Join(db.Types, r => r.LeaveTypeId, t => t.Id, (r, t) => new { r.EmployeeId, r.StartDate, r.EndDate, r.Period, t.Name, t.IsPaid })
            .ToListAsync(ct);
        var days = new List<LeaveDay>();
        foreach (var r in rows)
            for (var d = r.StartDate < fromDate ? fromDate : r.StartDate; d <= (r.EndDate > toDate ? toDate : r.EndDate); d = d.AddDays(1))
                days.Add(new LeaveDay(r.EmployeeId, d, r.Period == LeavePeriod.FullDay ? 1m : 0.5m,
                    r.Period switch { LeavePeriod.Morning => LeaveHalf.Morning, LeavePeriod.Afternoon => LeaveHalf.Afternoon, _ => null },
                    r.Name, r.IsPaid));
        return days;
    }
}

/// <summary>Nhận kết quả duyệt đơn nghỉ. Idempotent: chỉ đổi khi đơn còn Pending.</summary>
internal sealed class LeaveApprovalHandler(LeaveDbContext db, TimeProvider clock) : IApprovalHandler
{
    public string Type => ApprovalTypes.Leave;

    public Task OnApprovedAsync(Guid subjectId, CancellationToken ct) => SetAsync(subjectId, LeaveStatus.Approved, null, ct);
    public Task OnRejectedAsync(Guid subjectId, string? comment, CancellationToken ct) => SetAsync(subjectId, LeaveStatus.Rejected, comment, ct);
    public Task OnCancelledAsync(Guid subjectId, CancellationToken ct) => SetAsync(subjectId, LeaveStatus.Cancelled, null, ct);

    private async Task SetAsync(Guid id, LeaveStatus status, string? comment, CancellationToken ct)
    {
        var r = await db.Requests.FindAsync([id], ct);
        if (r is null || r.Status != LeaveStatus.Pending) return;
        r.Status = status;
        r.RejectReason = comment;
        r.DecidedAt = clock.GetUtcNow();
        await db.SaveChangesAsync(ct);
    }
}

internal sealed class LeaveBalances(LeaveBalanceService balances, OfficeHub.Modules.Organization.Contracts.IEmployeeDirectory dir) : ILeaveBalances
{
    public async Task<IReadOnlyDictionary<Guid, LeaveBalanceInfo>> GetAsync(IReadOnlyCollection<Guid> employeeIds, CancellationToken ct = default)
    {
        var emps = new List<OfficeHub.Modules.Organization.Contracts.EmployeeRef>();
        foreach (var id in employeeIds.Distinct())
            if (await dir.GetAsync(id, ct) is { } e) emps.Add(e);
        if (emps.Count == 0) return new Dictionary<Guid, LeaveBalanceInfo>();
        var map = await balances.ComputeAsync(emps, ct);
        return map.ToDictionary(kv => kv.Key, kv => new LeaveBalanceInfo(kv.Key, kv.Value.Year, kv.Value.EntitlementThisYear, kv.Value.AccruedThisYear,
            kv.Value.CarriedFromPreviousYears, kv.Value.AdjustedThisYear, kv.Value.UsedThisYear, kv.Value.Pending, kv.Value.Available));
    }
}
