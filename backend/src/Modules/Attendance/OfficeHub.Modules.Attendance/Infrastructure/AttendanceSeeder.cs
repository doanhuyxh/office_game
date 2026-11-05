using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using OfficeHub.Modules.Attendance.Domain;

namespace OfficeHub.Modules.Attendance.Infrastructure;

/// <summary>Migration + dữ liệu mặc định lần đầu: ca hành chính, ca linh hoạt, lịch công ty thứ 2–6.</summary>
internal sealed class AttendanceSeeder(IServiceProvider sp, IConfiguration config, TimeProvider clock) : IHostedService
{
    public async Task StartAsync(CancellationToken ct)
    {
        using var scope = sp.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AttendanceDbContext>();
        if (config.GetValue("Database:MigrateOnStartup", true)) await db.Database.MigrateAsync(ct);
        if (await db.Shifts.IgnoreQueryFilters().AnyAsync(ct)) return;

        var now = clock.GetUtcNow();
        var office = new Shift
        {
            Name = "Hành chính", Type = ShiftType.Fixed, StartTime = new(8, 30), EndTime = new(17, 30), GraceMinutes = 5,
            BreakStart = new(12, 0), BreakEnd = new(13, 30), CreatedAt = now,
        };
        var flex = new Shift
        {
            Name = "Linh hoạt 8 tiếng", Type = ShiftType.Flexible, RequiredMinutes = 480, EarliestIn = new(7, 0), LatestIn = new(10, 0),
            BreakStart = new(12, 0), BreakEnd = new(13, 0), CreatedAt = now,
        };
        db.Shifts.AddRange(office, flex);
        foreach (var d in Enum.GetValues<DayOfWeek>())
            db.Schedules.Add(new ScheduleEntry
            {
                EmployeeId = null, EffectiveFrom = new DateOnly(2000, 1, 1), DayOfWeek = d, CreatedAt = now,
                ShiftId = d is DayOfWeek.Saturday or DayOfWeek.Sunday ? null : office.Id,
            });
        await db.SaveChangesAsync(ct);
    }

    public Task StopAsync(CancellationToken ct) => Task.CompletedTask;
}
