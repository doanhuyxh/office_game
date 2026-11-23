using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Finance.Domain;
using OfficeHub.Modules.Finance.Infrastructure;
using OfficeHub.Modules.Organization.Contracts;
using OfficeHub.Modules.Sales.Contracts;

namespace OfficeHub.Modules.Finance.Features;

public sealed record DashboardMonth(DateOnly Month, long Income, long Expense, long Profit, List<LineSummary> ByLine);
public sealed record DashboardTotals(long Income, long Expense, long Profit, List<LineSummary> ByLine);
/// <param name="From">Ngày đầu tháng đầu tiên (giờ VN).</param>
/// <param name="Today">Hôm nay (giờ VN) — tháng cuối tính đến hôm nay.</param>
/// <param name="Monthly">Đủ <c>months</c> dòng, cũ → mới, tháng không có giao dịch = 0.</param>
public sealed record FinanceDashboardDto(DateOnly From, DateOnly Today, int Months, List<DashboardMonth> Monthly, DashboardTotals Totals,
    ReceivablesOutlook Receivables, PipelineOutlook Pipeline);

/// <summary>
/// Tổng quan giám đốc 1/3 (TEST-220): thu / chi / lãi nhiều tháng theo mảng (tiền thực thu / thực chi của sổ, không tính chuyển quỹ, bỏ dòng đã huỷ)
/// + công nợ quá hạn + pipeline có trọng số (module Sales qua <see cref="ISalesOutlook"/>). Tính khi đọc, không lưu. Chỉ quyền Xem tài chính;
/// token AI không có route này (không nằm trong allowlist <c>AccessTokenAuth</c>). <c>/overview</c> giữ nguyên cho tool MCP.
/// </summary>
internal static class DashboardEndpoints
{
    public static void Map(RouteGroupBuilder g) => g.MapGet("/dashboard", DashboardAsync).RequireFinance(FinancePermission.View);

    private static async Task<Results<Ok<FinanceDashboardDto>, ValidationProblem>> DashboardAsync(FinanceDbContext db, FinanceClock clock, ISalesOutlook sales,
        int? months, CancellationToken ct)
    {
        var n = months ?? DashboardRules.DefaultMonths;
        if (!DashboardRules.ValidMonths(n)) return new Validation().Add("months", $"Số tháng từ 1 đến {DashboardRules.MaxMonths}").Problem();
        var from = DashboardRules.FirstMonth(clock.ThisMonthStart, n);
        var rows = await db.Entries.AsNoTracking().Where(e => e.Status == TxStatus.Active && e.Kind != TxKind.Transfer && e.Date >= from)
            .GroupBy(e => new { e.Date, e.Kind, e.BusinessLineId }).Select(g => new { g.Key.Date, g.Key.Kind, g.Key.BusinessLineId, Sum = g.Sum(e => e.Amount) })
            .ToListAsync(ct);
        var monthly = DashboardRules.Monthly(clock.ThisMonthStart, n, rows.Select(r => (r.Date, r.Kind, r.BusinessLineId, r.Sum)));
        var names = await db.Lines.AsNoTracking().ToDictionaryAsync(l => l.Id, l => l.Name, ct);
        List<LineSummary> Named(IEnumerable<DashboardRules.LineSum> lines) => [.. lines.Select(l => new LineSummary(l.BusinessLineId,
            l.BusinessLineId is { } id && names.TryGetValue(id, out var name) ? name : "Chưa gắn mảng", l.Income, l.Expense))];
        var income = monthly.Sum(m => m.Income);
        var expense = monthly.Sum(m => m.Expense);
        return TypedResults.Ok(new FinanceDashboardDto(from, clock.Today, n,
            [.. monthly.Select(m => new DashboardMonth(m.Month, m.Income, m.Expense, m.Profit, Named(m.ByLine)))],
            new DashboardTotals(income, expense, income - expense, Named(DashboardRules.TotalByLine(monthly))),
            await sales.ReceivablesAsync(ct), await sales.PipelineAsync(ct)));
    }
}
