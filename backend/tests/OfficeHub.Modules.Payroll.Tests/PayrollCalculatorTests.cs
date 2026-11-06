using OfficeHub.Modules.Payroll.Domain;

namespace OfficeHub.Modules.Payroll.Tests;

/// <summary>Số liệu tính tay theo PayrollRules mặc định (lương cơ sở 2,34 tr, tối thiểu vùng I 5,31 tr, giảm trừ 15,5 tr / 6,2 tr, biểu 5 bậc).</summary>
public class PayrollCalculatorTests
{
    private static readonly PayrollRules Rules = new();
    private static PayInput In(decimal salary, decimal paid = 22, int std = 22, bool insured = true, bool flat = false, int dep = 0,
        decimal allowance = 0, OvertimeInput[]? ot = null, AdjustmentInput[]? adj = null) =>
        new(salary, allowance, std, paid, ot ?? [], adj ?? [], insured, flat, dep);

    [Fact]
    public void Standard_case_20m()
    {
        var p = PayrollCalculator.Compute(In(20_000_000), Rules);
        Assert.Equal(20_000_000, p.Gross);
        Assert.Equal((1_600_000m, 300_000m, 200_000m, 2_100_000m), (p.EmployeeSocial, p.EmployeeHealth, p.EmployeeUnemployment, p.EmployeeInsurance));
        Assert.Equal(2_400_000, p.AssessableIncome);     // 20 − 2,1 − 15,5
        Assert.Equal(120_000, p.Tax);                    // 5%
        Assert.Equal(17_780_000, p.Net);
        Assert.Equal(4_300_000, p.EmployerInsurance);    // 17,5% + 3% + 1%
        Assert.Equal(24_300_000, p.EmployerCost);
    }

    [Fact]
    public void Paid_days_prorate_salary_and_allowance_but_not_insurance()
    {
        var p = PayrollCalculator.Compute(In(20_000_000, paid: 11, allowance: 2_000_000), Rules);
        Assert.Equal(10_000_000, p.BasePay);
        Assert.Equal(1_000_000, p.AllowancePay);
        Assert.Equal(22_000_000, p.InsuranceBase);       // lương + phụ cấp, nguyên tháng
        Assert.Equal(2_310_000, p.EmployeeInsurance);
    }

    [Fact]
    public void Unpaid_14_days_or_more_skips_insurance_for_the_month()
    {
        var p = PayrollCalculator.Compute(In(20_000_000, paid: 8), Rules);   // 14 ngày không hưởng lương
        Assert.False(p.Insured);
        Assert.Equal(0, p.EmployeeInsurance);
        Assert.Equal(0, p.EmployerInsurance);
        Assert.Equal(7_272_727, p.Net);                  // 20 tr × 8/22, dưới mức giảm trừ → không thuế
        Assert.Contains(p.Warnings, w => w.Contains("không đóng bảo hiểm"));

        var zero = PayrollCalculator.Compute(In(20_000_000, paid: 0), Rules);
        Assert.Equal(0, zero.Net);                       // không còn thực lĩnh âm do trừ BH cả tháng
        Assert.DoesNotContain(zero.Warnings, w => w.Contains("Thực lĩnh âm"));

        Assert.True(PayrollCalculator.Compute(In(20_000_000, paid: 9), Rules).Insured);   // 13 ngày → vẫn đóng
        Assert.True(PayrollCalculator.Compute(In(20_000_000, paid: 0), Rules with { UnpaidDaysNoInsurance = 0 }).Insured); // 0 = tắt quy tắc
    }

    [Fact]
    public void Negative_net_is_flagged()
    {
        var p = PayrollCalculator.Compute(In(20_000_000, adj: [new AdjustmentInput("Trừ tạm ứng", -30_000_000, false)]), Rules);
        Assert.True(p.Net < 0);
        Assert.Contains(p.Warnings, w => w.Contains("Thực lĩnh âm"));
    }

    [Fact]
    public void High_salary_hits_insurance_caps_and_upper_brackets()
    {
        var p = PayrollCalculator.Compute(In(60_000_000), Rules);
        Assert.Equal(3_744_000, p.EmployeeSocial);       // 8% × 46,8 tr (20 × lương cơ sở)
        Assert.Equal(702_000, p.EmployeeHealth);
        Assert.Equal(600_000, p.EmployeeUnemployment);   // dưới trần 106,2 tr
        Assert.Equal(39_454_000, p.AssessableIncome);
        Assert.Equal(4_390_800, p.Tax);                  // 0,5 + 2 + 1,8908 tr
        Assert.Contains(p.Warnings, w => w.Contains("trần"));
    }

    [Fact]
    public void Dependents_reduce_tax_to_zero()
    {
        var p = PayrollCalculator.Compute(In(20_000_000, dep: 2), Rules);
        Assert.Equal(0, p.Tax);
        Assert.Equal("none", p.TaxMethod);
        Assert.Equal(27_900_000, p.Deductions);
    }

    [Fact]
    public void Probation_flat_10_percent_without_insurance()
    {
        var p = PayrollCalculator.Compute(In(10_000_000, insured: false, flat: true), Rules);
        Assert.Equal(0, p.EmployeeInsurance);
        Assert.Equal(("flat", 1_000_000m), (p.TaxMethod, p.Tax));
        Assert.Equal(9_000_000, p.Net);
        var small = PayrollCalculator.Compute(In(1_500_000, insured: false, flat: true), Rules);
        Assert.Equal(0, small.Tax);                      // dưới 2 triệu
    }

    [Fact]
    public void Overtime_premium_is_tax_exempt()
    {
        // 22 tr / 22 / 8 = 125.000 đ/giờ; 2 giờ × 150% = 375.000 (chịu thuế 250.000, miễn 125.000)
        var p = PayrollCalculator.Compute(In(22_000_000, ot: [new(new DateOnly(2026, 11, 3), 120, 150)]), Rules);
        Assert.Equal(125_000, p.HourlyWage);
        Assert.Equal(375_000, p.OvertimePay);
        Assert.Equal(125_000, p.OvertimeTaxExempt);
        Assert.Equal(22_375_000 - 125_000, p.TaxableIncome);
    }

    [Fact]
    public void Adjustments_taxable_in_gross_non_taxable_only_in_net()
    {
        var p = PayrollCalculator.Compute(In(20_000_000, adj: [new("Thưởng dự án", 2_000_000, true), new("Trừ tạm ứng", -3_000_000, false)]), Rules);
        Assert.Equal(22_000_000, p.Gross);
        Assert.Equal(-3_000_000, p.NonTaxableAdjustments);
        Assert.Equal(22_000_000 - 2_100_000 - p.Tax - 3_000_000, p.Net);
        Assert.Equal(220_000, p.Tax);                    // 4,4 tr × 5%
    }

    [Fact]
    public void Missing_contract_gives_zero_with_warning()
    {
        var p = PayrollCalculator.Compute(new PayInput(null, null, 22, 20, [], [], true, false, 0), Rules);
        Assert.Equal(0, p.Net);
        Assert.Contains(p.Warnings, w => w.Contains("hợp đồng"));
    }

    [Fact]
    public void Paid_days_rules()
    {
        var d = new DateOnly(2026, 11, 2);
        DayFacts F(bool emp = true, bool sch = true, bool hol = false, bool att = false, decimal leave = 0, decimal paid = 0) => new(d, emp, sch, hol, att, leave, paid);
        Assert.Equal(1m, PayrollCalculator.PaidDays([F(att: true)]));                         // đi làm
        Assert.Equal(0m, PayrollCalculator.PaidDays([F()]));                                  // vắng
        Assert.Equal(1m, PayrollCalculator.PaidDays([F(leave: 1, paid: 1)]));                 // nghỉ phép năm
        Assert.Equal(0m, PayrollCalculator.PaidDays([F(leave: 1)]));                          // nghỉ không lương
        Assert.Equal(1m, PayrollCalculator.PaidDays([F(att: true, leave: 0.5m, paid: 0.5m)])); // nửa ngày làm + nửa phép
        Assert.Equal(0.5m, PayrollCalculator.PaidDays([F(att: true, leave: 0.5m)]));           // nửa ngày nghỉ không lương
        Assert.Equal(1m, PayrollCalculator.PaidDays([F(sch: false, hol: true)]));             // lễ có ca
        Assert.Equal(0m, PayrollCalculator.PaidDays([F(sch: false, att: true)]));             // ngày nghỉ tuần (tăng ca tính riêng)
        Assert.Equal(0m, PayrollCalculator.PaidDays([F(emp: false, att: true)]));             // ngoài thời gian làm việc
    }

    [Theory]
    [InlineData(0, 0)]
    [InlineData(10_000_000, 500_000)]                // 10 tr × 5%
    [InlineData(30_000_000, 2_500_000)]              // 0,5 + 20 tr × 10%
    [InlineData(120_000_000, 27_500_000)]            // 0,5 + 2 + 6 + 12 + 20 tr × 35%
    public void Progressive_tax_brackets(decimal assessable, decimal expected) =>
        Assert.Equal(expected, PayrollCalculator.ProgressiveTax(assessable, Rules.Brackets));
}
