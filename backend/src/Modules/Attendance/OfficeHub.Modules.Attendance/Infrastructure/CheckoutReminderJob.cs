using OfficeHub.BuildingBlocks.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using OfficeHub.Modules.Attendance.Domain;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Attendance.Infrastructure;

/// <summary>
/// Mỗi 10 phút: (1) hết ca mà vẫn đang "vào" → nhắc chấm ra; (2) sáng hôm sau, hôm qua thiếu giờ ra và chưa giải trình → nhắc gửi giải trình.
/// Mỗi (nhân viên, ngày, loại) nhắc tối đa 1 lần (bảng attendance.reminders). Mặc định chỉ chuông; email bật bằng Attendance__Reminders__Email.
/// Chỉ chạy trong host Api, giả định một instance.
/// </summary>
internal sealed class CheckoutReminderJob(IServiceScopeFactory scopes, IOptionsMonitor<ReminderSettings> settings, ILogger<CheckoutReminderJob> log, JobMonitor monitor)
    : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(10);

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        var job = monitor.Register("attendance.checkout-reminder", "Nhắc quên chấm ra", Interval);
        await Task.Delay(TimeSpan.FromSeconds(45), stop); // đợi migration / seed xong
        using var timer = new PeriodicTimer(Interval);
        do
        {
            if (!settings.CurrentValue.Enabled) continue;
            try { await job.RunAsync(() => RunOnceAsync(stop)); }
            catch (Exception ex) when (!stop.IsCancellationRequested) { log.LogError(ex, "Lỗi khi nhắc chấm công"); }
        } while (await timer.WaitForNextTickAsync(stop));
    }

    internal async Task<int> RunOnceAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var sp = scope.ServiceProvider;
        var db = sp.GetRequiredService<AttendanceDbContext>();
        var svc = sp.GetRequiredService<AttendanceService>();
        var dir = sp.GetRequiredService<IEmployeeDirectory>();
        var notifier = sp.GetRequiredService<INotifier>();
        var s = settings.CurrentValue;

        var today = svc.Today;
        var yesterday = today.AddDays(-1);
        var nowLocal = TimeOnly.FromDateTime(TimeZoneInfo.ConvertTime(svc.Now, svc.Tz).DateTime);
        var employees = (await dir.ListActiveAsync(ct)).Where(e => e.UserId is not null).ToDictionary(e => e.Id);
        if (employees.Count == 0) return 0;
        var ids = employees.Keys.ToList();

        // Lần chấm cuối trong ngày của từng người (hôm nay, hôm qua)
        var last = await db.Events.AsNoTracking()
            .Where(e => ids.Contains(e.EmployeeId) && (e.WorkDate == today || e.WorkDate == yesterday))
            .GroupBy(e => new { e.EmployeeId, e.WorkDate })
            .Select(g => new { g.Key.EmployeeId, g.Key.WorkDate, Type = g.OrderByDescending(e => e.OccurredAt).First().Type })
            .ToListAsync(ct);
        var sent = await db.Reminders.AsNoTracking().Where(r => r.WorkDate == today || r.WorkDate == yesterday)
            .Select(r => new { r.EmployeeId, r.WorkDate, r.Kind }).ToListAsync(ct);
        bool already(Guid emp, DateOnly d, ReminderKind k) => sent.Any(x => x.EmployeeId == emp && x.WorkDate == d && x.Kind == k);

        var count = 0;
        // (1) Hôm nay: quên chấm ra
        foreach (var x in last.Where(x => x.WorkDate == today && x.Type == PunchType.In && !already(x.EmployeeId, today, ReminderKind.Checkout)))
        {
            var shift = await svc.ShiftForAsync(x.EmployeeId, today, ct);
            if (!ReminderRules.CheckoutDue(x.Type, nowLocal, shift, s)) continue;
            if (await MarkAsync(db, x.EmployeeId, today, ReminderKind.Checkout, svc.Now, ct) is false) continue;
            await notifier.NotifyAsync(new NotificationRequest([employees[x.EmployeeId].UserId!.Value], NotificationCategories.AttendanceReminder,
                "Bạn chưa chấm công ra", "Đã quá giờ kết thúc ca mà bạn vẫn đang ở trạng thái làm việc. Nhớ chấm công ra trước khi về.",
                "/attendance", SendEmail: s.Email), ct);
            count++;
        }

        // (2) Hôm qua: thiếu giờ ra, chưa giải trình
        var openYesterday = last.Where(x => x.WorkDate == yesterday && x.Type == PunchType.In && !already(x.EmployeeId, yesterday, ReminderKind.MissingCheckout))
            .Select(x => x.EmployeeId).ToList();
        if (openYesterday.Count > 0)
        {
            var corrected = (await db.Corrections.AsNoTracking()
                .Where(c => openYesterday.Contains(c.EmployeeId) && c.WorkDate == yesterday && c.Type == PunchType.Out
                            && (c.Status == CorrectionStatus.Pending || c.Status == CorrectionStatus.Approved))
                .Select(c => c.EmployeeId).ToListAsync(ct)).ToHashSet();
            foreach (var emp in openYesterday)
            {
                if (!ReminderRules.MissingCheckoutDue(PunchType.In, corrected.Contains(emp), nowLocal, s)) continue;
                if (await MarkAsync(db, emp, yesterday, ReminderKind.MissingCheckout, svc.Now, ct) is false) continue;
                await notifier.NotifyAsync(new NotificationRequest([employees[emp].UserId!.Value], NotificationCategories.AttendanceReminder,
                    $"Hôm qua ({yesterday:dd/MM}) bạn quên chấm công ra",
                    "Bảng công hôm qua đang thiếu giờ ra. Gửi giải trình để quản lý duyệt bổ sung.", "/attendance", SendEmail: s.Email), ct);
                count++;
            }
        }
        if (count > 0) log.LogInformation("Đã nhắc chấm công {Count} lượt", count);
        return count;
    }

    /// <summary>Ghi dấu đã nhắc trước khi gửi; trùng khoá (lần chạy song song) → bỏ qua.</summary>
    private static async Task<bool> MarkAsync(AttendanceDbContext db, Guid employeeId, DateOnly day, ReminderKind kind, DateTimeOffset now, CancellationToken ct)
    {
        var r = new AttendanceReminder { EmployeeId = employeeId, WorkDate = day, Kind = kind, SentAt = now };
        db.Reminders.Add(r);
        try { await db.SaveChangesAsync(ct); return true; }
        catch (DbUpdateException) { db.Entry(r).State = EntityState.Detached; return false; }
    }
}
