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
/// Hợp đồng thử việc: nhắc riêng 7 / 3 ngày + quá hạn khi chưa có hợp đồng tiếp theo (<see cref="ContractRules.DueProbationReminder(LaborContract, IEnumerable{LaborContract}, DateOnly)"/>).
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

        // Hợp đồng thử việc có nhắc riêng (RemindProbationAsync) — không nhắc chung 30 / 7 ngày.
        var candidates = await db.Contracts.Where(c => c.Type != ContractType.Probation && c.TerminatedOn == null && c.EndDate != null
                                                       && c.EndDate >= today && c.EndDate <= horizon
                                                       && (c.Reminded30At == null || c.Reminded7At == null)).ToListAsync(ct);
        var probations = await ProbationCandidatesAsync(db, today, ct);
        if (candidates.Count == 0 && probations.Count == 0) return 0;
        var hr = await HrRecipientsAsync(accounts, ct);
        var sent = 0;
        foreach (var c in candidates)
        {
            if (ContractRules.DueReminder(c.EndDate!.Value, today, c.Reminded30At is not null, c.Reminded7At is not null) is not { } kind) continue;
            if (await dir.GetAsync(c.EmployeeId, ct) is not { IsActive: true } emp) continue;
            var recipients = await RecipientsAsync(hr, emp, dir, ct);

            var left = c.EndDate.Value.DayNumber - today.DayNumber;
            await notifier.NotifyAsync(new NotificationRequest(recipients, NotificationCategories.ContractExpiring,
                $"Hợp đồng {c.Number} của {emp.FullName} sắp hết hạn ({(left == 0 ? "hôm nay" : $"còn {left} ngày")})",
                $"{Who(emp)}\nHết hạn: {c.EndDate:dd/MM/yyyy}. Cần ký hợp đồng mới hoặc chấm dứt.",
                "/contracts"), ct);
            var now = clock.GetUtcNow();
            c.Reminded30At ??= now; // nhắc 7 ngày thì không nhắc 30 ngày nữa
            if (kind == ReminderKind.Days7) c.Reminded7At = now;
            await db.SaveChangesAsync(ct);
            sent++;
        }
        sent += await RemindProbationAsync(probations, db, dir, notifier, hr, today, ct);
        if (sent > 0) log.LogInformation("Đã nhắc {Count} hợp đồng sắp hết hạn / hết thử việc", sent);
        return sent;
    }

    /// <summary>
    /// Thử việc sắp hết (7, 3 ngày) / đã hết (cảnh báo một lần) mà nhân viên chưa có hợp đồng tiếp theo → HR (không có → admin) + quản lý trực tiếp:
    /// đánh giá kết quả, thông báo kết quả cho người lao động (BLLĐ 2019 Điều 27), đạt thì ký HĐLĐ. Cờ Reminded7At / Reminded3At / OverdueRemindedAt chống lặp.
    /// </summary>
    private static Task<List<LaborContract>> ProbationCandidatesAsync(ContractsDbContext db, DateOnly today, CancellationToken ct)
    {
        var from = today.AddDays(-ContractRules.ProbationOverdueWindowDays);
        var to = today.AddDays(ContractRules.ProbationRemindDays);
        return db.Contracts.Where(c => c.Type == ContractType.Probation && c.TerminatedOn == null && c.EndDate != null
                                       && c.EndDate >= from && c.EndDate <= to
                                       && (c.Reminded7At == null || c.Reminded3At == null || c.OverdueRemindedAt == null)).ToListAsync(ct);
    }

    private async Task<int> RemindProbationAsync(List<LaborContract> probations, ContractsDbContext db, IEmployeeDirectory dir, INotifier notifier,
        List<Guid> hr, DateOnly today, CancellationToken ct)
    {
        if (probations.Count == 0) return 0;
        var employeeIds = probations.Select(c => c.EmployeeId).Distinct().ToList();
        var others = await db.Contracts.AsNoTracking().Where(c => employeeIds.Contains(c.EmployeeId)).ToListAsync(ct);
        var sent = 0;
        foreach (var c in probations)
        {
            if (ContractRules.DueProbationReminder(c, others.Where(o => o.EmployeeId == c.EmployeeId), today) is not { } kind) continue;
            if (await dir.GetAsync(c.EmployeeId, ct) is not { IsActive: true } emp) continue;
            var recipients = await RecipientsAsync(hr, emp, dir, ct);

            var end = c.EndDate!.Value;
            var left = end.DayNumber - today.DayNumber;
            var range = $"Hợp đồng thử việc {c.Number}: {c.StartDate:dd/MM/yyyy} – {end:dd/MM/yyyy}. Chưa có hợp đồng lao động tiếp theo.";
            var (title, body) = kind == ProbationReminderKind.Overdue
                ? ($"Quá hạn: thử việc của {emp.FullName} đã kết thúc {end:dd/MM/yyyy}, chưa có hợp đồng mới",
                   $"{Who(emp)}\n{range}\nNgười lao động vẫn đang làm việc. Cần ngay: thông báo kết quả thử việc (BLLĐ 2019 Điều 27); " +
                   "đạt yêu cầu → ký hợp đồng lao động (thêm hợp đồng mới trong OfficeHub); không đạt → chấm dứt hợp đồng thử việc.")
                : ($"Thử việc của {emp.FullName} kết thúc {end:dd/MM/yyyy} ({(left == 0 ? "hôm nay" : $"còn {left} ngày")}) — cần đánh giá",
                   $"{Who(emp)}\n{range}\nTrước khi hết thử việc (BLLĐ 2019 Điều 27):\n" +
                   "1. Đánh giá kết quả thử việc.\n2. Thông báo kết quả thử việc cho người lao động.\n" +
                   "3. Đạt yêu cầu → ký hợp đồng lao động; không đạt → chấm dứt hợp đồng thử việc.");
            await notifier.NotifyAsync(new NotificationRequest(recipients, NotificationCategories.ProbationEnding, title, body, "/contracts"), ct);

            var now = clock.GetUtcNow();
            c.Reminded7At ??= now; // mốc sau bao hàm mốc trước: không nhắc bù mốc đã qua
            if (kind is ProbationReminderKind.Days3 or ProbationReminderKind.Overdue) c.Reminded3At ??= now;
            if (kind == ProbationReminderKind.Overdue) c.OverdueRemindedAt = now;
            await db.SaveChangesAsync(ct);
            sent++;
        }
        return sent;
    }

    private static async Task<List<Guid>> HrRecipientsAsync(IAccountService accounts, CancellationToken ct)
    {
        var hr = await accounts.ListByRoleAsync(Roles.Hr, ct);
        if (hr.Count == 0) hr = await accounts.ListByRoleAsync(Roles.Admin, ct);
        return [.. hr.Select(a => a.Id)];
    }

    /// <summary>HR + quản lý trực tiếp, bỏ chính nhân viên đó (HR / quản lý không nhận nhắc hợp đồng của chính mình).</summary>
    private static async Task<List<Guid>> RecipientsAsync(List<Guid> hr, EmployeeRef emp, IEmployeeDirectory dir, CancellationToken ct)
    {
        var recipients = hr.ToList();
        if (emp.ManagerId is { } mid && (await dir.GetAsync(mid, ct))?.UserId is { } managerUser) recipients.Add(managerUser);
        recipients.RemoveAll(id => id == emp.UserId);
        return recipients;
    }

    private static string Who(EmployeeRef emp) => $"{emp.Code} · {emp.FullName}{(emp.DepartmentName is { } d ? $" ({d})" : "")}";
}
