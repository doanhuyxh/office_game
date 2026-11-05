using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.Modules.Attendance.Domain;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Attendance.Infrastructure;

/// <summary>Tra ca theo lịch + tính bảng công cho một khoảng ngày (tính trực tiếp từ sự kiện, không lưu sẵn).</summary>
internal sealed class AttendanceService(AttendanceDbContext db, IOptions<OfficeSettings> office, TimeProvider clock)
{
    public TimeZoneInfo Tz { get; } = TimeZoneInfo.FindSystemTimeZoneById(office.Value.TimeZone);

    public DateTimeOffset Now => clock.GetUtcNow();
    public DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(Now, Tz).DateTime);
    public DateOnly LocalDate(DateTimeOffset t) => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(t, Tz).DateTime);

    public sealed record ComputedDay(DayResult Result, Shift? Shift, string? HolidayName);

    /// <summary>Bảng công từng ngày [from, to] cho danh sách nhân viên. Ngày ngoài thời gian làm việc → NotEmployed.</summary>
    public async Task<Dictionary<Guid, List<ComputedDay>>> ComputeAsync(IReadOnlyCollection<EmployeeRef> employees, DateOnly from, DateOnly to, CancellationToken ct)
    {
        var employeeIds = employees.Select(e => e.Id).ToList();
        var employment = employees.ToDictionary(e => e.Id, e => (e.JoinedAt, e.LeftAt));
        var shifts = await db.Shifts.IgnoreQueryFilters().AsNoTracking().ToDictionaryAsync(s => s.Id, ct);
        var schedules = await db.Schedules.AsNoTracking()
            .Where(s => s.EmployeeId == null || employeeIds.Contains(s.EmployeeId.Value)).ToListAsync(ct);
        var holidays = await db.Holidays.AsNoTracking().Where(h => h.Date >= from && h.Date <= to).ToDictionaryAsync(h => h.Date, h => h.Name, ct);
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
                days.Add(new ComputedDay(TimesheetCalculator.Compute(d, punches, shift, holiday is not null, Now, Tz), shift, holiday));
            }
            result[emp] = days;
        }
        return result;
    }

    public async Task<Shift?> ShiftForAsync(Guid employeeId, DateOnly date, CancellationToken ct)
    {
        var schedules = await db.Schedules.AsNoTracking().Where(s => s.EmployeeId == null || s.EmployeeId == employeeId).ToListAsync(ct);
        return ShiftIdFor(schedules, employeeId, date) is { } id ? await db.Shifts.IgnoreQueryFilters().FirstOrDefaultAsync(s => s.Id == id, ct) : null;
    }

    /// <summary>Lịch riêng của nhân viên (bộ mới nhất đã hiệu lực) → nếu không có thì lịch công ty.</summary>
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
