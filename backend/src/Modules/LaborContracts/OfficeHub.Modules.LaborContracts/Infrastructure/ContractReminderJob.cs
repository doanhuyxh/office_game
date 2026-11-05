using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.Modules.Identity.Contracts;
using OfficeHub.Modules.LaborContracts.Domain;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.LaborContracts.Infrastructure;

/// <summary>
/// Mỗi giờ: hợp đồng còn hiệu lực sắp hết hạn → thông báo (email + chuông) cho HR (không có HR → admin) và quản lý trực tiếp,
/// mốc 30 ngày và 7 ngày (<see cref="ContractRules.DueReminder"/>). Cờ Reminded30At / Reminded7At chống nhắc lặp.
/// Bỏ qua nhân viên đã nghỉ việc. Chỉ chạy trong host Api, giả định một instance.
/// </summary>
internal sealed class ContractReminderJob(IServiceScopeFactory scopes, IOptions<OfficeSettings> office, TimeProvider clock,
    ILogger<ContractReminderJob> log) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromHours(1);

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        await Task.Delay(TimeSpan.FromSeconds(30), stop); // đợi migration / seed xong
        using var timer = new PeriodicTimer(Interval);
        do
        {
            try { await RunOnceAsync(stop); }
            catch (Exception ex) when (!stop.IsCancellationRequested) { log.LogError(ex, "Lỗi khi nhắc hợp đồng sắp hết hạn"); }
        } while (await timer.WaitForNextTickAsync(stop));
    }

    internal async Task<int> RunOnceAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var sp = scope.ServiceProvider;
        var db = sp.GetRequiredService<ContractsDbContext>();
        var dir = sp.GetRequiredService<IEmployeeDirectory>();
        var accounts = sp.GetRequiredService<IAccountService>();
        var notifier = sp.GetRequiredService<INotifier>();
        var tz = TimeZoneInfo.FindSystemTimeZoneById(office.Value.TimeZone);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), tz).DateTime);
        var horizon = today.AddDays(ContractRules.RemindDays);

        var candidates = await db.Contracts.Where(c => c.TerminatedOn == null && c.EndDate != null && c.EndDate >= today && c.EndDate <= horizon
                                                       && (c.Reminded30At == null || c.Reminded7At == null)).ToListAsync(ct);
        if (candidates.Count == 0) return 0;
        var hr = await accounts.ListByRoleAsync(Roles.Hr, ct);
        if (hr.Count == 0) hr = await accounts.ListByRoleAsync(Roles.Admin, ct);
        var sent = 0;
        foreach (var c in candidates)
        {
            if (ContractRules.DueReminder(c.EndDate!.Value, today, c.Reminded30At is not null, c.Reminded7At is not null) is not { } kind) continue;
            if (await dir.GetAsync(c.EmployeeId, ct) is not { IsActive: true } emp) continue;
            var recipients = hr.Select(a => a.Id).ToList();
            if (emp.ManagerId is { } mid && (await dir.GetAsync(mid, ct))?.UserId is { } managerUser) recipients.Add(managerUser);
            recipients.RemoveAll(id => id == emp.UserId); // HR / quản lý không nhận nhắc hợp đồng của chính mình

            var left = c.EndDate.Value.DayNumber - today.DayNumber;
            var type = c.Type switch { ContractType.Probation => "Hợp đồng thử việc", _ => "Hợp đồng" };
            await notifier.NotifyAsync(new NotificationRequest(recipients, NotificationCategories.ContractExpiring,
                $"{type} {c.Number} của {emp.FullName} sắp hết hạn ({(left == 0 ? "hôm nay" : $"còn {left} ngày")})",
                $"{emp.Code} · {emp.FullName}{(emp.DepartmentName is { } d ? $" ({d})" : "")}\nHết hạn: {c.EndDate:dd/MM/yyyy}. Cần ký hợp đồng mới hoặc chấm dứt.",
                "/contracts"), ct);
            var now = clock.GetUtcNow();
            c.Reminded30At ??= now; // nhắc 7 ngày thì không nhắc 30 ngày nữa
            if (kind == ReminderKind.Days7) c.Reminded7At = now;
            await db.SaveChangesAsync(ct);
            sent++;
        }
        if (sent > 0) log.LogInformation("Đã nhắc {Count} hợp đồng sắp hết hạn", sent);
        return sent;
    }
}
