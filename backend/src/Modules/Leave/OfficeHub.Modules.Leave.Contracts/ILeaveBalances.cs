namespace OfficeHub.Modules.Leave.Contracts;

/// <summary>Quỹ phép năm cho module Reporting (quy ra tiền phép khi nghỉ việc). Người đã nghỉ: tính tới ngày nghỉ việc.</summary>
public interface ILeaveBalances
{
    Task<IReadOnlyDictionary<Guid, LeaveBalanceInfo>> GetAsync(IReadOnlyCollection<Guid> employeeIds, CancellationToken ct = default);
}

/// <param name="Available">Còn lại = tích luỹ + chuyển năm trước + điều chỉnh − đã dùng − đang chờ duyệt.</param>
public sealed record LeaveBalanceInfo(Guid EmployeeId, int Year, int EntitlementThisYear, decimal AccruedThisYear, decimal CarriedFromPreviousYears,
    decimal AdjustedThisYear, decimal UsedThisYear, decimal Pending, decimal Available);
