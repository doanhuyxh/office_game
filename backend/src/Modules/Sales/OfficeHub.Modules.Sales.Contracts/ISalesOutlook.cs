namespace OfficeHub.Modules.Sales.Contracts;

/// <summary>
/// Số kinh doanh TOÀN CÔNG TY (không lọc theo người phụ trách) cho màn Tổng quan giám đốc (module Finance, TEST-220).
/// CÓ SỐ TIỀN: chỉ gọi sau khi đã kiểm tra quyền Xem tài chính (quản lý dự án không xem tiền — chủ dự án chốt 2026-11-08).
/// Việc 2/3 (dự báo dòng tiền 13 tuần) thêm hàm vào đây: đợt thu sắp đến hạn, cơ hội theo ngày dự kiến chốt.
/// </summary>
public interface ISalesOutlook
{
    /// <summary>Công nợ: khớp <c>GET /api/sales/receivables</c> của người có quyền Xem tài chính (hợp đồng đang hiệu lực, đợt chưa huỷ, chưa thu đủ).</summary>
    Task<ReceivablesOutlook> ReceivablesAsync(CancellationToken ct = default);

    /// <summary>Pipeline: cơ hội đang mở (chưa Thắng / Thua); trọng số = giá trị × xác suất (<c>SalesRules.Weighted</c>).</summary>
    Task<PipelineOutlook> PipelineAsync(CancellationToken ct = default);
}

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
