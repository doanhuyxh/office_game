namespace OfficeHub.Modules.Projects.Domain;

/// <summary>
/// Chi phí nhân công + lãi / lỗ dự án (giai đoạn 2b, chủ dự án chốt 2026-11-08) — hàm thuần, test: tests/OfficeHub.Modules.Projects.Tests.
/// <list type="bullet">
/// <item>Nhân công của A cho dự án P tháng M = chi phí công ty cho A tháng M (Gross + BH phần công ty) × công của A ở P / công thực tế của A
///   = chi phí × % phân bổ (công ở P = công thực tế × %). Không có ngày công nào trong tháng → 0 (khoản đó thuộc chi phí chung).</item>
/// <item>Doanh thu = giá trị hợp đồng SAU thuế; VAT là một dòng chi phí. Hợp đồng đã huỷ: chỉ tính số đã thu (VAT theo tỉ lệ).</item>
/// <item>Lãi = doanh thu − VAT − nhân công − chi trực tiếp + thu khác gắn dự án. Không phân bổ chi phí chung (BGĐ, HR, văn phòng…).</item>
/// </list>
/// </summary>
public static class ProjectCostRules
{
    public static long LaborCost(long monthCost, decimal presentDays, decimal percent) =>
        presentDays <= 0 || percent <= 0 || monthCost <= 0 ? 0 : (long)Math.Round(monthCost * Math.Min(percent, 100) / 100m, MidpointRounding.AwayFromZero);

    /// <param name="status">"Active" | "Completed" | "Cancelled" (module Sales).</param>
    public static (long Revenue, long Vat) ContractRevenue(string status, long valueBeforeTax, long totalValue, long collected)
    {
        if (status != "Cancelled") return (totalValue, totalValue - valueBeforeTax);
        if (collected <= 0 || totalValue <= 0) return (0, 0);
        return (collected, (long)Math.Round((decimal)collected * (totalValue - valueBeforeTax) / totalValue, MidpointRounding.AwayFromZero));
    }

    /// <summary>Còn phải thu của hợp đồng (đã huỷ → 0).</summary>
    public static long Outstanding(string status, long totalValue, long collected) => status == "Cancelled" ? 0 : Math.Max(0, totalValue - collected);

    public static long Profit(long revenue, long vat, long otherIncome, long labor, long directExpense) => revenue - vat + otherIncome - labor - directExpense;

    /// <summary>% lãi trên tổng thu (doanh thu + thu khác), 1 chữ số thập phân. Chưa có thu → null.</summary>
    public static decimal? MarginPercent(long profit, long revenue, long otherIncome) =>
        revenue + otherIncome <= 0 ? null : Math.Round(profit * 100m / (revenue + otherIncome), 1, MidpointRounding.AwayFromZero);
}
