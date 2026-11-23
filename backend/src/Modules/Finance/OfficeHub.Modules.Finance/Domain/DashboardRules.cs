namespace OfficeHub.Modules.Finance.Domain;

/// <summary>
/// Tổng quan giám đốc (TEST-220) — gộp thu / chi / lãi theo tháng × mảng, hàm thuần (test: tests/OfficeHub.Modules.Finance.Tests).
/// Số theo TIỀN THỰC THU / THỰC CHI của sổ quản trị, không phải doanh thu ghi nhận. Chuyển quỹ không tính (chỉ đổi chỗ tiền).
/// </summary>
public static class DashboardRules
{
    public const int DefaultMonths = 12;
    public const int MaxMonths = 24;

    public static bool ValidMonths(int months) => months is >= 1 and <= MaxMonths;

    /// <summary>Tháng đầu của khoảng <paramref name="months"/> tháng tính cả tháng hiện tại.</summary>
    public static DateOnly FirstMonth(DateOnly thisMonthStart, int months) => thisMonthStart.AddMonths(-(months - 1));

    public sealed record LineSum(Guid? BusinessLineId, long Income, long Expense);
    public sealed record MonthSum(DateOnly Month, long Income, long Expense, long Profit, IReadOnlyList<LineSum> ByLine);

    /// <summary>
    /// Đủ <paramref name="months"/> dòng tháng (cũ → mới, tháng không có giao dịch vẫn ra 0), mỗi tháng: thu, chi, lãi = thu − chi,
    /// chia theo mảng (null = chưa gắn mảng; chỉ mảng có phát sinh, nhiều tiền trước). Bỏ qua chuyển quỹ và giao dịch ngoài khoảng.
    /// Đầu vào chỉ nên gồm dòng sổ còn hiệu lực (lọc ở truy vấn).
    /// </summary>
    public static List<MonthSum> Monthly(DateOnly thisMonthStart, int months, IEnumerable<(DateOnly Date, TxKind Kind, Guid? BusinessLineId, long Amount)> entries)
    {
        var first = FirstMonth(thisMonthStart, months);
        var end = thisMonthStart.AddMonths(1);
        var buckets = Enumerable.Range(0, months).Select(i => first.AddMonths(i)).ToDictionary(m => m, _ => new Dictionary<Guid, (Guid? Line, long In, long Out)>());
        var none = Guid.Empty; // khoá cho "chưa gắn mảng"
        foreach (var (date, kind, line, amount) in entries)
        {
            if (kind == TxKind.Transfer || date < first || date >= end) continue;
            var lines = buckets[new DateOnly(date.Year, date.Month, 1)];
            var key = line ?? none;
            var cur = lines.TryGetValue(key, out var found) ? found : (Line: line, In: 0L, Out: 0L);
            lines[key] = kind == TxKind.Income ? (line, cur.In + amount, cur.Out) : (line, cur.In, cur.Out + amount);
        }
        return buckets.OrderBy(b => b.Key).Select(b =>
        {
            var byLine = b.Value.Values.Select(x => new LineSum(x.Line, x.In, x.Out)).OrderByDescending(x => x.Income + x.Expense).ToList();
            var income = byLine.Sum(x => x.Income);
            var expense = byLine.Sum(x => x.Expense);
            return new MonthSum(b.Key, income, expense, income - expense, byLine);
        }).ToList();
    }

    /// <summary>Cộng theo mảng qua mọi tháng (nhiều tiền trước).</summary>
    public static List<LineSum> TotalByLine(IEnumerable<MonthSum> months) =>
        months.SelectMany(m => m.ByLine).GroupBy(x => x.BusinessLineId)
            .Select(g => new LineSum(g.Key, g.Sum(x => x.Income), g.Sum(x => x.Expense))).OrderByDescending(x => x.Income + x.Expense).ToList();
}
