using System.Text.Json.Serialization;
using OfficeHub.Modules.Assets.Contracts;
using OfficeHub.Modules.Sales.Contracts;

namespace OfficeHub.Modules.Finance.Domain;

/// <summary>Dòng của dự báo. Vào: Installment, Overdue, Pipeline, RecurringIncome. Ra: Payroll, Renewal, Expense, RecurringExpense.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<ForecastLine>))]
public enum ForecastLine { Installment, Overdue, Pipeline, RecurringIncome, Payroll, Renewal, Expense, RecurringExpense }

/// <summary>Đề nghị chi đã duyệt, chưa chi.</summary>
public sealed record ForecastExpense(Guid Id, string Code, string Reason, DateOnly? NeededBy, long Amount);

/// <summary>Dữ liệu thô đã gom (endpoint <c>/finance/forecast</c>); mọi quy tắc nằm ở <see cref="CashForecastRules.Build"/>.</summary>
public sealed record ForecastInput(
    DateOnly Today,
    long Opening,
    int PayrollPayDay,
    int PipelineDelayDays,
    long PayrollMonthlyCost,
    IReadOnlyList<OpenInstallment> Installments,
    IReadOnlyList<OpenOpportunity> Opportunities,
    IReadOnlyList<ServiceRenewal> Renewals,
    IReadOnlyList<ForecastExpense> Expenses,
    IReadOnlyList<RecurringItem> Recurring);

/// <summary>Một khoản tạo nên một ô (tuần × dòng). Tiền luôn dương; dòng quyết định vào / ra.</summary>
/// <param name="Date">Ngày gốc của khoản (hạn thu, ngày tiền về của cơ hội, ngày gia hạn, ngày cần chi…); null = đề nghị chi không có ngày cần.</param>
/// <param name="Late">Ngày gốc đã qua nên dồn vào tuần 1 (đợt quá hạn, quá ngày gia hạn, cơ hội tiền về đã qua, đề nghị chi quá ngày cần).</param>
/// <param name="RefId">Id để mở chi tiết: hợp đồng (đợt thu), cơ hội, dịch vụ, đề nghị chi, khoản định kỳ; lương = null.</param>
/// <param name="RefCode">Mã hiển thị: mã hợp đồng / mã đề nghị chi.</param>
public sealed record ForecastItem(int Week, ForecastLine Line, DateOnly? Date, long Amount, string Name, Guid? RefId, string? RefCode, Guid? CustomerId, bool Late);

/// <summary>
/// Một tuần. Số dư cuối tuần: <see cref="ClosingConservative"/> (Thận trọng = đợt thu chưa quá hạn + định kỳ thu − mọi khoản chi),
/// <see cref="ClosingExpected"/> (Kỳ vọng = Thận trọng + công nợ quá hạn + cơ hội × xác suất).
/// </summary>
public sealed record ForecastWeek(int Week, DateOnly From, DateOnly To,
    long Installments, long Overdue, long Pipeline, long RecurringIncome,
    long Payroll, long Renewals, long Expenses, long RecurringExpense,
    long InConservative, long InExpected, long Out, long ClosingConservative, long ClosingExpected);

/// <param name="FirstNegativeConservative">Tuần (1–13) đầu tiên số dư Thận trọng âm; null = không âm.</param>
/// <param name="UndatedOpportunities">Cơ hội đang mở chưa có ngày dự kiến chốt — KHÔNG vào dự báo, chỉ báo số lượng + tổng.</param>
public sealed record CashForecast(DateOnly Today, DateOnly To, long Opening, List<ForecastWeek> Weeks, List<ForecastItem> Items,
    int? FirstNegativeConservative, int? FirstNegativeExpected, int UndatedOpportunities, long UndatedValue, long UndatedWeighted);

/// <summary>
/// Dự báo dòng tiền 13 tuần (TEST-221) — hàm thuần, test ở <c>Finance.Tests/CashForecastRulesTests</c>.
/// Tuần 1 = hôm nay (giờ VN) → Chủ nhật; tuần 2–13 Thứ Hai → Chủ nhật. Khoản có ngày gốc ngoài cửa sổ (sau ngày cuối) không tính.
/// </summary>
public static class CashForecastRules
{
    public const int Weeks = 13;
    public const int DefaultPayrollPayDay = 10;
    public const int DefaultPipelineDelayDays = 30;
    public const int MaxPayDay = 28;
    public const int MaxPipelineDelayDays = 180;

    public static bool ValidPayDay(int day) => day is >= 1 and <= MaxPayDay;
    public static bool ValidDelay(int days) => days is >= 0 and <= MaxPipelineDelayDays;

    /// <summary>Chủ nhật của tuần chứa <paramref name="today"/> (hôm nay là Chủ nhật → chính hôm nay).</summary>
    public static DateOnly FirstWeekEnd(DateOnly today) => today.AddDays((7 - (int)today.DayOfWeek) % 7);

    public static DateOnly LastDay(DateOnly today) => FirstWeekEnd(today).AddDays(7 * (Weeks - 1));

    /// <summary>Tuần (1-based) của ngày <paramref name="d"/> ≥ hôm nay; ngày trước hôm nay → 1.</summary>
    public static int WeekOf(DateOnly d, DateOnly today)
    {
        var w1 = FirstWeekEnd(today);
        return d <= w1 ? 1 : 1 + (d.DayNumber - w1.DayNumber + 6) / 7;
    }

    /// <summary>Ngày <paramref name="day"/> của tháng chứa <paramref name="month"/>; tháng không có ngày đó → ngày cuối tháng.</summary>
    public static DateOnly DayIn(DateOnly month, int day) => new(month.Year, month.Month, Math.Min(day, DateTime.DaysInMonth(month.Year, month.Month)));

    /// <summary>Ngày trả lương còn tới trong cửa sổ: lương tháng M trả ngày D tháng M+1; ngày ≤ hôm nay coi như đã chi (sổ chưa nối bảng lương).</summary>
    public static List<(DateOnly PayOn, DateOnly SalaryMonth)> PayDates(DateOnly today, int payDay)
    {
        var thisMonth = new DateOnly(today.Year, today.Month, 1);
        var last = LastDay(today);
        var list = new List<(DateOnly, DateOnly)>();
        for (var j = -1; j <= 4; j++)
        {
            var salaryMonth = thisMonth.AddMonths(j);
            var payOn = DayIn(salaryMonth.AddMonths(1), payDay);
            if (payOn > today && payOn <= last) list.Add((payOn, salaryMonth));
        }
        return list;
    }

    public static CashForecast Build(ForecastInput x)
    {
        var today = x.Today;
        var last = LastDay(today);
        var items = new List<ForecastItem>();
        void Add(DateOnly? date, bool late, ForecastLine line, long amount, string name, Guid? refId, string? refCode = null, Guid? customerId = null)
        {
            if (amount <= 0) return;
            items.Add(new ForecastItem(late || date is null ? 1 : WeekOf(date.Value, today), line, date, amount, name, refId, refCode, customerId, late));
        }

        // Đợt thu: còn hạn → tuần chứa hạn (Thận trọng); quá hạn → tuần 1, chỉ Kỳ vọng.
        foreach (var i in x.Installments)
        {
            var name = string.IsNullOrWhiteSpace(i.CustomerName) ? i.Title : $"{i.CustomerName} · {i.Title}";
            if (i.DueOn < today) Add(i.DueOn, true, ForecastLine.Overdue, i.Remaining, name, i.ContractId, i.ContractCode, i.CustomerId);
            else if (i.DueOn <= last) Add(i.DueOn, false, ForecastLine.Installment, i.Remaining, name, i.ContractId, i.ContractCode, i.CustomerId);
        }

        // Cơ hội × xác suất: tiền về = ngày dự kiến chốt + trễ; đã qua → tuần 1; không có ngày → chỉ đếm.
        int undated = 0;
        long undatedValue = 0, undatedWeighted = 0;
        foreach (var o in x.Opportunities)
        {
            if (o.ExpectedCloseOn is not { } close)
            {
                undated++; undatedValue += o.Value; undatedWeighted += o.Weighted;
                continue;
            }
            var cashOn = close.AddDays(x.PipelineDelayDays);
            var name = string.IsNullOrWhiteSpace(o.CustomerName) ? o.Title : $"{o.CustomerName} · {o.Title}";
            if (cashOn <= last) Add(cashOn, cashOn < today, ForecastLine.Pipeline, o.Weighted, name, o.OpportunityId, null, o.CustomerId);
        }

        // Lương: cùng một tổng (tháng hiện tại) cho mọi kỳ trả trong cửa sổ.
        foreach (var (payOn, salaryMonth) in PayDates(today, x.PayrollPayDay))
            Add(payOn, false, ForecastLine.Payroll, x.PayrollMonthlyCost, $"Lương tháng {salaryMonth:MM/yyyy}", null);

        // Gia hạn dịch vụ: ngày gia hạn đã qua (chưa cập nhật) → một khoản ở tuần 1 (Late); các kỳ sau tính từ ngày đó theo chu kỳ.
        foreach (var s in x.Renewals)
        {
            var yearly = s.Cycle == "Yearly";
            var name = string.IsNullOrWhiteSpace(s.Vendor) ? s.Name : $"{s.Name} ({s.Vendor})";
            if (s.RenewalDate < today) Add(s.RenewalDate, true, ForecastLine.Renewal, s.Cost, name, s.ServiceId);
            for (var k = 0; k <= 120; k++)
            {
                var d = yearly ? s.RenewalDate.AddYears(k) : s.RenewalDate.AddMonths(k);
                if (d > last) break;
                if (d >= today) Add(d, false, ForecastLine.Renewal, s.Cost, name, s.ServiceId);
            }
        }

        // Đề nghị chi đã duyệt chưa chi: theo ngày cần; trống / đã qua → tuần 1.
        foreach (var e in x.Expenses)
            if (e.NeededBy is null || e.NeededBy <= last)
                Add(e.NeededBy, e.NeededBy is { } n && n < today, ForecastLine.Expense, e.Amount, e.Reason, e.Id, e.Code);

        // Khoản định kỳ hằng tháng (đang dùng): như lương, ngày ≤ hôm nay coi như đã thu / chi.
        var thisMonth = new DateOnly(today.Year, today.Month, 1);
        foreach (var r in x.Recurring.Where(r => r.IsActive))
            for (var j = 0; j <= 4; j++)
            {
                var d = DayIn(thisMonth.AddMonths(j), r.DayOfMonth);
                if (d > today && d <= last)
                    Add(d, false, r.Kind == CategoryKind.Income ? ForecastLine.RecurringIncome : ForecastLine.RecurringExpense, r.Amount, r.Name, r.Id);
            }

        items = [.. items.OrderBy(i => i.Week).ThenBy(i => i.Line).ThenBy(i => i.Date ?? DateOnly.MinValue).ThenBy(i => i.Name)];

        var weeks = new List<ForecastWeek>(Weeks);
        long safe = x.Opening, expected = x.Opening;
        int? negSafe = null, negExpected = null;
        var w1End = FirstWeekEnd(today);
        for (var w = 1; w <= Weeks; w++)
        {
            long Sum(ForecastLine l) => items.Where(i => i.Week == w && i.Line == l).Sum(i => i.Amount);
            var (inst, overdue, pipe, recIn) = (Sum(ForecastLine.Installment), Sum(ForecastLine.Overdue), Sum(ForecastLine.Pipeline), Sum(ForecastLine.RecurringIncome));
            var (pay, ren, exp, recOut) = (Sum(ForecastLine.Payroll), Sum(ForecastLine.Renewal), Sum(ForecastLine.Expense), Sum(ForecastLine.RecurringExpense));
            var inSafe = inst + recIn;
            var inExpected = inSafe + overdue + pipe;
            var outflow = pay + ren + exp + recOut;
            safe += inSafe - outflow;
            expected += inExpected - outflow;
            if (safe < 0) negSafe ??= w;
            if (expected < 0) negExpected ??= w;
            var from = w == 1 ? today : w1End.AddDays(7 * (w - 2) + 1);
            var to = w1End.AddDays(7 * (w - 1));
            weeks.Add(new ForecastWeek(w, from, to, inst, overdue, pipe, recIn, pay, ren, exp, recOut, inSafe, inExpected, outflow, safe, expected));
        }

        return new CashForecast(today, last, x.Opening, weeks, items, negSafe, negExpected, undated, undatedValue, undatedWeighted);
    }
}
