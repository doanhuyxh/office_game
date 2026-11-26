using System.Collections.Frozen;
using System.Collections.Immutable;
using System.ComponentModel;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Caching;
using OfficeHub.Modules.Attendance.Domain;

namespace OfficeHub.Modules.Attendance.Infrastructure;

/// <summary>Tag (= khoá) cache danh mục chấm công (TEST-245): bảng shifts / schedules / holidays bị ghi → xoá (AttendanceModule → AddCatalogCache).</summary>
public static class AttendanceCacheTags
{
    public const string Calendar = "attendance:calendar";
}

/// <summary>
/// Ảnh chụp ca (gồm ca đã xoá mềm — lịch cũ còn trỏ tới), mọi dòng lịch làm việc và mọi ngày lễ. Bất biến, dùng chung giữa các request:
/// entity trong ảnh chụp KHÔNG trả thẳng ra ngoài — <see cref="Shift"/> / <see cref="SchedulesFor(Guid)"/> trả bản sao.
/// </summary>
[ImmutableObject(true)]
internal sealed record AttendanceCalendarSnapshot(
    FrozenDictionary<Guid, Shift> Shifts,
    ImmutableArray<ScheduleEntry> Schedules,
    FrozenDictionary<DateOnly, string> Holidays)
{
    /// <summary>Bản sao ca theo id (null = không có).</summary>
    public Shift? Shift(Guid id) => Shifts.TryGetValue(id, out var s) ? s.Copy() : null;

    /// <summary>Bản sao mọi ca theo id — cho tính bảng công nhiều ngày.</summary>
    public Dictionary<Guid, Shift> ShiftCopies() => Shifts.ToDictionary(kv => kv.Key, kv => kv.Value.Copy());

    /// <summary>Lịch công ty + lịch riêng của một nhân viên (bản sao) — đầu vào của <c>AttendanceService.ShiftIdForDate</c>.</summary>
    public List<ScheduleEntry> SchedulesFor(Guid employeeId) =>
        Schedules.Where(s => s.EmployeeId == null || s.EmployeeId == employeeId).Select(s => s.Copy()).ToList();

    /// <summary>Lịch công ty + lịch riêng của các nhân viên (bản sao).</summary>
    public List<ScheduleEntry> SchedulesFor(IEnumerable<Guid> employeeIds)
    {
        var ids = employeeIds.ToHashSet();
        return Schedules.Where(s => s.EmployeeId == null || ids.Contains(s.EmployeeId.Value)).Select(s => s.Copy()).ToList();
    }

    public bool IsHoliday(DateOnly date) => Holidays.ContainsKey(date);

    /// <summary>Ngày lễ trong [from, to] → tên.</summary>
    public Dictionary<DateOnly, string> HolidaysIn(DateOnly from, DateOnly to) =>
        Holidays.Where(h => h.Key >= from && h.Key <= to).ToDictionary(h => h.Key, h => h.Value);

    public HashSet<DateOnly> HolidayDatesIn(DateOnly from, DateOnly to) =>
        Holidays.Keys.Where(d => d >= from && d <= to).ToHashSet();
}

/// <summary>
/// Đọc ca / lịch làm việc / ngày lễ qua cache trong RAM (TEST-245) thay cho 2–3 câu truy vấn ở mỗi lần tính bảng công / chấm công.
/// Bảng công vẫn tính từ sự kiện mỗi lần (luật 4) — chỉ danh mục đầu vào được cache. HR sửa ca / lịch / ngày lễ → xoá cache ngay.
/// </summary>
internal sealed class AttendanceCalendar(AttendanceDbContext db, CatalogCache cache)
{
    public ValueTask<AttendanceCalendarSnapshot> GetAsync(CancellationToken ct = default) =>
        cache.GetAsync(AttendanceCacheTags.Calendar, AttendanceCacheTags.Calendar, LoadAsync, ct);

    private async Task<AttendanceCalendarSnapshot> LoadAsync(CancellationToken ct)
    {
        var shifts = await db.Shifts.IgnoreQueryFilters().AsNoTracking().ToListAsync(ct);
        var schedules = await db.Schedules.AsNoTracking().ToListAsync(ct);
        var holidays = await db.Holidays.AsNoTracking().Select(h => new { h.Date, h.Name }).ToListAsync(ct);
        return new AttendanceCalendarSnapshot(
            shifts.ToFrozenDictionary(s => s.Id),
            [.. schedules],
            holidays.GroupBy(h => h.Date).ToFrozenDictionary(g => g.Key, g => g.First().Name));
    }
}
