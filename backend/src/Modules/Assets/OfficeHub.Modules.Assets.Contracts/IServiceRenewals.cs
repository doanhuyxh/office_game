namespace OfficeHub.Modules.Assets.Contracts;

/// <summary>
/// Gia hạn dịch vụ / tài khoản phần mềm sắp tới — cho dự báo dòng tiền 13 tuần (module Finance, TEST-221).
/// CÓ SỐ TIỀN (chi phí dịch vụ trên trang Tài sản chỉ HR thấy): chỉ gọi sau khi đã kiểm tra quyền Xem tài chính; không đưa ra kênh AI / MCP.
/// </summary>
public interface IServiceRenewals
{
    /// <summary>Dịch vụ đang dùng (Active) có chu kỳ Hằng tháng / Hằng năm, có chi phí &gt; 0 và có ngày gia hạn (kể cả ngày đã qua mà chưa cập nhật).</summary>
    Task<IReadOnlyList<ServiceRenewal>> ActiveRenewalsAsync(CancellationToken ct = default);
}

/// <param name="Cycle">"Monthly" hoặc "Yearly".</param>
/// <param name="Cost">Chi phí mỗi kỳ (VND, làm tròn tới đồng).</param>
/// <param name="RenewalDate">Ngày gia hạn kế tiếp đang ghi trên dịch vụ.</param>
public sealed record ServiceRenewal(Guid ServiceId, string Name, string? Vendor, string Cycle, long Cost, DateOnly RenewalDate);
