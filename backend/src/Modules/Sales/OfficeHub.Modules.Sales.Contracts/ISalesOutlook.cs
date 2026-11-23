namespace OfficeHub.Modules.Sales.Contracts;

/// <summary>
/// Số kinh doanh TOÀN CÔNG TY (không lọc theo người phụ trách) cho màn Tổng quan giám đốc (module Finance, TEST-220).
/// CÓ SỐ TIỀN: chỉ gọi sau khi đã kiểm tra quyền Xem tài chính (quản lý dự án không xem tiền — chủ dự án chốt 2026-11-08).
/// Dự báo dòng tiền 13 tuần (TEST-221) dùng thêm <see cref="OpenInstallmentsAsync"/> và <see cref="OpenOpportunitiesAsync"/>.
/// </summary>
public interface ISalesOutlook
{
    /// <summary>Công nợ: khớp <c>GET /api/sales/receivables</c> của người có quyền Xem tài chính (hợp đồng đang hiệu lực, đợt chưa huỷ, chưa thu đủ).</summary>
    Task<ReceivablesOutlook> ReceivablesAsync(CancellationToken ct = default);

    /// <summary>Pipeline: cơ hội đang mở (chưa Thắng / Thua); trọng số = giá trị × xác suất (<c>SalesRules.Weighted</c>).</summary>
    Task<PipelineOutlook> PipelineAsync(CancellationToken ct = default);

    /// <summary>
    /// Từng đợt thu còn phải thu (cùng phạm vi với <see cref="ReceivablesAsync"/>: hợp đồng đang hiệu lực, đợt chưa huỷ, chưa thu đủ), kể cả đợt quá hạn —
    /// <see cref="OpenInstallment.Remaining"/> = số tiền đợt − đã thu (<c>CollectedCalculator</c>). Bên gọi tự xếp quá hạn / sắp đến hạn theo <c>DueOn</c>.
    /// </summary>
    Task<IReadOnlyList<OpenInstallment>> OpenInstallmentsAsync(CancellationToken ct = default);

    /// <summary>Từng cơ hội đang mở (chưa Thắng / Thua), kể cả cơ hội chưa có ngày dự kiến chốt; <see cref="OpenOpportunity.Weighted"/> theo <c>SalesRules.Weighted</c>.</summary>
    Task<IReadOnlyList<OpenOpportunity>> OpenOpportunitiesAsync(CancellationToken ct = default);
}

/// <param name="Remaining">Phần còn lại của đợt (VND, &gt; 0).</param>
public sealed record OpenInstallment(Guid InstallmentId, Guid ContractId, string ContractCode, Guid CustomerId, string CustomerName, string Title,
    DateOnly DueOn, long Remaining);

/// <param name="Stage">Lead, Contacted, Quoted, Negotiating.</param>
/// <param name="ExpectedCloseOn">Ngày dự kiến chốt (null = chưa nhập).</param>
/// <param name="Weighted">Giá trị × xác suất.</param>
public sealed record OpenOpportunity(Guid OpportunityId, Guid CustomerId, string CustomerName, string Title, string Stage, DateOnly? ExpectedCloseOn,
    long Value, int Probability, long Weighted);

/// <param name="Outstanding">Tổng còn phải thu (mọi đợt chưa thu đủ).</param>
/// <param name="Overdue">Còn phải thu của các đợt quá hạn.</param>
/// <param name="OverdueCount">Số đợt quá hạn.</param>
/// <param name="DueSoon">Còn phải thu của các đợt sắp đến hạn (≤ 7 ngày).</param>
/// <param name="Aging">Tuổi nợ quá hạn theo thứ tự "1-30", "31-60", "61-90", ">90" (luôn đủ 4 nhóm).</param>
public sealed record ReceivablesOutlook(long Outstanding, long Overdue, int OverdueCount, long DueSoon, IReadOnlyList<AgingBucketSum> Aging);

public sealed record AgingBucketSum(string Bucket, long Amount, int Count);

/// <param name="ByStage">Theo giai đoạn đang mở: Lead, Contacted, Quoted, Negotiating (luôn đủ 4, kể cả 0).</param>
public sealed record PipelineOutlook(int OpenCount, long OpenValue, long Weighted, IReadOnlyList<PipelineStageSum> ByStage);

public sealed record PipelineStageSum(string Stage, int Count, long Value, long Weighted);
