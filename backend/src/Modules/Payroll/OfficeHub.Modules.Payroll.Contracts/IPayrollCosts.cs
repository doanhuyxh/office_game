namespace OfficeHub.Modules.Payroll.Contracts;

/// <summary>
/// Chi phí công ty cho từng nhân viên trong một tháng = tổng thu nhập (Gross) + bảo hiểm phần công ty đóng — cho module Projects tính chi phí nhân công dự án.
/// Kỳ lương đã chốt → lấy từ phiếu lương (cố định). Chưa chốt / chưa tạo kỳ → tính thử bằng cùng công thức bảng lương (không lưu), đánh dấu ước tính.
/// DỮ LIỆU NHẠY CẢM (suy ra được lương): chỉ gọi sau khi đã kiểm tra quyền Xem tài chính. Không đưa ra kênh AI / MCP.
/// </summary>
public interface IPayrollCosts
{
    /// <param name="month">Ngày bất kỳ trong tháng. Tháng tương lai → rỗng.</param>
    /// <returns>Nhân viên không có phiếu (chưa vào làm / không có hợp đồng) → không có trong kết quả.</returns>
    Task<IReadOnlyDictionary<Guid, EmployeeMonthCost>> MonthCostsAsync(DateOnly month, IReadOnlyCollection<Guid> employeeIds, CancellationToken ct = default);
}

/// <param name="Cost">VND, làm tròn tới đồng.</param>
/// <param name="Estimated">true = kỳ lương tháng này chưa chốt (số có thể đổi).</param>
public sealed record EmployeeMonthCost(Guid EmployeeId, long Cost, bool Estimated);
