namespace OfficeHub.Modules.Sales.Domain;

/// <summary>Quy tắc kinh doanh / công nợ — hàm thuần (test: tests/OfficeHub.Modules.Sales.Tests).</summary>
public static class SalesRules
{
    /// <summary>
    /// Máy trạng thái hợp đồng bán (TEST-21): Đang hiệu lực → Hoàn thành / Huỷ; Hoàn thành → Đang hiệu lực (mở lại khi đóng nhầm);
    /// Huỷ là trạng thái cuối — không mở lại (đợt thu / công nợ đã dừng theo hợp đồng huỷ). Giữ nguyên trạng thái luôn hợp lệ.
    /// </summary>
    public static bool CanChangeStatus(ContractStatus from, ContractStatus to) => from == to || (from, to) switch
    {
        (ContractStatus.Active, ContractStatus.Completed or ContractStatus.Cancelled) => true,
        (ContractStatus.Completed, ContractStatus.Active) => true,
        _ => false,
    };

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

    public static readonly string[] AgingBuckets = ["1-30", "31-60", "61-90", ">90"];

    /// <summary>
    /// Tổng hợp công nợ toàn công ty (Tổng quan giám đốc, TEST-220) — cùng quy tắc với <c>GET /api/sales/receivables</c>:
    /// mỗi đợt (chưa huỷ, của hợp đồng đang hiệu lực) theo <see cref="InstallmentStatus"/>; đợt đã thu đủ bỏ qua; tuổi nợ theo <see cref="AgingBucket"/>.
    /// </summary>
    public static Contracts.ReceivablesOutlook SummarizeReceivables(IEnumerable<(long Amount, long Collected, DateOnly DueOn)> items, DateOnly today)
    {
        long outstanding = 0, overdue = 0, dueSoon = 0;
        var overdueCount = 0;
        var buckets = AgingBuckets.ToDictionary(b => b, _ => (Amount: 0L, Count: 0));
        foreach (var (amount, collected, dueOn) in items)
        {
            var st = InstallmentStatus(false, amount, collected, dueOn, today);
            if (st == InstallmentState.Paid) continue;
            var remaining = Math.Max(0, amount - collected);
            outstanding += remaining;
            if (st == InstallmentState.DueSoon) dueSoon += remaining;
            if (st != InstallmentState.Overdue) continue;
            overdue += remaining;
            overdueCount++;
            if (AgingBucket(dueOn, today) is { } b) buckets[b] = (buckets[b].Amount + remaining, buckets[b].Count + 1);
        }
        return new(outstanding, overdue, overdueCount, dueSoon, [.. AgingBuckets.Select(b => new Contracts.AgingBucketSum(b, buckets[b].Amount, buckets[b].Count))]);
    }

    private static readonly OpportunityStage[] OpenStages = [OpportunityStage.Lead, OpportunityStage.Contacted, OpportunityStage.Quoted, OpportunityStage.Negotiating];

    /// <summary>Pipeline toàn công ty: chỉ cơ hội đang mở (<see cref="IsClosed"/> = false), trọng số theo <see cref="Weighted"/>; đủ 4 giai đoạn mở.</summary>
    public static Contracts.PipelineOutlook SummarizePipeline(IEnumerable<(OpportunityStage Stage, long Value, int Probability)> opportunities)
    {
        var open = opportunities.Where(o => !IsClosed(o.Stage)).ToList();
        var byStage = OpenStages.Select(s =>
        {
            var rows = open.Where(o => o.Stage == s).ToList();
            return new Contracts.PipelineStageSum(s.ToString(), rows.Count, rows.Sum(o => o.Value), rows.Sum(o => Weighted(o.Value, o.Probability, o.Stage)));
        }).ToList();
        return new(open.Count, byStage.Sum(x => x.Value), byStage.Sum(x => x.Weighted), byStage);
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

    /// <summary>
    /// Kiểm tra phụ lục (hàm thuần). <paramref name="totalDelta"/> = <see cref="Total"/>(delta, VAT của hợp đồng).
    /// Tăng: đợt thu mới (nếu có) cộng lại ≤ phần tăng. Giảm: không kèm đợt thu; giá trị mới ≥ tổng đợt đang lên lịch (huỷ / bớt đợt trước).
    /// </summary>
    public static List<(string Field, string Message)> ValidateAppendix(long valueBeforeTaxDelta, long totalDelta, long currentBeforeTax, long currentTotal,
        long scheduled, DateOnly signedOn, DateOnly contractSignedOn, DateOnly today, IReadOnlyList<(string Title, DateOnly DueOn, long Amount)> items)
    {
        var e = new List<(string, string)>();
        if (valueBeforeTaxDelta == 0 || Math.Abs(valueBeforeTaxDelta) > MaxAmount) e.Add(("valueBeforeTaxDelta", "Giá trị tăng / giảm không hợp lệ"));
        else if (currentBeforeTax + valueBeforeTaxDelta < 1) e.Add(("valueBeforeTaxDelta", "Giảm vượt giá trị hợp đồng"));
        if (signedOn < contractSignedOn) e.Add(("signedOn", "Ngày ký phụ lục trước ngày ký hợp đồng"));
        else if (signedOn > today) e.Add(("signedOn", "Ngày ký không ở tương lai"));
        if (valueBeforeTaxDelta < 0)
        {
            if (items.Count > 0) e.Add(("installments", "Phụ lục giảm giá trị không kèm đợt thu mới"));
            if (currentTotal + totalDelta < scheduled)
                e.Add(("valueBeforeTaxDelta", $"Đợt thu đang lên lịch {scheduled:N0} đ vượt giá trị mới {currentTotal + totalDelta:N0} đ — huỷ bớt đợt trước"));
        }
        else if (valueBeforeTaxDelta > 0)
        {
            if (items.Count > 120) e.Add(("installments", "Tối đa 120 đợt"));
            if (items.Any(i => string.IsNullOrWhiteSpace(i.Title) || i.Title.Length > 200)) e.Add(("installments", "Mỗi đợt cần tên (≤ 200 ký tự)"));
            if (items.Any(i => i.Amount < 1)) e.Add(("installments", "Số tiền mỗi đợt phải lớn hơn 0"));
            if (items.Any(i => i.DueOn < signedOn)) e.Add(("installments", "Hạn thu trước ngày ký phụ lục"));
            var sum = items.Sum(i => i.Amount);
            if (sum > totalDelta) e.Add(("installments", $"Tổng đợt mới {sum:N0} đ vượt phần tăng {totalDelta:N0} đ"));
        }
        return e;
    }
}
