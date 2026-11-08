using Microsoft.EntityFrameworkCore;
using OfficeHub.Modules.Payroll.Contracts;
using OfficeHub.Modules.Payroll.Domain;

namespace OfficeHub.Modules.Payroll.Infrastructure;

/// <summary>
/// Cài đặt <see cref="IPayrollCosts"/>: kỳ đã chốt → phiếu đã lưu; còn lại → <see cref="PayrollService.BuildAsync"/> (không lưu).
/// Tháng ĐANG chạy: ước theo lương hợp đồng đủ công chuẩn (kế hoạch đã duyệt: "chưa chốt → ước từ lương hợp đồng") — ổn định suốt tháng.
/// Tháng đã qua mà chưa chốt: tính như bảng lương (chấm công thật).
/// </summary>
internal sealed class PayrollCosts(PayrollDbContext db, PayrollService svc) : IPayrollCosts
{
    public async Task<IReadOnlyDictionary<Guid, EmployeeMonthCost>> MonthCostsAsync(DateOnly month, IReadOnlyCollection<Guid> employeeIds, CancellationToken ct = default)
    {
        var from = new DateOnly(month.Year, month.Month, 1);
        if (employeeIds.Count == 0 || from > svc.Today) return new Dictionary<Guid, EmployeeMonthCost>();
        var period = await db.Periods.AsNoTracking().FirstOrDefaultAsync(p => p.Month == from, ct);
        if (period is { Status: PeriodStatus.Locked })
        {
            var slips = await db.Payslips.AsNoTracking().Where(p => p.PeriodId == period.Id && employeeIds.Contains(p.EmployeeId)).ToListAsync(ct);
            return slips.ToDictionary(p => p.EmployeeId, p => new EmployeeMonthCost(p.EmployeeId, CostOf(svc.Read(p)), false));
        }
        var current = from == new DateOnly(svc.Today.Year, svc.Today.Month, 1);
        var (_, built) = await svc.BuildAsync(from, period?.Id, employeeIds, ct, assumeFullAttendance: current);
        return built.ToDictionary(x => x.EmployeeId, x => new EmployeeMonthCost(x.EmployeeId, CostOf(x.Data), true));
    }

    /// <summary>Chi phí công ty = tổng thu nhập + BH phần công ty (<see cref="PayslipData.EmployerCost"/>; không gồm khoản không chịu thuế như tạm ứng).</summary>
    internal static long CostOf(PayslipData d) => (long)Math.Round(d.EmployerCost, MidpointRounding.AwayFromZero);
}
