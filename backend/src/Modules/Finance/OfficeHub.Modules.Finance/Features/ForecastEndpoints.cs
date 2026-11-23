using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Assets.Contracts;
using OfficeHub.Modules.Finance.Domain;
using OfficeHub.Modules.Finance.Infrastructure;
using OfficeHub.Modules.Organization.Contracts;
using OfficeHub.Modules.Payroll.Contracts;
using OfficeHub.Modules.Sales.Contracts;

namespace OfficeHub.Modules.Finance.Features;

public sealed record ForecastSettingsDto(int PayrollPayDay, int PipelineDelayDays);
/// <param name="MonthlyCost">Tổng chi phí công ty tháng hiện tại (Gross + BH công ty) — chỉ tổng, không theo người.</param>
/// <param name="Estimated">true = kỳ lương tháng này chưa chốt (ước tính đủ công).</param>
public sealed record ForecastPayrollDto(long MonthlyCost, bool Estimated);
public sealed record CashForecastDto(DateOnly Today, DateOnly To, long Opening, ForecastSettingsDto Settings, ForecastPayrollDto Payroll,
    List<ForecastWeek> Weeks, List<ForecastItem> Items, int? FirstNegativeConservative, int? FirstNegativeExpected,
    int UndatedOpportunities, long UndatedValue, long UndatedWeighted);

public sealed record RecurringItemDto(Guid Id, string Name, CategoryKind Kind, long Amount, int DayOfMonth, Guid? BusinessLineId, string? BusinessLineName,
    bool IsActive, string? Note);
public sealed record UpsertRecurringItem(string Name, CategoryKind Kind, long Amount, int DayOfMonth, Guid? BusinessLineId, bool IsActive = true, string? Note = null);

/// <summary>
/// Dự báo dòng tiền 13 tuần (Tổng quan giám đốc 2/3, TEST-221): tính khi đọc, không lưu. Endpoint chỉ gom dữ liệu (quỹ, Sales, Payroll, Assets, đề nghị chi,
/// khoản định kỳ) rồi gọi <see cref="CashForecastRules.Build"/>. Xem: quyền Xem tài chính; sửa cấu hình / khoản định kỳ: Quản trị tài chính.
/// Token AI không có route nào ở đây (không nằm trong allowlist <c>AccessTokenAuth</c>), không có tool MCP.
/// </summary>
internal static class ForecastEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/forecast", ForecastAsync).RequireFinance(FinancePermission.View);
        g.MapPut("/forecast/settings", SetSettingsAsync).RequireFinance(FinancePermission.Admin);
        g.MapGet("/recurring", ListRecurringAsync).RequireFinance(FinancePermission.View);
        g.MapPost("/recurring", CreateRecurringAsync).RequireFinance(FinancePermission.Admin);
        g.MapPut("/recurring/{id:guid}", UpdateRecurringAsync).RequireFinance(FinancePermission.Admin);
    }

    private static async Task<ForecastSettingsDto> SettingsAsync(FinanceDbContext db, CancellationToken ct)
    {
        var s = await db.Settings.AsNoTracking().FirstOrDefaultAsync(ct);
        return new ForecastSettingsDto(s?.PayrollPayDay ?? CashForecastRules.DefaultPayrollPayDay, s?.PipelineDelayDays ?? CashForecastRules.DefaultPipelineDelayDays);
    }

    private static async Task<Ok<CashForecastDto>> ForecastAsync(FinanceDbContext db, FinanceClock clock, ISalesOutlook sales, IPayrollCosts payroll,
        IServiceRenewals renewals, CancellationToken ct)
    {
        var today = clock.Today;
        var settings = await SettingsAsync(db, ct);
        var opening = (await FinanceQueries.AccountsAsync(db, ct)).Where(a => a.IsActive).Sum(a => a.Balance);
        var expenses = await db.Expenses.AsNoTracking().Where(e => e.Status == ExpenseStatus.Approved)
            .Select(e => new { e.Id, e.Number, e.Reason, e.NeededBy, e.Amount }).ToListAsync(ct);
        var recurring = await db.RecurringItems.AsNoTracking().Where(r => r.IsActive).ToListAsync(ct);
        var pay = await payroll.MonthTotalAsync(clock.ThisMonthStart, ct);
        var result = CashForecastRules.Build(new ForecastInput(today, opening, settings.PayrollPayDay, settings.PipelineDelayDays, pay.Cost,
            await sales.OpenInstallmentsAsync(ct), await sales.OpenOpportunitiesAsync(ct), await renewals.ActiveRenewalsAsync(ct),
            [.. expenses.Select(e => new ForecastExpense(e.Id, LedgerRules.ExpenseCode(e.Number), e.Reason, e.NeededBy, e.Amount))], recurring));
        return TypedResults.Ok(new CashForecastDto(result.Today, result.To, result.Opening, settings, new ForecastPayrollDto(pay.Cost, pay.Estimated),
            result.Weeks, result.Items, result.FirstNegativeConservative, result.FirstNegativeExpected,
            result.UndatedOpportunities, result.UndatedValue, result.UndatedWeighted));
    }

    private static async Task<Results<NoContent, ValidationProblem>> SetSettingsAsync(ForecastSettingsDto r, FinanceDbContext db, CancellationToken ct)
    {
        var v = new Validation()
            .When(!CashForecastRules.ValidPayDay(r.PayrollPayDay), "payrollPayDay", $"Ngày trả lương từ 1 đến {CashForecastRules.MaxPayDay}")
            .When(!CashForecastRules.ValidDelay(r.PipelineDelayDays), "pipelineDelayDays", $"Số ngày trễ từ 0 đến {CashForecastRules.MaxPipelineDelayDays}");
        if (v.Failed) return v.Problem();
        var s = await db.Settings.FirstOrDefaultAsync(ct);
        if (s is null) db.Settings.Add(s = new FinanceSettings());
        s.PayrollPayDay = r.PayrollPayDay;
        s.PipelineDelayDays = r.PipelineDelayDays;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    // ---------- Khoản định kỳ dự kiến ----------
    private static async Task<Ok<List<RecurringItemDto>>> ListRecurringAsync(FinanceDbContext db, CancellationToken ct)
    {
        var lines = await db.Lines.AsNoTracking().ToDictionaryAsync(l => l.Id, l => l.Name, ct);
        var rows = await db.RecurringItems.AsNoTracking().OrderByDescending(r => r.IsActive).ThenBy(r => r.Kind).ThenBy(r => r.DayOfMonth).ThenBy(r => r.Name)
            .ToListAsync(ct);
        return TypedResults.Ok(rows.Select(r => new RecurringItemDto(r.Id, r.Name, r.Kind, r.Amount, r.DayOfMonth, r.BusinessLineId,
            r.BusinessLineId is { } id ? lines.GetValueOrDefault(id) : null, r.IsActive, r.Note)).ToList());
    }

    private static async Task<Validation> ValidateRecurringAsync(UpsertRecurringItem r, Guid? selfId, FinanceDbContext db, CancellationToken ct)
    {
        var v = new Validation().Required(r.Name, "name", "Tên khoản").MaxLength(r.Name, 200, "name", "Tên khoản")
            .When(r.Amount < 1, "amount", "Số tiền phải lớn hơn 0")
            .When(r.Amount > LedgerRules.MaxAmount, "amount", "Số tiền quá lớn, kiểm tra lại số 0")
            .When(!CashForecastRules.ValidPayDay(r.DayOfMonth), "dayOfMonth", $"Ngày trong tháng từ 1 đến {CashForecastRules.MaxPayDay}")
            .When(!Enum.IsDefined(r.Kind), "kind", "Chọn Thu hoặc Chi")
            .MaxLength(r.Note, 1000, "note", "Ghi chú");
        if (!string.IsNullOrWhiteSpace(r.Name) && await db.RecurringItems.AnyAsync(x => x.Name == r.Name.Trim() && x.Id != selfId, ct))
            v.Add("name", "Tên khoản đã tồn tại");
        if (r.BusinessLineId is { } lineId && !await db.Lines.AnyAsync(l => l.Id == lineId, ct)) v.Add("businessLineId", "Mảng kinh doanh không tồn tại");
        return v;
    }

    private static async Task<Results<Created<Guid>, ValidationProblem>> CreateRecurringAsync(UpsertRecurringItem r, FinanceDbContext db, FinanceClock clock,
        CancellationToken ct)
    {
        var v = await ValidateRecurringAsync(r, null, db, ct);
        if (v.Failed) return v.Problem();
        var x = new RecurringItem
        {
            Name = r.Name.Trim(), Kind = r.Kind, Amount = r.Amount, DayOfMonth = r.DayOfMonth, BusinessLineId = r.BusinessLineId, IsActive = r.IsActive,
            Note = Clean(r.Note), CreatedAt = clock.Now,
        };
        db.RecurringItems.Add(x);
        await db.SaveChangesAsync(ct);
        return TypedResults.Created($"/api/finance/recurring/{x.Id}", x.Id);
    }

    private static async Task<Results<NoContent, NotFound, ValidationProblem>> UpdateRecurringAsync(Guid id, UpsertRecurringItem r, FinanceDbContext db,
        FinanceClock clock, CancellationToken ct)
    {
        var x = await db.RecurringItems.FindAsync([id], ct);
        if (x is null) return TypedResults.NotFound();
        var v = await ValidateRecurringAsync(r, id, db, ct);
        if (v.Failed) return v.Problem();
        x.Name = r.Name.Trim(); x.Kind = r.Kind; x.Amount = r.Amount; x.DayOfMonth = r.DayOfMonth; x.BusinessLineId = r.BusinessLineId;
        x.IsActive = r.IsActive; x.Note = Clean(r.Note); x.UpdatedAt = clock.Now;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
