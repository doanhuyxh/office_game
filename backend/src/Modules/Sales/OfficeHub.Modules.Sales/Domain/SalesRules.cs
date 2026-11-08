namespace OfficeHub.Modules.Sales.Domain;

/// <summary>Quy tắc kinh doanh / công nợ — hàm thuần (test: tests/OfficeHub.Modules.Sales.Tests).</summary>
public static class SalesRules
{
    public const long MaxAmount = 10_000_000_000_000;
    /// <summary>Đợt thu đến hạn trong ≤ 7 ngày = "sắp đến hạn" (cũng là mốc nhắc lần đầu).</summary>
    public const int DueSoonDays = 7;
    public static readonly int[] VatRates = [0, 5, 8, 10];

    public static string CustomerCode(long n) => $"KH-{n:D5}";

    public static int DefaultProbability(OpportunityStage s) => s switch
    {
        OpportunityStage.Lead => 10,
        OpportunityStage.Contacted => 20,
        OpportunityStage.Quoted => 40,
        OpportunityStage.Negotiating => 70,
        OpportunityStage.Won => 100,
        _ => 0,
    };

    public static bool IsClosed(OpportunityStage s) => s is OpportunityStage.Won or OpportunityStage.Lost;

    /// <summary>Giá trị có trọng số (giá trị × xác suất) — dùng dự báo pipeline. Đã đóng → 0.</summary>
    public static long Weighted(long value, int probability, OpportunityStage s) => IsClosed(s) ? 0 : value * Math.Clamp(probability, 0, 100) / 100;

    /// <summary>Tổng sau thuế, làm tròn đồng.</summary>
    public static long Total(long beforeTax, int vatRate) => beforeTax + (long)Math.Round(beforeTax * vatRate / 100m, MidpointRounding.AwayFromZero);

    public static InstallmentState InstallmentStatus(bool cancelled, long amount, long collected, DateOnly dueOn, DateOnly today)
    {
        if (cancelled) return InstallmentState.Cancelled;
        if (collected >= amount) return InstallmentState.Paid;
        if (dueOn < today) return InstallmentState.Overdue;
        if (collected > 0) return InstallmentState.Partial;
        return dueOn.DayNumber - today.DayNumber <= DueSoonDays ? InstallmentState.DueSoon : InstallmentState.Upcoming;
    }

    /// <summary>Nhóm tuổi nợ của đợt quá hạn: "1-30", "31-60", "61-90", ">90" (null nếu chưa quá hạn).</summary>
    public static string? AgingBucket(DateOnly dueOn, DateOnly today)
    {
        var days = today.DayNumber - dueOn.DayNumber;
        return days <= 0 ? null : days <= 30 ? "1-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : ">90";
    }

    /// <summary>Lịch thu hằng tháng: <paramref name="count"/> đợt, cùng ngày trong tháng (tháng ngắn → ngày cuối tháng).</summary>
    public static List<(string Title, DateOnly DueOn, long Amount)> MonthlySchedule(DateOnly firstDue, int count, long amountPerMonth)
    {
        var list = new List<(string, DateOnly, long)>();
        for (var i = 0; i < count; i++)
        {
            var m = new DateOnly(firstDue.Year, firstDue.Month, 1).AddMonths(i);
            var day = Math.Min(firstDue.Day, DateTime.DaysInMonth(m.Year, m.Month));
            list.Add(($"Tháng {m.Month:D2}/{m.Year}", new DateOnly(m.Year, m.Month, day), amountPerMonth));
        }
        return list;
    }

    /// <summary>
    /// Lỗi lịch thu: mỗi đợt có tên, số tiền &gt; 0, hạn ≥ ngày ký; theo mốc / một lần thì tổng các đợt = giá trị hợp đồng (sau thuế);
    /// định kỳ tháng thì tổng không được vượt giá trị (giá trị có thể là cả năm). Một lần → đúng 1 đợt.
    /// </summary>
    public static List<string> ValidateSchedule(BillingKind billing, long total, DateOnly signedOn, IReadOnlyList<(string Title, DateOnly DueOn, long Amount)> items)
    {
        var e = new List<string>();
        if (items.Count == 0) { e.Add("Cần ít nhất một đợt thu"); return e; }
        if (items.Count > 120) e.Add("Tối đa 120 đợt thu");
        if (billing == BillingKind.OneTime && items.Count != 1) e.Add("Hợp đồng thu một lần chỉ có 1 đợt");
        for (var i = 0; i < items.Count; i++)
        {
            var (title, due, amount) = items[i];
            if (string.IsNullOrWhiteSpace(title)) e.Add($"Đợt {i + 1}: thiếu tên");
            if (amount < 1) e.Add($"Đợt {i + 1}: số tiền phải lớn hơn 0");
            if (due < signedOn) e.Add($"Đợt {i + 1}: hạn thu trước ngày ký");
        }
        var sum = items.Sum(x => x.Amount);
        if (billing != BillingKind.Monthly && sum != total) e.Add($"Tổng các đợt ({sum:N0} đ) phải bằng giá trị hợp đồng sau thuế ({total:N0} đ)");
        if (billing == BillingKind.Monthly && sum > total) e.Add($"Tổng các đợt ({sum:N0} đ) vượt giá trị hợp đồng sau thuế ({total:N0} đ)");
        return e;
    }

    public enum Reminder { None, DueSoon, DueToday, Overdue }

    /// <summary>
    /// Nhắc gì hôm nay cho một đợt chưa thu đủ: còn ≤ 7 ngày (một lần) → DueSoon; đúng hạn (một lần) → DueToday; quá hạn → mỗi thứ Hai một lần
    /// (và lần đầu ngay khi phát hiện quá hạn).
    /// </summary>
    public static Reminder ReminderFor(InstallmentState state, DateOnly dueOn, DateOnly today, bool remindedSoon, bool remindedDue, DateOnly? lastOverdueOn)
    {
        if (state is InstallmentState.Paid or InstallmentState.Cancelled) return Reminder.None;
        if (dueOn < today)
            return lastOverdueOn is null || (today.DayOfWeek == DayOfWeek.Monday && lastOverdueOn < today) ? Reminder.Overdue : Reminder.None;
        if (dueOn == today) return remindedDue ? Reminder.None : Reminder.DueToday;
        return dueOn.DayNumber - today.DayNumber <= DueSoonDays && !remindedSoon ? Reminder.DueSoon : Reminder.None;
    }
}
