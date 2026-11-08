namespace OfficeHub.Modules.Sales.Contracts;

/// <summary>
/// Phần công khai của module Sales cho module Projects: gắn dự án với hợp đồng bán, mốc nghiệm thu với đợt thu.
/// KHÔNG trả số tiền (quản lý dự án không xem tiền — chủ dự án chốt 2026-11-08).
/// </summary>
public interface ISalesContractsLookup
{
    Task<SalesContractRef?> GetAsync(Guid contractId, CancellationToken ct = default);
    Task<IReadOnlyList<SalesContractRef>> GetManyAsync(IReadOnlyCollection<Guid> contractIds, CancellationToken ct = default);
    /// <summary>Hợp đồng đang hiệu lực khớp <paramref name="search"/> (số / tên / khách), tối đa 30 — chọn khi gắn dự án.</summary>
    Task<IReadOnlyList<SalesContractRef>> SearchActiveAsync(string? search, CancellationToken ct = default);
    Task<IReadOnlyList<InstallmentRef>> InstallmentsAsync(Guid contractId, CancellationToken ct = default);
    /// <summary>
    /// Mốc dự án đã nghiệm thu → đợt thu gắn với nó đến hạn: hạn thu sau ngày nghiệm thu thì kéo về ngày nghiệm thu (đặt lại mốc nhắc), báo người phụ trách
    /// hợp đồng + kế toán. Đợt đã huỷ / không tồn tại → false.
    /// </summary>
    Task<bool> MarkAcceptedAsync(Guid installmentId, DateOnly acceptedOn, string milestoneTitle, string projectName, CancellationToken ct = default);
}

public sealed record SalesContractRef(Guid Id, string Code, string Title, string CustomerName, string Status, Guid? BusinessLineId);

public sealed record InstallmentRef(Guid Id, Guid ContractId, string Title, DateOnly DueOn, bool Cancelled);
