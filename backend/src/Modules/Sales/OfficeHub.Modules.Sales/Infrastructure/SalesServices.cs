using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.Modules.Finance.Contracts;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Organization.Contracts;
using OfficeHub.Modules.Sales.Domain;

namespace OfficeHub.Modules.Sales.Infrastructure;

internal sealed class SalesClock(TimeProvider clock, IOptions<OfficeSettings> office)
{
    private readonly TimeZoneInfo _tz = TimeZoneInfo.FindSystemTimeZoneById(office.Value.TimeZone);
    public DateTimeOffset Now => clock.GetUtcNow();
    public DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), _tz).DateTime);
}

/// <param name="Employee">null = tài khoản không có hồ sơ / đã nghỉ (chỉ thấy gì nếu có quyền Xem tài chính — thực tế không có).</param>
/// <param name="Owners">Người phụ trách mà người này được thấy: bản thân + cấp dưới (trực tiếp / gián tiếp). Bỏ qua khi <see cref="SeeAll"/>.</param>
internal sealed record SalesViewer(Guid UserId, string Name, EmployeeRef? Employee, FinancePermission Finance, IReadOnlySet<Guid> Owners)
{
    /// <summary>Người có quyền Xem tài chính (giám đốc, kế toán) thấy mọi khách / hợp đồng / công nợ.</summary>
    public bool SeeAll => Finance.Has(FinancePermission.View);
    public bool CanSee(Guid ownerEmployeeId) => SeeAll || Owners.Contains(ownerEmployeeId);
    /// <summary>Sửa: người phụ trách, quản lý (trực tiếp / gián tiếp) của họ, hoặc Quản trị tài chính.</summary>
    public bool CanEdit(Guid ownerEmployeeId) => Owners.Contains(ownerEmployeeId) || Finance.Has(FinancePermission.Admin);
    public bool CanCollect => Finance.Has(FinancePermission.Record);
}

/// <summary>Phân quyền module Sales — MỌI kiểm tra đi qua đây. Không theo vai trò admin / hr (chủ dự án: tiền chỉ giám đốc + kế toán + người phụ trách).</summary>
internal sealed class SalesAccess(IEmployeeDirectory dir, IFinanceAccess finance)
{
    private SalesViewer? _viewer;
    private IReadOnlyDictionary<Guid, EmployeeRef>? _employees;

    public async Task<SalesViewer> ViewerAsync(ClaimsPrincipal user, CancellationToken ct)
    {
        if (_viewer is not null) return _viewer;
        var uid = user.GetUserId()!.Value;
        var emp = await dir.GetByUserIdAsync(uid, ct);
        if (emp is { IsActive: false }) emp = null;
        var owners = new HashSet<Guid>();
        if (emp is not null)
        {
            owners.Add(emp.Id);
            owners.UnionWith(await dir.GetSubordinateIdsAsync(emp.Id, ct));
        }
        return _viewer = new SalesViewer(uid, user.FindFirstValue(ClaimNames.FullName) ?? user.Identity?.Name ?? "?", emp, await finance.GetAsync(uid, ct), owners);
    }

    /// <summary>Mọi nhân viên (cả đã nghỉ) theo Id — gắn tên người phụ trách.</summary>
    public async Task<IReadOnlyDictionary<Guid, EmployeeRef>> EmployeesAsync(CancellationToken ct) =>
        _employees ??= (await dir.ListEmployedAsync(new DateOnly(2000, 1, 1), new DateOnly(2200, 1, 1), ct)).DistinctBy(e => e.Id).ToDictionary(e => e.Id);

    public async Task<string> NameOfAsync(Guid employeeId, CancellationToken ct) =>
        (await EmployeesAsync(ct)).TryGetValue(employeeId, out var e) ? e.FullName : "(không rõ)";
}

/// <summary>Số đã thu của đợt = tổng các lần thu mà dòng sổ Finance còn hiệu lực (kế toán huỷ dòng sổ → tự trừ, không cần sự kiện).</summary>
internal sealed class CollectedCalculator(IFinanceLedger ledger)
{
    public const string SourceType = "sales_collection";

    public async Task<Dictionary<Guid, long>> ByInstallmentAsync(IReadOnlyCollection<Installment> items, CancellationToken ct)
    {
        var cols = items.SelectMany(i => i.Collections).ToList();
        var active = await ledger.ActiveSourcesAsync(SourceType, cols.Select(c => c.Id).ToList(), ct);
        return items.ToDictionary(i => i.Id, i => i.Collections.Where(c => active.ContainsKey(c.Id)).Sum(c => c.Amount));
    }

    public async Task<HashSet<Guid>> ActiveCollectionIdsAsync(IReadOnlyCollection<Collection> cols, CancellationToken ct) =>
        [.. (await ledger.ActiveSourcesAsync(SourceType, cols.Select(c => c.Id).ToList(), ct)).Keys];
}

/// <summary>
/// Mỗi giờ (host Api, một instance): nhắc đợt thu sắp đến hạn (≤ 7 ngày, một lần) / đến hạn hôm nay (một lần) / quá hạn (mỗi thứ Hai)
/// → người phụ trách hợp đồng + người có quyền Ghi sổ; nhắc việc chăm sóc khách đến hẹn hôm nay → người tạo.
/// </summary>
internal sealed class SalesReminderJob(IServiceScopeFactory scopes, ILogger<SalesReminderJob> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        await Task.Delay(TimeSpan.FromSeconds(40), stop);
        using var timer = new PeriodicTimer(TimeSpan.FromHours(1));
        do
        {
            try { await RunOnceAsync(stop); }
            catch (Exception ex) when (!stop.IsCancellationRequested) { log.LogError(ex, "Lỗi khi chạy nhắc công nợ / chăm sóc khách"); }
        } while (await timer.WaitForNextTickAsync(stop));
    }

    internal async Task RunOnceAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var sp = scope.ServiceProvider;
        var db = sp.GetRequiredService<SalesDbContext>();
        var clock = sp.GetRequiredService<SalesClock>();
        var dir = sp.GetRequiredService<IEmployeeDirectory>();
        var finance = sp.GetRequiredService<IFinanceAccess>();
        var notifier = sp.GetRequiredService<INotifier>();
        var calc = sp.GetRequiredService<CollectedCalculator>();
        var today = clock.Today;
        var horizon = today.AddDays(SalesRules.DueSoonDays);

        var items = await db.Installments.Include(i => i.Collections)
            .Where(i => !i.Cancelled && i.DueOn <= horizon && db.Contracts.Any(c => c.Id == i.ContractId && c.Status == ContractStatus.Active)).ToListAsync(ct);
        if (items.Count > 0)
        {
            var collected = await calc.ByInstallmentAsync(items, ct);
            var contracts = await db.Contracts.AsNoTracking().Where(c => items.Select(i => i.ContractId).Contains(c.Id)).ToDictionaryAsync(c => c.Id, ct);
            var customers = await db.Customers.AsNoTracking().Where(c => contracts.Values.Select(x => x.CustomerId).Contains(c.Id)).ToDictionaryAsync(c => c.Id, c => c.Name, ct);
            var recorders = await finance.ListUserIdsAsync(FinancePermission.Record, ct);
            foreach (var i in items)
            {
                var got = collected[i.Id];
                var state = SalesRules.InstallmentStatus(false, i.Amount, got, i.DueOn, today);
                var r = SalesRules.ReminderFor(state, i.DueOn, today, i.RemindedSoonAt != null, i.RemindedDueAt != null, i.LastOverdueRemindOn);
                if (r == SalesRules.Reminder.None) continue;
                var c = contracts[i.ContractId];
                var owner = (await dir.GetAsync(c.OwnerEmployeeId, ct))?.UserId;
                var to = recorders.Concat(owner is { } o ? [o] : []).Distinct().ToList();
                var left = i.Amount - got;
                var what = $"{customers.GetValueOrDefault(c.CustomerId, "?")} · HĐ {c.Code} · {i.Title}";
                var title = r switch
                {
                    SalesRules.Reminder.DueSoon => $"Sắp đến hạn thu ({i.DueOn:dd/MM}): {left:N0} đ",
                    SalesRules.Reminder.DueToday => $"Đến hạn thu hôm nay: {left:N0} đ",
                    _ => $"Quá hạn thu {today.DayNumber - i.DueOn.DayNumber} ngày: {left:N0} đ",
                };
                await notifier.NotifyAsync(new NotificationRequest(to, NotificationCategories.ReceivableDue, title, what, "/sales?tab=receivables",
                    SendEmail: r != SalesRules.Reminder.DueSoon), ct);
                var now = clock.Now;
                if (r == SalesRules.Reminder.DueSoon) i.RemindedSoonAt = now;
                if (r == SalesRules.Reminder.DueToday) { i.RemindedDueAt = now; i.RemindedSoonAt ??= now; }
                if (r == SalesRules.Reminder.Overdue) { i.LastOverdueRemindOn = today; i.RemindedSoonAt ??= now; i.RemindedDueAt ??= now; }
            }
            await db.SaveChangesAsync(ct);
        }

        // Việc chăm sóc khách đến hẹn hôm nay (hoặc đã quá mà chưa nhắc).
        var follow = await db.Activities.Where(a => a.NextActionOn != null && a.NextActionOn <= today && a.NextActionRemindedAt == null).OrderBy(a => a.NextActionOn).ThenBy(a => a.Id).Take(500).ToListAsync(ct);
        var custNames = await db.Customers.AsNoTracking().Where(c => follow.Select(f => f.CustomerId).Contains(c.Id)).ToDictionaryAsync(c => c.Id, c => c.Name, ct);
        foreach (var a in follow)
        {
            var uid = (await dir.GetAsync(a.CreatedByEmployeeId, ct))?.UserId;
            var cust = custNames.GetValueOrDefault(a.CustomerId, "?");
            if (uid is { } u)
                await notifier.NotifyAsync(new NotificationRequest([u], NotificationCategories.CustomerFollowUp, $"Việc cần làm với {cust}: {a.NextAction}",
                    $"Hẹn ngày {a.NextActionOn:dd/MM/yyyy}.", $"/sales?customer={a.CustomerId}", SendEmail: false), ct);
            a.NextActionRemindedAt = clock.Now;
        }
        if (follow.Count > 0) await db.SaveChangesAsync(ct);
    }
}
