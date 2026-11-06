using Microsoft.EntityFrameworkCore;
using OfficeHub.Modules.Attendance.Contracts;
using OfficeHub.Modules.Attendance.Domain;
using OfficeHub.Modules.Attendance.Features;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Attendance.Infrastructure;

/// <summary>Cài đặt <see cref="IAttendanceReports"/>: dùng lại đúng bộ tính công / phân loại tăng ca của màn hình bảng công.</summary>
internal sealed class AttendanceReports(AttendanceService svc, AttendanceDbContext db, IEmployeeDirectory dir) : IAttendanceReports
{
    public async Task<IReadOnlyDictionary<Guid, TimesheetMonth>> MonthAsync(IReadOnlyCollection<Guid> employeeIds, DateOnly monthStart,
        CancellationToken ct = default)
    {
        var from = new DateOnly(monthStart.Year, monthStart.Month, 1);
        var to = from.AddMonths(1).AddDays(-1);
        var wanted = employeeIds.ToHashSet();
        var employees = (await dir.ListEmployedAsync(from, to, ct)).Where(e => wanted.Contains(e.Id)).ToList();
        if (employees.Count == 0) return new Dictionary<Guid, TimesheetMonth>();

        var computed = await svc.ComputeAsync(employees, from, to, ct);
        return computed.ToDictionary(kv => kv.Key, kv =>
        {
            var s = DtoMap.Summary(kv.Value);
            var days = kv.Value.Select(c => new TimesheetDay(c.Result.Date, c.Result.Status.ToString(), c.Result.WorkedMinutes, c.Result.RequiredMinutes,
                c.Result.LateMinutes, c.Result.ShortMinutes, c.Result.LeaveFraction, c.Result.LeaveName, c.HolidayName, c.Result.OvertimeMinutes,
                c.Result.WorkMode, c.Result.FirstIn, c.Result.LastOut)).ToList();
            return new TimesheetMonth(kv.Key, days, new TimesheetTotals(s.WorkDays, s.PresentDays, s.AbsentDays, s.LateCount, s.LateMinutes,
                s.ShortMinutes, s.WorkedMinutes, s.RequiredMinutes, s.OnsiteDays, s.RemoteDays, s.MissingCheckoutDays, s.LeaveDays, s.OvertimeMinutes));
        });
    }

    public async Task<IReadOnlyList<OvertimeEntry>> ApprovedOvertimeAsync(IReadOnlyCollection<Guid> employeeIds, DateOnly from, DateOnly to,
        CancellationToken ct = default)
    {
        var ids = employeeIds.ToList();
        var rows = await db.Overtime.AsNoTracking()
            .Where(o => ids.Contains(o.EmployeeId) && o.WorkDate >= from && o.WorkDate <= to && o.Status == OvertimeStatus.Approved)
            .OrderBy(o => o.WorkDate).ThenBy(o => o.StartTime).ToListAsync(ct);
        if (rows.Count == 0) return [];
        var holidays = (await db.Holidays.AsNoTracking().Where(h => h.Date >= from && h.Date <= to).Select(h => h.Date).ToListAsync(ct)).ToHashSet();
        var schedules = await db.Schedules.AsNoTracking().Where(s => s.EmployeeId == null || ids.Contains(s.EmployeeId.Value)).ToListAsync(ct);
        return rows.Select(o =>
        {
            var kind = OvertimeRules.Classify(holidays.Contains(o.WorkDate), AttendanceService.ShiftIdForDate(schedules, o.EmployeeId, o.WorkDate) is not null);
            return new OvertimeEntry(o.EmployeeId, o.WorkDate, o.StartTime.ToString("HH:mm"), o.EndTime.ToString("HH:mm"), o.Minutes,
                kind.ToString(), OvertimeRules.Percent(kind), o.Reason);
        }).ToList();
    }
}
