using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using OfficeHub.BuildingBlocks.Caching;
using OfficeHub.Modules.Attendance.Contracts;
using OfficeHub.Modules.Attendance.Domain;
using OfficeHub.Modules.Attendance.Infrastructure;

namespace OfficeHub.Modules.Attendance.Tests;

/// <summary>
/// Cache ca / lịch / ngày lễ (TEST-245): đọc lần 2 từ RAM; HR thêm ngày lễ / đổi lịch / sửa ca qua SaveChanges → lần gọi sau thấy ngay;
/// bản sao trả ra không sửa được ảnh chụp. DB = EF InMemory; ExecuteDelete (xoá lịch / ngày lễ) kiểm bằng nhận diện câu SQL trên model Npgsql.
/// </summary>
public sealed class AttendanceCalendarCacheTests : IAsyncLifetime
{
    private ServiceProvider _sp = null!;
    private Guid _shift;
    private readonly Guid _emp = Guid.NewGuid();
    private static readonly DateOnly Monday = new(2026, 11, 30);

    public async Task InitializeAsync()
    {
        var s = new ServiceCollection();
        var dbName = Guid.NewGuid().ToString();
        s.AddDbContext<AttendanceDbContext>(o => o.UseInMemoryDatabase(dbName));
        s.AddCatalogCache<AttendanceDbContext>(r => r
            .On<Shift>(AttendanceCacheTags.Calendar)
            .On<ScheduleEntry>(AttendanceCacheTags.Calendar)
            .On<Holiday>(AttendanceCacheTags.Calendar));
        s.AddScoped<AttendanceCalendar>();
        s.AddScoped<IWorkCalendar, WorkCalendar>();
        _sp = s.BuildServiceProvider();

        await Db(db =>
        {
            var shift = new Shift { Name = "Hành chính", Type = ShiftType.Fixed, StartTime = new(8, 0), EndTime = new(17, 0) };
            db.Shifts.Add(shift);
            // Lịch công ty: thứ 2 – thứ 6 làm ca hành chính.
            foreach (var d in new[] { DayOfWeek.Monday, DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Thursday, DayOfWeek.Friday })
                db.Schedules.Add(new ScheduleEntry { EffectiveFrom = new(2026, 1, 1), DayOfWeek = d, ShiftId = shift.Id });
            _shift = shift.Id;
            return Task.CompletedTask;
        });
    }

    public async Task DisposeAsync() => await _sp.DisposeAsync();

    private async Task<T> In<T>(Func<IServiceProvider, Task<T>> f)
    {
        await using var scope = _sp.CreateAsyncScope();
        return await f(scope.ServiceProvider);
    }

    private async Task Db(Func<AttendanceDbContext, Task> f)
    {
        await using var scope = _sp.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AttendanceDbContext>();
        await f(db);
        await db.SaveChangesAsync();
    }

    private Task<IReadOnlyList<DateOnly>> WorkingDays() =>
        In(sp => sp.GetRequiredService<IWorkCalendar>().WorkingDaysAsync(_emp, Monday, Monday.AddDays(6)));

    [Fact]
    public async Task Second_read_comes_from_memory_snapshot()
    {
        var a = await In(sp => sp.GetRequiredService<AttendanceCalendar>().GetAsync().AsTask());
        var b = await In(sp => sp.GetRequiredService<AttendanceCalendar>().GetAsync().AsTask());
        Assert.Same(a, b);
    }

    [Fact]
    public async Task New_holiday_is_excluded_from_working_days_immediately()
    {
        Assert.Equal(5, (await WorkingDays()).Count);
        await Db(db => { db.Holidays.Add(new Holiday { Date = Monday, Name = "Nghỉ bù" }); return Task.CompletedTask; });
        var days = await WorkingDays();
        Assert.Equal(4, days.Count);
        Assert.DoesNotContain(Monday, days);
    }

    [Fact]
    public async Task New_personal_schedule_and_shift_edit_are_visible_immediately()
    {
        Assert.Equal(5, (await WorkingDays()).Count);
        // Lịch riêng: chỉ làm thứ 2.
        await Db(db => { db.Schedules.Add(new ScheduleEntry { EmployeeId = _emp, EffectiveFrom = new(2026, 11, 1), DayOfWeek = DayOfWeek.Monday, ShiftId = _shift }); return Task.CompletedTask; });
        Assert.Equal([Monday], await WorkingDays());

        await Db(async db => (await db.Shifts.SingleAsync(x => x.Id == _shift)).StartTime = new(9, 0));
        var shift = await In(async sp => (await sp.GetRequiredService<AttendanceCalendar>().GetAsync()).Shift(_shift));
        Assert.Equal(new TimeOnly(9, 0), shift!.StartTime);
    }

    [Fact]
    public async Task Returned_shift_is_a_copy()
    {
        var shift = await In(async sp => (await sp.GetRequiredService<AttendanceCalendar>().GetAsync()).Shift(_shift));
        shift!.Name = "đã sửa ở nơi gọi";
        var again = await In(async sp => (await sp.GetRequiredService<AttendanceCalendar>().GetAsync()).Shift(_shift));
        Assert.Equal("Hành chính", again!.Name);
    }

    [Fact]
    public void Execute_delete_on_schedules_or_holidays_is_detected()
    {
        var inv = new CatalogCacheInvalidation<AttendanceDbContext>(_sp.GetRequiredService<CatalogCache>(), new CatalogCacheRules()
            .On<Shift>(AttendanceCacheTags.Calendar).On<ScheduleEntry>(AttendanceCacheTags.Calendar).On<Holiday>(AttendanceCacheTags.Calendar));
        using var db = new AttendanceDbContext(new DbContextOptionsBuilder<AttendanceDbContext>().UseNpgsql("Host=localhost;Database=none").Options);
        Assert.Equal([AttendanceCacheTags.Calendar], inv.TagsForSql(db, "DELETE FROM attendance.schedules AS s WHERE s.\"EmployeeId\" = @id"));
        Assert.Equal([AttendanceCacheTags.Calendar], inv.TagsForSql(db, "DELETE FROM attendance.holidays AS h WHERE h.\"Id\" = @id"));
        Assert.Empty(inv.TagsForSql(db, "INSERT INTO attendance.events (\"Id\") VALUES (@p0)"));
    }
}
