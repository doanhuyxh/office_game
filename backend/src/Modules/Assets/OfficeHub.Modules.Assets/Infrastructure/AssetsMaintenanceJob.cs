using OfficeHub.BuildingBlocks.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.Modules.Assets.Domain;
using OfficeHub.Modules.Assets.Features;
using OfficeHub.Modules.Identity.Contracts;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Assets.Infrastructure;

/// <summary>
/// Mỗi giờ (host Api, giả định một instance): (1) nhắc HR + người quản trị dịch vụ khi thiết bị sắp hết bảo hành / dịch vụ sắp gia hạn (30 / 7 ngày);
/// (2) báo HR + quản lý cũ khi nhân viên đã nghỉ mà còn giữ thiết bị / tài khoản (một lần mỗi người);
/// (3) nhắc người rà soát một lần khi đợt rà soát tới hạn mà còn mục chưa quyết;
/// (4) nhắc nhân viên một lần khi biên bản giao nhận chưa xác nhận sau 3 ngày.
/// </summary>
internal sealed class AssetsMaintenanceJob(IServiceScopeFactory scopes, ILogger<AssetsMaintenanceJob> log, JobMonitor monitor) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        var job = monitor.Register("assets.maintenance", "Tài sản: nhắc hạn, nghỉ việc, rà soát, biên bản", TimeSpan.FromHours(1));
        await Task.Delay(TimeSpan.FromSeconds(30), stop);
        using var timer = new PeriodicTimer(TimeSpan.FromHours(1));
        do
        {
            try { await job.RunAsync(() => RunOnceAsync(stop)); }
            catch (Exception ex) when (!stop.IsCancellationRequested) { log.LogError(ex, "Lỗi khi bảo trì module tài sản"); }
        } while (await timer.WaitForNextTickAsync(stop));
    }

    internal async Task RunOnceAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var sp = scope.ServiceProvider;
        var db = sp.GetRequiredService<AssetsDbContext>();
        var clock = sp.GetRequiredService<AssetClock>();
        var ops = sp.GetRequiredService<AssetOps>();
        var access = sp.GetRequiredService<AssetAccess>();
        var accounts = sp.GetRequiredService<IAccountService>();
        var emps = await access.EmployeesAsync(ct);
        var today = clock.Today;

        var hr = await accounts.ListByRoleAsync(Roles.Hr, ct);
        if (hr.Count == 0) hr = await accounts.ListByRoleAsync(Roles.Admin, ct);
        var hrIds = hr.Select(a => a.Id).ToList();

        // (1a) Bảo hành
        var horizon = today.AddDays(AssetRules.ReminderDays);
        var devices = await db.Devices.Where(d => d.Status != DeviceStatus.Retired && d.Status != DeviceStatus.Lost && d.WarrantyUntil != null
                                                  && d.WarrantyUntil <= horizon && d.WarrantyUntil >= today).ToListAsync(ct);
        foreach (var d in devices)
        {
            var due = AssetRules.DueReminder(d.WarrantyUntil, today, d.WarrantyReminded30At != null, d.WarrantyReminded7At != null);
            if (due == 0) continue;
            var left = d.WarrantyUntil!.Value.DayNumber - today.DayNumber;
            await ops.NotifyUsersAsync(hrIds, NotificationCategories.AssetExpiring, $"Thiết bị {d.Code} còn {left} ngày hết bảo hành",
                $"{d.Name}. Hết bảo hành: {d.WarrantyUntil:dd/MM/yyyy}.");
            var now = clock.Now;
            d.WarrantyReminded30At ??= now;
            if (due == AssetRules.UrgentReminderDays) d.WarrantyReminded7At = now;
        }

        // (1b) Gia hạn dịch vụ
        var services = await db.Services.Where(s => s.Status == ServiceStatus.Active && s.RenewalDate != null && s.RenewalDate <= horizon && s.RenewalDate >= today)
            .ToListAsync(ct);
        foreach (var s in services)
        {
            var due = AssetRules.DueReminder(s.RenewalDate, today, s.RenewalReminded30At != null, s.RenewalReminded7At != null);
            if (due == 0) continue;
            var to = hrIds.ToList();
            if (s.AdminEmployeeId is { } a && emps.GetValueOrDefault(a) is { IsActive: true, UserId: { } au }) to.Add(au);
            var left = s.RenewalDate!.Value.DayNumber - today.DayNumber;
            await ops.NotifyUsersAsync(to, NotificationCategories.AssetExpiring, $"Dịch vụ {s.Name} còn {left} ngày tới hạn gia hạn",
                $"Ngày gia hạn: {s.RenewalDate:dd/MM/yyyy}. Xem xét gia hạn hoặc huỷ tại Tài sản → Dịch vụ.");
            var now = clock.Now;
            s.RenewalReminded30At ??= now;
            if (due == AssetRules.UrgentReminderDays) s.RenewalReminded7At = now;
        }
        if (devices.Count + services.Count > 0) await db.SaveChangesAsync(ct);

        // (2) Nhân viên nghỉ việc còn giữ tài sản
        var notified = (await db.OffboardingNotices.AsNoTracking().Select(n => n.EmployeeId).ToListAsync(ct)).ToHashSet();
        foreach (var r in (await HoldingEndpoints.ResignedHoldingAsync(db, emps, ct)).Where(r => !notified.Contains(r.EmployeeId)))
        {
            var to = hrIds.ToList();
            var e = emps[r.EmployeeId];
            if (e.ManagerId is { } m && emps.GetValueOrDefault(m) is { IsActive: true, UserId: { } mu }) to.Add(mu);
            await ops.NotifyUsersAsync(to, NotificationCategories.AssetOffboarding, $"{e.FullName} đã nghỉ việc nhưng còn giữ tài sản",
                $"{e.Code} · {e.FullName}: {r.Devices} thiết bị, {r.Seats} tài khoản dịch vụ cần thu hồi (Tài sản → Tổng quan).");
            db.OffboardingNotices.Add(new OffboardingNotice { EmployeeId = r.EmployeeId, NotifiedAt = clock.Now });
            await db.SaveChangesAsync(ct);
        }

        // (3) Nhắc rà soát tới hạn
        var reviews = await db.Reviews.Include(r => r.Items).Where(r => r.Status == ReviewStatus.Open && r.RemindedAt == null && r.DueDate <= today).ToListAsync(ct);
        foreach (var r in reviews)
        {
            foreach (var grp in r.Items.Where(i => i.Decision == ReviewDecision.Pending && i.ReviewerEmployeeId != null).GroupBy(i => i.ReviewerEmployeeId!.Value))
                await ops.NotifyEmployeeAsync(grp.Key, NotificationCategories.AssetReview, $"Đến hạn rà soát: còn {grp.Count()} tài khoản chưa quyết",
                    $"{r.Title}. Hạn: {r.DueDate:dd/MM/yyyy}.", email: true);
            var hrPending = r.Items.Count(i => i.Decision == ReviewDecision.Pending && i.ReviewerEmployeeId == null);
            if (hrPending > 0)
                await ops.NotifyUsersAsync(hrIds, NotificationCategories.AssetReview, $"Đến hạn rà soát: còn {hrPending} tài khoản HR chưa quyết", $"{r.Title}.");
            r.RemindedAt = clock.Now;
        }
        if (reviews.Count > 0) await db.SaveChangesAsync(ct);

        // (4) Biên bản giao nhận chưa xác nhận
        var cutoff = clock.Now.AddDays(-AssetRules.HandoverRemindAfterDays);
        var handovers = await db.Handovers.Where(h => h.RequiresConfirmation && h.ConfirmedAt == null && h.RemindedAt == null && h.CreatedAt <= cutoff)
            .ToListAsync(ct);
        foreach (var h in handovers.Where(h => AssetRules.HandoverReminderDue(h.RequiresConfirmation, h.ConfirmedAt, h.RemindedAt, h.CreatedAt, clock.Now)))
        {
            if (emps.GetValueOrDefault(h.EmployeeId) is { IsActive: true })
                await ops.NotifyEmployeeAsync(h.EmployeeId, NotificationCategories.AssetAssigned, $"Nhắc xác nhận biên bản {h.Number}",
                    $"Biên bản {(h.Kind == HandoverKind.Assign ? "bàn giao" : "thu hồi")} thiết bị {h.DeviceCode} · {h.DeviceName} chưa được xác nhận. "
                    + "Vào Tài sản → Của tôi để xác nhận.", email: true);
            h.RemindedAt = clock.Now;
        }
        if (handovers.Count > 0) await db.SaveChangesAsync(ct);
    }
}
