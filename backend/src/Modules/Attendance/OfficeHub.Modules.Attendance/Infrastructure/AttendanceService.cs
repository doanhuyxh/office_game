using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.Modules.Attendance.Domain;
using OfficeHub.Modules.Attendance.Contracts;
using OfficeHub.Modules.Leave.Contracts;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Attendance.Infrastructure;

/// <summary>Tra ca theo lịch + tính bảng công cho một khoảng ngày (tính trực tiếp từ sự kiện, không lưu sẵn).</summary>
internal sealed class AttendanceService(AttendanceDbContext db, IOptions<OfficeSettings> office, TimeProvider clock, ILeaveCalendar leaves,
    AttendanceCalendar calendar)
{
    public TimeZoneInfo Tz { get; } = TimeZoneInfo.FindSystemTimeZoneById(office.Value.TimeZone);

    /// <summary>Ca / lịch / ngày lễ trong RAM (TEST-245).</summary>
    public AttendanceCalendar Calendar => calendar;

    public DateTimeOffset Now => clock.GetUtcNow();
    public DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(Now, Tz).DateTime);
    public DateOnly LocalDate(DateTimeOffset t) => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(t, Tz).DateTime);

    public sealed record ComputedDay(DayResult Result, Shift? Shift, string? HolidayName);

    /// <summary>Bảng công từng ngày [from, to] cho danh sách nhân viên. Ngày ngoài thời gian làm việc → NotEmployed.</summary>
    public async Task<Dictionary<Guid, List<ComputedDay>>> ComputeAsync(IReadOnlyCollection<EmployeeRef> employees, DateOnly from, DateOnly to, CancellationToken ct)
    {
        var employeeIds = employees.Select(e => e.Id).ToList();
        var employment = employees.ToDictionary(e => e.Id, e => (e.JoinedAt, e.LeftAt));
        // Ca / lịch / ngày lễ: ảnh chụp trong RAM (TEST-245), bản sao cho lần tính này.
        var cal = await calendar.GetAsync(ct);
        var shifts = cal.ShiftCopies();
        var schedules = cal.SchedulesFor(employeeIds);
        var holidays = cal.HolidaysIn(from, to);
        // Nghỉ phép đã duyệt (module Leave). Sáng + chiều cùng ngày (2 đơn nửa ngày) → cộng thành cả ngày.
        var leaveByDay = (await leaves.GetApprovedAsync(employeeIds, from, to, ct))
            .GroupBy(l => (l.EmployeeId, l.Date))
            .ToDictionary(g => g.Key, g => new DayLeave(Math.Min(1m, g.Sum(x => x.Fraction)),
                Morning: g.Any(x => x.Half == LeaveHalf.Morning), Afternoon: g.Any(x => x.Half == LeaveHalf.Afternoon),
                Name: string.Join(" + ", g.Select(x => x.TypeName).Distinct())));
        // Tăng ca đã duyệt: cộng phút theo ngày (một ngày có thể nhiều đơn).
        var overtime = (await db.Overtime.AsNoTracking()
                .Where(o => employeeIds.Contains(o.EmployeeId) && o.WorkDate >= from && o.WorkDate <= to && o.Status == OvertimeStatus.Approved)
                .Select(o => new { o.EmployeeId, o.WorkDate, o.Minutes }).ToListAsync(ct))
            .GroupBy(o => (o.EmployeeId, o.WorkDate)).ToDictionary(g => g.Key, g => g.Sum(x => x.Minutes));
        var events = (await db.Events.AsNoTracking()
                .Where(e => employeeIds.Contains(e.EmployeeId) && e.WorkDate >= from && e.WorkDate <= to).ToListAsync(ct))
            .ToLookup(e => (e.EmployeeId, e.WorkDate));

        var result = new Dictionary<Guid, List<ComputedDay>>();
        foreach (var emp in employeeIds)
        {
            var days = new List<ComputedDay>();
            var (joined, left) = employment[emp];
            for (var d = from; d <= to; d = d.AddDays(1))
            {
                if (d < joined || (left is { } l && d > l))
                {
                    days.Add(new ComputedDay(new DayResult(d, DayStatus.NotEmployed, [], null, null, 0, 0, 0, 0, null), null, null));
                    continue;
                }
                var shiftId = ShiftIdFor(schedules, emp, d);
                var shift = shiftId is { } sid ? shifts.GetValueOrDefault(sid) : null;
                var holiday = holidays.GetValueOrDefault(d);
                var punches = events[(emp, d)].Select(e => new Punch(e.OccurredAt, e.Type, e.WorkMode));
                days.Add(new ComputedDay(TimesheetCalculator.Compute(d, punches, shift, holiday is not null, Now, Tz,
                    leaveByDay.GetValueOrDefault((emp, d)), overtime.GetValueOrDefault((emp, d))), shift, holiday));
            }
            result[emp] = days;
        }
        return result;
    }

    public async Task<Shift?> ShiftForAsync(Guid employeeId, DateOnly date, CancellationToken ct)
    {
        var cal = await calendar.GetAsync(ct);
        return ShiftIdFor(cal.SchedulesFor(employeeId), employeeId, date) is { } id ? cal.Shift(id) : null;
    }

    /// <summary>Lịch riêng của nhân viên (bộ mới nhất đã hiệu lực) → nếu không có thì lịch công ty.</summary>
    internal static Guid? ShiftIdForDate(List<ScheduleEntry> all, Guid employeeId, DateOnly date) => ShiftIdFor(all, employeeId, date);

    private static Guid? ShiftIdFor(List<ScheduleEntry> all, Guid employeeId, DateOnly date)
    {
        var own = Latest(all.Where(s => s.EmployeeId == employeeId), date);
        if (own is not null) return own.FirstOrDefault(s => s.DayOfWeek == date.DayOfWeek)?.ShiftId;
        return Latest(all.Where(s => s.EmployeeId == null), date)?.FirstOrDefault(s => s.DayOfWeek == date.DayOfWeek)?.ShiftId;
    }

    private static List<ScheduleEntry>? Latest(IEnumerable<ScheduleEntry> entries, DateOnly date)
    {
        var effective = entries.Where(s => s.EffectiveFrom <= date).ToList();
        if (effective.Count == 0) return null;
        var max = effective.Max(s => s.EffectiveFrom);
        return effective.Where(s => s.EffectiveFrom == max).ToList();
    }
}

/// <summary>Leave dùng để đếm số ngày nghỉ: chỉ những ngày có ca và không phải ngày lễ.</summary>
internal sealed class WorkCalendar(AttendanceCalendar calendar) : IWorkCalendar
{
    public async Task<IReadOnlyList<DateOnly>> WorkingDaysAsync(Guid employeeId, DateOnly from, DateOnly to, CancellationToken ct = default)
    {
        var cal = await calendar.GetAsync(ct);
        var schedules = cal.SchedulesFor(employeeId);
        var holidays = cal.HolidayDatesIn(from, to);
        var result = new List<DateOnly>();
        for (var d = from; d <= to; d = d.AddDays(1))
            if (!holidays.Contains(d) && AttendanceService.ShiftIdForDate(schedules, employeeId, d) is not null) result.Add(d);
        return result;
    }

    public async Task<int> StandardDaysAsync(Guid employeeId, DateOnly from, DateOnly to, CancellationToken ct = default) =>
        (await ScheduledDatesAsync(employeeId, from, to, ct)).Count;

    public async Task<IReadOnlyList<DateOnly>> ScheduledDatesAsync(Guid employeeId, DateOnly from, DateOnly to, CancellationToken ct = default)
    {
        var schedules = (await calendar.GetAsync(ct)).SchedulesFor(employeeId);
        var result = new List<DateOnly>();
        for (var d = from; d <= to; d = d.AddDays(1))
            if (AttendanceService.ShiftIdForDate(schedules, employeeId, d) is not null) result.Add(d);
        return result;
    }
}
