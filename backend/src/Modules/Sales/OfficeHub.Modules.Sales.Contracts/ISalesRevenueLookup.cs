namespace OfficeHub.Modules.Sales.Contracts;

/// <summary>
/// Số tiền của hợp đồng bán cho báo cáo lãi / lỗ dự án (module Projects).
/// CÓ SỐ TIỀN: chỉ gọi sau khi đã kiểm tra quyền Xem tài chính (quản lý dự án không xem tiền — chủ dự án chốt 2026-11-08).
/// </summary>
public interface ISalesRevenueLookup
{
    Task<IReadOnlyList<ContractRevenue>> ContractRevenueAsync(IReadOnlyCollection<Guid> contractIds, CancellationToken ct = default);
}

/// <param name="Status">"Active" | "Completed" | "Cancelled".</param>
/// <param name="TotalValue">Sau thuế = trước thuế + VAT.</param>
/// <param name="Scheduled">Tổng đợt thu chưa huỷ.</param>
/// <param name="Collected">Đã thu (chỉ tính lần thu còn dòng sổ hiệu lực ở Finance).</param>
/// <param name="Collections">Các lần thu còn hiệu lực (ngày, tiền) — để chia theo tháng.</param>
public sealed record ContractRevenue(Guid ContractId, string Code, string Title, string CustomerName, string Status, long ValueBeforeTax, int VatRate, long TotalValue,
    long Scheduled, long Collected, IReadOnlyList<CollectedOn> Collections);

public sealed record CollectedOn(DateOnly Date, long Amount);
