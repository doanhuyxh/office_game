using OfficeHub.Modules.Payroll.Contracts;

namespace OfficeHub.Modules.Payroll.Domain;

/// <summary>Một ngày trong kỳ để tính công hưởng lương.</summary>
/// <param name="Scheduled">Có ca và không phải ngày lễ (ngày phải đi làm).</param>
/// <param name="HolidayWithShift">Ngày lễ rơi vào ngày có ca → hưởng nguyên lương (Điều 112).</param>
/// <param name="Attended">Có chấm công (có mặt / đang làm / quên chấm ra).</param>
/// <param name="LeaveFraction">Phần ngày nghỉ phép đã duyệt (mọi loại).</param>
/// <param name="PaidLeaveFraction">Phần ngày nghỉ CÓ LƯƠNG đã duyệt.</param>
public sealed record DayFacts(DateOnly Date, bool Employed, bool Scheduled, bool HolidayWithShift, bool Attended, decimal LeaveFraction, decimal PaidLeaveFraction);

public sealed record OvertimeInput(DateOnly WorkDate, int Minutes, int Percent);
public sealed record AdjustmentInput(string Label, decimal Amount, bool Taxable);

public sealed record PayInput(decimal? Salary, decimal? Allowance, int StandardDays, decimal PaidDays, IReadOnlyList<OvertimeInput> Overtime,
    IReadOnlyList<AdjustmentInput> Adjustments, bool Insured, bool FlatTax, int Dependents);

public sealed record PayLine(string Label, decimal Amount, bool Taxable);

/// <summary>Phiếu lương (lưu mã hoá). Mọi số tiền đã làm tròn tới đồng.</summary>
public sealed record PayslipData
{
    public string EmployeeCode { get; init; } = "";
    public string FullName { get; init; } = "";
    public string? DepartmentName { get; init; }
    public string? ContractNumber { get; init; }
    public string? ContractType { get; init; }

    public decimal Salary { get; init; }
    public decimal Allowance { get; init; }
    public int StandardDays { get; init; }
    public decimal PaidDays { get; init; }
    public decimal HourlyWage { get; init; }

    public decimal BasePay { get; init; }
    public decimal AllowancePay { get; init; }
    public int OvertimeMinutes { get; init; }
    public decimal OvertimePay { get; init; }
    public decimal OvertimeTaxExempt { get; init; }
    public IReadOnlyList<PayLine> Adjustments { get; init; } = [];
    public decimal Gross { get; init; }

    public bool Insured { get; init; }
    public decimal InsuranceBase { get; init; }
    public decimal EmployeeSocial { get; init; }
    public decimal EmployeeHealth { get; init; }
    public decimal EmployeeUnemployment { get; init; }
    public decimal EmployeeInsurance { get; init; }
    public decimal EmployerSocial { get; init; }
    public decimal EmployerHealth { get; init; }
    public decimal EmployerUnemployment { get; init; }
    public decimal EmployerInsurance { get; init; }

    public decimal TaxableIncome { get; init; }
    public int Dependents { get; init; }
    public decimal Deductions { get; init; }
    public decimal AssessableIncome { get; init; }
    /// <summary>"progressive" (biểu lũy tiến) | "flat" (khấu trừ 10%) | "none".</summary>
    public string TaxMethod { get; init; } = "none";
    public decimal Tax { get; init; }

    public decimal NonTaxableAdjustments { get; init; }
    public decimal Net { get; init; }
    public decimal EmployerCost { get; init; }
    public IReadOnlyList<string> Warnings { get; init; } = [];
}

/// <summary>
/// Tính lương tháng theo luật VN — hàm thuần, test ở tests/OfficeHub.Modules.Payroll.Tests. Thông số trong <see cref="PayrollRules"/>.
/// 1. Công hưởng lương = ngày đi làm + nghỉ có lương + ngày lễ có ca (<see cref="PaidDays"/>).
/// 2. Lương theo công = lương HĐ × công / công chuẩn; phụ cấp tính theo cùng tỉ lệ.
/// 3. Tăng ca = giờ × lương giờ × hệ số (<see cref="PayRules"/>); phần vượt lương giờ bình thường miễn thuế.
/// 4. BH người lao động trên lương đóng BH (HĐ, có trần 20 × lương cơ sở / 20 × lương tối thiểu vùng) — không phụ thuộc số công.
/// 5. Thuế: lũy tiến trên (chịu thuế − BH − giảm trừ bản thân − người phụ thuộc); HĐ thử việc: khấu trừ thẳng 10% từ 2 triệu.
/// 6. Thực lĩnh = tổng thu nhập − BH − thuế ± khoản không chịu thuế.
/// </summary>
public static class PayrollCalculator
{
    public static decimal R(decimal v) => PayRules.RoundVnd(v);

    public static decimal PaidDays(IEnumerable<DayFacts> days) => days.Sum(d =>
        !d.Employed ? 0m
        : d.HolidayWithShift ? 1m
        : d.Scheduled ? Math.Min(1m, (d.Attended ? Math.Max(0m, 1m - d.LeaveFraction) : 0m) + d.PaidLeaveFraction)
        : 0m);

    /// <summary>Thuế lũy tiến từng phần trên thu nhập tính thuế tháng.</summary>
    public static decimal ProgressiveTax(decimal assessable, IReadOnlyList<TaxBracket> brackets)
    {
        if (assessable <= 0) return 0;
        decimal tax = 0, lower = 0;
        foreach (var b in brackets)
        {
            var upper = b.UpTo ?? decimal.MaxValue;
            if (assessable > lower) tax += (Math.Min(assessable, upper) - lower) * b.Rate / 100m;
            if (assessable <= upper) break;
            lower = upper;
        }
        return R(tax);
    }

    public static PayslipData Compute(PayInput i, PayrollRules r)
    {
        var warnings = new List<string>();
        var salary = i.Salary ?? 0;
        var allowance = i.Allowance ?? 0;
        if (i.Salary is null) warnings.Add("Không có hợp đồng / lương hiệu lực trong kỳ");
        if (i.StandardDays <= 0) warnings.Add("Không có ngày công chuẩn (chưa có lịch làm việc)");

        var ratio = i.StandardDays > 0 ? Math.Min(i.PaidDays, i.StandardDays) / i.StandardDays : 0m;
        var basePay = R(salary * ratio);
        var allowancePay = R(allowance * ratio);
        var hourly = PayRules.HourlyWage(salary, i.StandardDays) ?? 0;

        decimal otPay = 0, otNormal = 0;
        foreach (var o in i.Overtime)
        {
            otPay += o.Minutes / 60m * hourly * o.Percent / 100m;
            otNormal += o.Minutes / 60m * hourly;
        }
        otPay = R(otPay);
        var otExempt = r.OvertimePremiumTaxExempt ? R(otPay - otNormal) : 0;

        var taxableAdj = i.Adjustments.Where(a => a.Taxable).Sum(a => a.Amount);
        var nonTaxableAdj = i.Adjustments.Where(a => !a.Taxable).Sum(a => a.Amount);
        var gross = basePay + allowancePay + otPay + taxableAdj;

        // Bảo hiểm (trên lương hợp đồng, không theo số công) — trừ tháng nghỉ không lương ≥ UnpaidDaysNoInsurance ngày
        decimal insBase = 0, eS = 0, eH = 0, eU = 0, cS = 0, cH = 0, cU = 0;
        var unpaidDays = i.StandardDays - Math.Min(i.PaidDays, i.StandardDays);
        var insured = i.Insured && salary > 0;
        if (insured && i.StandardDays > 0 && r.UnpaidDaysNoInsurance > 0 && unpaidDays >= r.UnpaidDaysNoInsurance)
        {
            insured = false;
            warnings.Add($"Không hưởng lương {unpaidDays:0.##} ngày (≥ {r.UnpaidDaysNoInsurance}) — tháng này không đóng bảo hiểm");
        }
        if (insured)
        {
            insBase = salary + (r.InsuranceIncludesAllowance ? allowance : 0);
            var capSH = r.CapMultiplier * r.BaseSalary;
            var capU = r.CapMultiplier * r.RegionMinWage;
            var baseSH = Math.Min(insBase, capSH);
            var baseU = Math.Min(insBase, capU);
            if (insBase > capSH) warnings.Add($"Lương đóng BH vượt trần BHXH/BHYT ({capSH:#,##0} đ) — đóng theo trần");
            eS = R(baseSH * r.EmployeeSocial / 100m); eH = R(baseSH * r.EmployeeHealth / 100m); eU = R(baseU * r.EmployeeUnemployment / 100m);
            cS = R(baseSH * r.EmployerSocial / 100m); cH = R(baseSH * r.EmployerHealth / 100m); cU = R(baseU * r.EmployerUnemployment / 100m);
        }
        var empIns = eS + eH + eU;

        var taxable = Math.Max(0, gross - otExempt);
        decimal deductions = 0, assessable = 0, tax;
        string method;
        if (i.FlatTax)
        {
            method = taxable >= r.FlatTaxThreshold ? "flat" : "none";
            tax = method == "flat" ? R(taxable * r.FlatTaxRate / 100m) : 0;
            assessable = method == "flat" ? taxable : 0;
        }
        else
        {
            deductions = r.PersonalDeduction + Math.Max(0, i.Dependents) * r.DependentDeduction;
            assessable = Math.Max(0, taxable - empIns - deductions);
            tax = ProgressiveTax(assessable, r.Brackets);
            method = tax > 0 ? "progressive" : "none";
        }

        var net = gross - empIns - tax + nonTaxableAdj;
        if (net < 0) warnings.Add("Thực lĩnh âm — kiểm tra khoản trừ / ngày công");

        return new PayslipData
        {
            Salary = salary, Allowance = allowance, StandardDays = i.StandardDays, PaidDays = i.PaidDays, HourlyWage = R(hourly),
            BasePay = basePay, AllowancePay = allowancePay,
            OvertimeMinutes = i.Overtime.Sum(o => o.Minutes), OvertimePay = otPay, OvertimeTaxExempt = otExempt,
            Adjustments = i.Adjustments.Select(a => new PayLine(a.Label, a.Amount, a.Taxable)).ToList(),
            Gross = gross,
            Insured = insured, InsuranceBase = insBase,
            EmployeeSocial = eS, EmployeeHealth = eH, EmployeeUnemployment = eU, EmployeeInsurance = empIns,
            EmployerSocial = cS, EmployerHealth = cH, EmployerUnemployment = cU, EmployerInsurance = cS + cH + cU,
            TaxableIncome = taxable, Dependents = i.Dependents, Deductions = deductions, AssessableIncome = assessable, TaxMethod = method, Tax = tax,
            NonTaxableAdjustments = nonTaxableAdj,
            Net = net,
            EmployerCost = gross + cS + cH + cU,
            Warnings = warnings,
        };
    }
}
