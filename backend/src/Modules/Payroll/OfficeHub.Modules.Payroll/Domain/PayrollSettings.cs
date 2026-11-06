namespace OfficeHub.Modules.Payroll.Domain;

/// <summary>Một bậc thuế TNCN lũy tiến theo tháng: thu nhập tính thuế tới UpTo (null = không giới hạn) chịu Rate %.</summary>
public sealed record TaxBracket(decimal? UpTo, decimal Rate);

/// <summary>
/// Thông số tính lương theo luật VN — HR sửa được (luật đổi thường xuyên). Mỗi bản có EffectiveFrom; kỳ lương dùng bản mới nhất
/// có hiệu lực ≤ ngày 1 của tháng. GIÁ TRỊ MẶC ĐỊNH chỉ để khởi đầu — KẾ TOÁN PHẢI XÁC NHẬN trước khi chốt lương thật.
/// </summary>
public sealed record PayrollRules
{
    /// <summary>Lương cơ sở (trần BHXH, BHYT = 20 × giá trị này).</summary>
    public decimal BaseSalary { get; init; } = 2_340_000m;
    /// <summary>Lương tối thiểu vùng nơi công ty đặt trụ sở (trần BHTN = 20 × giá trị này).</summary>
    public decimal RegionMinWage { get; init; } = 5_310_000m;
    public decimal CapMultiplier { get; init; } = 20m;

    // Tỉ lệ đóng (%)
    public decimal EmployeeSocial { get; init; } = 8m;
    public decimal EmployeeHealth { get; init; } = 1.5m;
    public decimal EmployeeUnemployment { get; init; } = 1m;
    public decimal EmployerSocial { get; init; } = 17.5m;
    public decimal EmployerHealth { get; init; } = 3m;
    public decimal EmployerUnemployment { get; init; } = 1m;
    /// <summary>Lương đóng bảo hiểm gồm cả phụ cấp trên hợp đồng (phụ cấp lương theo Luật BHXH).</summary>
    public bool InsuranceIncludesAllowance { get; init; } = true;

    // Thuế TNCN
    public decimal PersonalDeduction { get; init; } = 15_500_000m;
    public decimal DependentDeduction { get; init; } = 6_200_000m;
    public IReadOnlyList<TaxBracket> Brackets { get; init; } =
        [new(10_000_000m, 5m), new(30_000_000m, 10m), new(60_000_000m, 20m), new(100_000_000m, 30m), new(null, 35m)];
    /// <summary>Hợp đồng thử việc (và HĐ dưới 3 tháng): khấu trừ thẳng FlatTaxRate % trên thu nhập chịu thuế từ FlatTaxThreshold.</summary>
    public decimal FlatTaxRate { get; init; } = 10m;
    public decimal FlatTaxThreshold { get; init; } = 2_000_000m;
    /// <summary>Phần tiền tăng ca cao hơn lương giờ bình thường được miễn thuế TNCN.</summary>
    public bool OvertimePremiumTaxExempt { get; init; } = true;
    /// <summary>Không làm việc và không hưởng lương từ N ngày làm việc trở lên trong tháng → tháng đó không đóng BHXH/BHYT/BHTN (Luật BHXH). 0 = tắt.</summary>
    public int UnpaidDaysNoInsurance { get; init; } = 14;
}

public sealed class PayrollSettings
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public DateOnly EffectiveFrom { get; set; }
    /// <summary>JSON của <see cref="PayrollRules"/>.</summary>
    public string RulesJson { get; set; } = "{}";
    public DateTimeOffset CreatedAt { get; set; }
    public string? CreatedByName { get; set; }
}

/// <summary>Thông tin thuế / bảo hiểm của nhân viên do HR nhập (không có = 0 người phụ thuộc, đóng BH theo loại HĐ).</summary>
[OfficeHub.BuildingBlocks.Auditing.Audited]
public sealed class EmployeePayProfile
{
    public Guid EmployeeId { get; set; }
    public int Dependents { get; set; }
    /// <summary>null = tự động (HĐ thử việc không đóng, còn lại đóng); true / false = HR chỉ định.</summary>
    public bool? Insured { get; set; }
    public string? TaxCode { get; set; }
    public string? Note { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public enum PeriodStatus { Draft = 0, Locked = 1 }

/// <summary>Kỳ lương tháng. Draft: tính lại được, HR thêm khoản cộng / trừ. Locked: phiếu lương cố định, nhân viên xem được.</summary>
[OfficeHub.BuildingBlocks.Auditing.Audited]
public sealed class PayPeriod
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    /// <summary>Ngày 1 của tháng.</summary>
    public DateOnly Month { get; set; }
    public PeriodStatus Status { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? ComputedAt { get; set; }
    public DateTimeOffset? LockedAt { get; set; }
    public string? LockedByName { get; set; }
    public Guid SettingsId { get; set; }
}

/// <summary>Phiếu lương: toàn bộ số liệu (JSON <see cref="PayslipData"/>) MÃ HOÁ AES-GCM như lương hợp đồng.</summary>
public sealed class Payslip
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid PeriodId { get; set; }
    public Guid EmployeeId { get; set; }
    public string DataEncrypted { get; set; } = "";
    public DateTimeOffset ComputedAt { get; set; }
}

/// <summary>Khoản cộng (thưởng, truy lĩnh…) / trừ (tạm ứng, phạt…) HR nhập cho một kỳ. Amount âm = trừ. Số tiền mã hoá.</summary>
[OfficeHub.BuildingBlocks.Auditing.Audited]
public sealed class PayAdjustment
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid PeriodId { get; set; }
    public Guid EmployeeId { get; set; }
    public string Label { get; set; } = "";
    public string AmountEncrypted { get; set; } = "";
    /// <summary>Có tính vào thu nhập chịu thuế không (thưởng: có; tạm ứng / hoàn ứng: không).</summary>
    public bool Taxable { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; }
    public string? CreatedByName { get; set; }
}
