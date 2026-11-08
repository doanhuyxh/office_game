using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Security;
using OfficeHub.Modules.Attendance.Contracts;
using OfficeHub.Modules.LaborContracts.Contracts;
using OfficeHub.Modules.Leave.Contracts;
using OfficeHub.Modules.Organization.Contracts;
using OfficeHub.Modules.Payroll.Domain;

namespace OfficeHub.Modules.Payroll.Infrastructure;

/// <summary>Gom dữ liệu kỳ lương từ các module khác (chỉ qua *.Contracts), tính bằng <see cref="PayrollCalculator"/>, lưu phiếu mã hoá.</summary>
internal sealed class PayrollService(PayrollDbContext db, IEmployeeDirectory dir, IAttendanceReports attendance, IWorkCalendar calendar,
    ILeaveCalendar leave, ISalaryLookup salaries, IFieldEncryptor enc, IOptions<OfficeSettings> office, TimeProvider clock)
{
    private static readonly HashSet<string> AttendedStatuses = ["Present", "Working", "MissingCheckout"];

    public DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), TimeZoneInfo.FindSystemTimeZoneById(office.Value.TimeZone)).DateTime);

    /// <summary>Bộ thông số có hiệu lực mới nhất ≤ ngày 1 của tháng (không có → bộ sớm nhất).</summary>
    public async Task<(PayrollSettings Row, PayrollRules Rules)> RulesForAsync(DateOnly month, CancellationToken ct)
    {
        var row = await db.Settings.AsNoTracking().Where(s => s.EffectiveFrom <= month).OrderByDescending(s => s.EffectiveFrom).FirstOrDefaultAsync(ct)
                  ?? await db.Settings.AsNoTracking().OrderBy(s => s.EffectiveFrom).FirstAsync(ct);
        return (row, JsonSerializer.Deserialize<PayrollRules>(row.RulesJson, PayrollDbContext.Json) ?? new PayrollRules());
    }

    public PayslipData Read(Payslip p) => JsonSerializer.Deserialize<PayslipData>(enc.Decrypt(p.DataEncrypted), PayrollDbContext.Json)!;
    public decimal Amount(PayAdjustment a) => enc.DecryptDecimal(a.AmountEncrypted) ?? 0;
    public string EncryptAmount(decimal v) => enc.EncryptDecimal(v)!;

    /// <summary>Tính lại toàn bộ phiếu của kỳ (chỉ kỳ Draft). Nhân viên làm việc ít nhất một ngày trong tháng đều có phiếu.</summary>
    public async Task<int> ComputeAsync(PayPeriod period, CancellationToken ct)
    {
        var (settingsRow, slips) = await BuildAsync(period.Month, period.Id, null, ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct); // xoá phiếu cũ + ghi phiếu mới: cùng thành công hoặc cùng huỷ
        await db.Payslips.Where(p => p.PeriodId == period.Id).ExecuteDeleteAsync(ct);
        var now = clock.GetUtcNow();
        foreach (var (employeeId, data) in slips)
            db.Payslips.Add(new Payslip
            {
                PeriodId = period.Id, EmployeeId = employeeId, ComputedAt = now,
                DataEncrypted = enc.Encrypt(JsonSerializer.Serialize(data, PayrollDbContext.Json)),
            });
        period.ComputedAt = now;
        period.SettingsId = settingsRow.Id;
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return slips.Count;
    }

    /// <summary>
    /// Tính phiếu lương của tháng (không lưu). <paramref name="periodId"/> có → cộng / trừ các khoản HR đã nhập cho kỳ đó.
    /// <paramref name="only"/> có → chỉ tính những nhân viên này (ước tính chi phí nhân công dự án).
    /// <paramref name="assumeFullAttendance"/> = true → coi như hưởng lương đủ công chuẩn (ước tính tháng đang chạy theo lương hợp đồng, không để
    /// các ngày CHƯA tới bị tính là "không hưởng lương" → mất bảo hiểm). Bảng lương thật luôn false.
    /// </summary>
    public async Task<(PayrollSettings Settings, List<(Guid EmployeeId, PayslipData Data)> Slips)> BuildAsync(DateOnly month, Guid? periodId,
        IReadOnlyCollection<Guid>? only, CancellationToken ct, bool assumeFullAttendance = false)
    {
        var from = new DateOnly(month.Year, month.Month, 1);
        var to = from.AddMonths(1).AddDays(-1);
        var (settingsRow, rules) = await RulesForAsync(from, ct);
        var employees = (await dir.ListEmployedAsync(from, to, ct)).DistinctBy(e => e.Id).ToList();
        if (only is not null) employees = employees.Where(e => only.Contains(e.Id)).ToList();
        var ids = employees.Select(e => e.Id).ToList();
        var result = new List<(Guid, PayslipData)>();
        if (ids.Count == 0) return (settingsRow, result);

        var timesheets = await attendance.MonthAsync(ids, from, ct);
        var paidLeave = (await leave.GetApprovedAsync(ids, from, to, ct)).Where(l => l.IsPaid)
            .GroupBy(l => (l.EmployeeId, l.Date)).ToDictionary(g => g.Key, g => Math.Min(1m, g.Sum(x => x.Fraction)));
        var overtime = (await attendance.ApprovedOvertimeAsync(ids, from, to, ct)).ToLookup(o => o.EmployeeId);
        var profiles = await db.Profiles.AsNoTracking().Where(p => ids.Contains(p.EmployeeId)).ToDictionaryAsync(p => p.EmployeeId, ct);
        var adjustments = periodId is { } pid
            ? (await db.Adjustments.AsNoTracking().Where(a => a.PeriodId == pid).ToListAsync(ct)).ToLookup(a => a.EmployeeId)
            : Array.Empty<PayAdjustment>().ToLookup(a => a.EmployeeId);

        // Lương tại ngày cuối kỳ (người nghỉ giữa tháng: ngày nghỉ việc)
        var asOf = employees.ToDictionary(e => e.Id, e => e.LeftAt is { } l && l < to ? l : to);
        var salaryByEmp = new Dictionary<Guid, SalaryInfo>();
        foreach (var g in asOf.GroupBy(kv => kv.Value))
            foreach (var (k, v) in await salaries.GetAsync(g.Select(x => x.Key).ToList(), g.Key, ct)) salaryByEmp[k] = v;

        foreach (var e in employees)
        {
            var scheduled = (await calendar.ScheduledDatesAsync(e.Id, from, to, ct)).ToHashSet();
            var working = (await calendar.WorkingDaysAsync(e.Id, from, to, ct)).ToHashSet();
            var days = timesheets.GetValueOrDefault(e.Id)?.Days ?? [];
            var facts = days.Select(d => new DayFacts(d.Date, d.Status != "NotEmployed", working.Contains(d.Date),
                scheduled.Contains(d.Date) && !working.Contains(d.Date), AttendedStatuses.Contains(d.Status), d.LeaveFraction,
                paidLeave.GetValueOrDefault((e.Id, d.Date))));
            var sal = salaryByEmp.GetValueOrDefault(e.Id);
            var probation = sal?.ContractType == "Probation";
            var profile = profiles.GetValueOrDefault(e.Id);
            var input = new PayInput(sal?.Salary, sal?.Allowance, scheduled.Count, assumeFullAttendance ? scheduled.Count : PayrollCalculator.PaidDays(facts),
                overtime[e.Id].Select(o => new OvertimeInput(o.WorkDate, o.Minutes, o.Percent)).ToList(),
                adjustments[e.Id].Select(a => new AdjustmentInput(a.Label, Amount(a), a.Taxable)).ToList(),
                Insured: profile?.Insured ?? !probation, FlatTax: probation, Dependents: profile?.Dependents ?? 0);
            var data = PayrollCalculator.Compute(input, rules) with
            {
                EmployeeCode = e.Code, FullName = e.FullName, DepartmentName = e.DepartmentName,
                ContractNumber = sal?.ContractNumber, ContractType = sal?.ContractType,
            };
            if (from.AddMonths(1) > Today)
                data = data with { Warnings = [.. data.Warnings, "Kỳ lương chưa kết thúc — công tính tới hôm nay"] };
            result.Add((e.Id, data));
        }
        return (settingsRow, result);
    }
}
