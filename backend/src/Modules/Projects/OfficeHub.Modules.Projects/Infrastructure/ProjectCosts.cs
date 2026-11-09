using OfficeHub.BuildingBlocks.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using OfficeHub.Modules.Attendance.Contracts;
using OfficeHub.Modules.Finance.Contracts;
using OfficeHub.Modules.Payroll.Contracts;
using OfficeHub.Modules.Projects.Domain;
using OfficeHub.Modules.Sales.Contracts;

namespace OfficeHub.Modules.Projects.Infrastructure;

/// <summary>Một ô ngày công: người × dự án × tháng.</summary>
internal sealed record EffortRow(Guid ProjectId, Guid EmployeeId, DateOnly Month, decimal PresentDays, decimal Percent, bool Explicit, decimal ManDays);

/// <summary>
/// Ngày công theo chấm công (<see cref="EffortRules"/>) cho một hoặc nhiều dự án — dùng chung cho tab Ngày công, lãi / lỗ dự án và job chốt phân bổ.
/// Tháng chưa chốt: thành viên HIỆN TẠI (+ ai có dòng % đặt tay), % mặc định chia đều theo số dự án đang chạy.
/// Tháng đã chốt (<see cref="AllocationFreeze"/>) với dự án đã có lúc chốt: CHỈ dòng % đã lưu — thêm / bỏ thành viên về sau không đổi số liệu.
/// </summary>
internal sealed class EffortCalculator(ProjectsDbContext db, IAttendanceReports attendance, ProjectClock clock)
{
    /// <summary>Từ tháng bắt đầu đến tháng hiện tại / kết thúc / đóng (tối đa <see cref="EffortRules.MaxMonths"/> tháng gần nhất).</summary>
    public List<DateOnly> MonthsOf(Project p)
    {
        var start = p.StartOn ?? clock.DateOf(p.CreatedAt);
        var end = new[] { clock.Today, p.EndOn ?? DateOnly.MaxValue, p.ClosedOn ?? DateOnly.MaxValue }.Min();
        return end < start ? [] : EffortRules.Months(start, end);
    }

    /// <param name="projects">Phải Include Members.</param>
    /// <param name="ignoreFreeze">true = tính như tháng chưa chốt (job chốt dùng để lấy % mặc định).</param>
    public async Task<List<EffortRow>> ComputeAsync(IReadOnlyList<Project> projects, CancellationToken ct, bool ignoreFreeze = false)
    {
        var monthsBy = projects.ToDictionary(p => p.Id, p => MonthsOf(p).ToHashSet());
        var allMonths = monthsBy.Values.SelectMany(x => x).Distinct().OrderBy(m => m).ToList();
        if (allMonths.Count == 0) return [];
        var projectIds = projects.Select(p => p.Id).ToList();
        var frozen = ignoreFreeze ? [] : await db.Freezes.AsNoTracking().Where(f => allMonths.Contains(f.Month)).ToDictionaryAsync(f => f.Month, f => f.FrozenAt, ct);
        var explicitRows = await db.Allocations.AsNoTracking().Where(a => projectIds.Contains(a.ProjectId) && allMonths.Contains(a.Month)).ToListAsync(ct);
        var explicitBy = explicitRows.ToDictionary(a => (a.ProjectId, a.EmployeeId, a.Month), a => a.Percent);

        // Số dự án đang chạy mà mỗi thành viên tham gia trong tháng (chia đều khi chưa đặt tay).
        var memberIds = projects.SelectMany(p => p.Members.Select(m => m.EmployeeId)).Distinct().ToList();
        var memberships = await db.Members.AsNoTracking().Where(m => memberIds.Contains(m.EmployeeId)).Select(m => new { m.EmployeeId, m.ProjectId }).ToListAsync(ct);
        var spanIds = memberships.Select(m => m.ProjectId).Distinct().ToList();
        var spans = await db.Projects.AsNoTracking().Where(x => spanIds.Contains(x.Id))
            .Select(x => new { x.Id, x.StartOn, x.EndOn, x.ClosedOn, x.CreatedAt }).ToDictionaryAsync(x => x.Id, ct);
        var projectsOf = memberships.ToLookup(m => m.EmployeeId, m => m.ProjectId);

        var rows = new List<EffortRow>();
        foreach (var month in allMonths)
        {
            var people = new Dictionary<Guid, List<Guid>>(); // dự án → người được tính trong tháng
            foreach (var p in projects.Where(p => monthsBy[p.Id].Contains(month)))
            {
                var withRow = explicitRows.Where(a => a.ProjectId == p.Id && a.Month == month).Select(a => a.EmployeeId);
                // Dự án tạo SAU lúc chốt (ngày bắt đầu lùi về tháng đã chốt) → chưa có dòng chốt → tính như tháng chưa chốt.
                var isFrozen = frozen.TryGetValue(month, out var frozenAt) && p.CreatedAt <= frozenAt;
                people[p.Id] = isFrozen ? withRow.ToList() : p.Members.Select(m => m.EmployeeId).Concat(withRow).Distinct().ToList();
            }
            var everyone = people.Values.SelectMany(x => x).Distinct().ToList();
            if (everyone.Count == 0) continue;
            var sheets = await attendance.MonthAsync(everyone, month, ct);
            foreach (var (pid, ids) in people)
                foreach (var eid in ids)
                {
                    var present = sheets.TryGetValue(eid, out var s) ? s.Totals.PresentDays : 0;
                    var has = explicitBy.TryGetValue((pid, eid, month), out var pct);
                    if (!has)
                    {
                        var active = projectsOf[eid].Count(x => spans.TryGetValue(x, out var sp)
                            && EffortRules.ActiveIn(month, sp.StartOn ?? clock.DateOf(sp.CreatedAt), sp.EndOn, sp.ClosedOn));
                        pct = EffortRules.DefaultPercent(active);
                    }
                    rows.Add(new EffortRow(pid, eid, month, present, pct, has, EffortRules.ManDays(present, pct)));
                }
        }
        return rows;
    }
}

public sealed record ContractMoneyDto(Guid Id, string Code, string Title, string CustomerName, string Status, long ValueBeforeTax, int VatRate, long TotalValue,
    long Collected, long Outstanding);
public sealed record MonthMoneyDto(DateOnly Month, decimal ManDays, long Labor, bool LaborEstimated, long DirectExpense, long OtherIncome, long Collected);
public sealed record CategoryMoneyDto(string Name, bool IsIncome, long Amount);
public sealed record PersonMoneyDto(Guid EmployeeId, string FullName, decimal ManDays, long Labor);
/// <param name="People">Chi tiết theo người — chỉ quyền Quản trị tài chính (suy ra được lương); người khác null.</param>
public sealed record ProjectFinancialsDto(Guid ProjectId, string Code, string Name, ProjectStatus Status, ProjectKind Kind, long Revenue, long Vat, long OtherIncome, long Labor,
    long DirectExpense, long Profit, decimal? MarginPercent, long Collected, long Outstanding, decimal ManDays, decimal? BudgetManDays, bool HasEstimate,
    List<ContractMoneyDto> Contracts, List<MonthMoneyDto> Months, List<CategoryMoneyDto> Categories, List<PersonMoneyDto>? People);

/// <summary>
/// Lãi / lỗ dự án (<see cref="ProjectCostRules"/>): hợp đồng bán (Sales) + thu / chi gắn dự án (Finance) + nhân công = ngày công × chi phí lương (Payroll).
/// Tính khi đọc, không lưu số tiền. CHỈ gọi sau khi đã kiểm tra quyền Xem tài chính.
/// </summary>
internal sealed class ProjectFinance(ProjectsDbContext db, EffortCalculator effort, IPayrollCosts payroll, ISalesRevenueLookup revenue, IFinanceLedger ledger, ProjectAccess access)
{
    /// <param name="projects">Phải Include Members.</param>
    public async Task<List<ProjectFinancialsDto>> ComputeAsync(IReadOnlyList<Project> projects, bool withPeople, CancellationToken ct)
    {
        var ids = projects.Select(p => p.Id).ToList();
        var effortRows = await effort.ComputeAsync(projects, ct);

        // Chi phí lương theo tháng — mỗi tháng gọi Payroll một lần cho mọi người có ngày công.
        var costs = new Dictionary<(Guid, DateOnly), EmployeeMonthCost>();
        foreach (var g in effortRows.Where(r => r.ManDays > 0).GroupBy(r => r.Month))
            foreach (var (eid, c) in await payroll.MonthCostsAsync(g.Key, g.Select(r => r.EmployeeId).Distinct().ToList(), ct))
                costs[(eid, g.Key)] = c;
        var labor = effortRows.Select(r =>
        {
            var c = costs.GetValueOrDefault((r.EmployeeId, r.Month));
            return (Row: r, Cost: c is null ? 0 : ProjectCostRules.LaborCost(c.Cost, r.PresentDays, r.Percent), Estimated: c?.Estimated == true && r.ManDays > 0);
        }).ToList();

        var links = await db.ProjectContracts.AsNoTracking().Where(x => ids.Contains(x.ProjectId)).ToListAsync(ct);
        var contracts = (await revenue.ContractRevenueAsync(links.Select(l => l.ContractId).ToList(), ct)).ToDictionary(c => c.ContractId);
        var ledgerRows = await ledger.ProjectTotalsAsync(ids, ct);
        var names = withPeople ? await access.EmployeesAsync(ct) : null;

        return projects.Select(p =>
        {
            var mine = links.Where(l => l.ProjectId == p.Id).Select(l => contracts.GetValueOrDefault(l.ContractId)).OfType<ContractRevenue>().ToList();
            long rev = 0, vat = 0;
            foreach (var c in mine) { var (r, v) = ProjectCostRules.ContractRevenue(c.Status, c.ValueBeforeTax, c.TotalValue, c.Collected); rev += r; vat += v; }
            var cash = ledgerRows.Where(r => r.ProjectId == p.Id).ToList();
            var pl = labor.Where(x => x.Row.ProjectId == p.Id).ToList();
            var collections = mine.SelectMany(c => c.Collections).ToList();
            var otherIncome = cash.Where(r => r.IsIncome).Sum(r => r.Amount);
            var direct = cash.Where(r => !r.IsIncome).Sum(r => r.Amount);
            var laborSum = pl.Sum(x => x.Cost);
            var profit = ProjectCostRules.Profit(rev, vat, otherIncome, laborSum, direct);

            var months = pl.Select(x => x.Row.Month).Concat(cash.Select(r => r.Month))
                .Concat(collections.Select(c => EffortRules.MonthStart(c.Date))).Distinct().OrderBy(m => m)
                .Select(m => new MonthMoneyDto(m, pl.Where(x => x.Row.Month == m).Sum(x => x.Row.ManDays), pl.Where(x => x.Row.Month == m).Sum(x => x.Cost),
                    pl.Any(x => x.Row.Month == m && x.Estimated), cash.Where(r => r.Month == m && !r.IsIncome).Sum(r => r.Amount),
                    cash.Where(r => r.Month == m && r.IsIncome).Sum(r => r.Amount), collections.Where(c => EffortRules.MonthStart(c.Date) == m).Sum(c => c.Amount)))
                .ToList();
            var categories = cash.GroupBy(r => (r.CategoryName ?? (r.IsIncome ? "Thu khác" : "Chi khác"), r.IsIncome))
                .Select(g => new CategoryMoneyDto(g.Key.Item1, g.Key.IsIncome, g.Sum(r => r.Amount))).OrderByDescending(c => c.Amount).ToList();
            var people = names is null ? null : pl.GroupBy(x => x.Row.EmployeeId)
                .Select(g => new PersonMoneyDto(g.Key, names.TryGetValue(g.Key, out var e) ? e.FullName : "(không rõ)", g.Sum(x => x.Row.ManDays), g.Sum(x => x.Cost)))
                .Where(x => x.ManDays > 0 || x.Labor > 0).OrderByDescending(x => x.Labor).ToList();

            return new ProjectFinancialsDto(p.Id, p.Code, p.Name, p.Status, p.Kind, rev, vat, otherIncome, laborSum, direct, profit,
                ProjectCostRules.MarginPercent(profit, rev, otherIncome), mine.Sum(c => c.Collected), mine.Sum(c => ProjectCostRules.Outstanding(c.Status, c.TotalValue, c.Collected)),
                pl.Sum(x => x.Row.ManDays), p.BudgetManDays, pl.Any(x => x.Estimated),
                mine.Select(c => new ContractMoneyDto(c.ContractId, c.Code, c.Title, c.CustomerName, c.Status, c.ValueBeforeTax, c.VatRate, c.TotalValue, c.Collected,
                    ProjectCostRules.Outstanding(c.Status, c.TotalValue, c.Collected))).ToList(),
                months, categories, people);
        }).ToList();
    }
}

/// <summary>
/// Mỗi giờ (sau 70 s): chốt phân bổ của tháng trước nếu chưa chốt — ghi % mặc định (chia đều) thành dòng <see cref="Allocation"/> cho mọi thành viên
/// của dự án chạy trong tháng đó, rồi đánh dấu <see cref="AllocationFreeze"/>. Một lần mỗi tháng.
/// </summary>
internal sealed class AllocationFreezeJob(IServiceScopeFactory scopes, ILogger<AllocationFreezeJob> log, JobMonitor monitor) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        var job = monitor.Register("projects.allocation-freeze", "Dự án: chốt phân bổ đầu tháng", TimeSpan.FromHours(1));
        await Task.Delay(TimeSpan.FromSeconds(70), stop);
        using var timer = new PeriodicTimer(TimeSpan.FromHours(1));
        do
        {
            try { await job.RunAsync(() => RunOnceAsync(stop)); }
            catch (Exception ex) when (!stop.IsCancellationRequested) { log.LogError(ex, "Lỗi khi chốt phân bổ dự án"); }
        } while (await timer.WaitForNextTickAsync(stop));
    }

    internal async Task<int> RunOnceAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ProjectsDbContext>();
        var clock = scope.ServiceProvider.GetRequiredService<ProjectClock>();
        var month = EffortRules.MonthToFreeze(clock.Today);
        if (await db.Freezes.AnyAsync(f => f.Month == month, ct)) return 0;
        var calc = scope.ServiceProvider.GetRequiredService<EffortCalculator>();
        var projects = (await db.Projects.AsNoTracking().Include(p => p.Members).ToListAsync(ct)).Where(p => calc.MonthsOf(p).Contains(month)).ToList();
        var rows = (await calc.ComputeAsync(projects, ct, ignoreFreeze: true)).Where(r => r.Month == month && !r.Explicit).ToList();
        foreach (var r in rows) db.Allocations.Add(new Allocation { ProjectId = r.ProjectId, EmployeeId = r.EmployeeId, Month = month, Percent = r.Percent });
        db.Freezes.Add(new AllocationFreeze { Month = month, FrozenAt = clock.Now });
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException) { return 0; } // hai instance cùng chốt — bản kia đã ghi
        log.LogInformation("Đã chốt phân bổ dự án tháng {Month:yyyy-MM}: {Count} dòng mặc định", month, rows.Count);
        return rows.Count;
    }
}
