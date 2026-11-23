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

    /// <summary>
    /// TỔNG chi phí công ty của cả tháng (mọi nhân viên có phiếu; cùng công thức <see cref="MonthCostsAsync"/>) — cho dự báo dòng tiền 13 tuần (Finance, TEST-221).
    /// Chỉ trả tổng, KHÔNG trả theo người. Tháng đang chạy chưa chốt → ước tính đủ công. CÓ SỐ TIỀN: chỉ gọi sau khi đã kiểm tra quyền Xem tài chính;
    /// không đưa ra kênh AI / MCP.
    /// </summary>
    /// <param name="month">Ngày bất kỳ trong tháng. Tháng tương lai → 0.</param>
    Task<PayrollMonthTotal> MonthTotalAsync(DateOnly month, CancellationToken ct = default);
}

/// <param name="Cost">Tổng Gross + BH phần công ty (VND).</param>
/// <param name="Estimated">true = kỳ lương tháng đó chưa chốt (số ước tính).</param>
public sealed record PayrollMonthTotal(long Cost, bool Estimated);

/// <param name="Cost">VND, làm tròn tới đồng.</param>
/// <param name="Estimated">true = kỳ lương tháng này chưa chốt (số có thể đổi).</param>
public sealed record EmployeeMonthCost(Guid EmployeeId, long Cost, bool Estimated);
