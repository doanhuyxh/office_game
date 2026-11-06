namespace OfficeHub.Modules.LaborContracts.Contracts;

/// <summary>
/// Lương / phụ cấp hiệu lực theo hợp đồng (đã giải mã, tính phụ lục) tại một ngày — cho module Reporting quy ra tiền.
/// DỮ LIỆU NHẠY CẢM: chỉ dùng sau endpoint đã kiểm tra quyền HR (hoặc chính chủ). Không đưa ra kênh AI / MCP.
/// </summary>
public interface ISalaryLookup
{
    /// <summary>Nhân viên không có hợp đồng phủ ngày <paramref name="date"/> → không có trong kết quả.</summary>
    Task<IReadOnlyDictionary<Guid, SalaryInfo>> GetAsync(IReadOnlyCollection<Guid> employeeIds, DateOnly date, CancellationToken ct = default);
}

/// <param name="ContractType">"Indefinite" | "Fixed" | "Probation" (thử việc: không đóng BH, thuế khấu trừ 10%).</param>
public sealed record SalaryInfo(Guid EmployeeId, Guid ContractId, string ContractNumber, decimal? Salary, decimal? Allowance, string ContractType = "Indefinite");
