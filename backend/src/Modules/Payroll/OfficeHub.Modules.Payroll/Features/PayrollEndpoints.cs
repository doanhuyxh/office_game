using System.Globalization;
using System.Security.Claims;
using System.Text.Json;
using ClosedXML.Excel;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Organization.Contracts;
using OfficeHub.Modules.Payroll.Domain;
using OfficeHub.Modules.Payroll.Infrastructure;

namespace OfficeHub.Modules.Payroll.Features;

public sealed record SettingsDto(Guid Id, DateOnly EffectiveFrom, PayrollRules Rules, DateTimeOffset CreatedAt, string? CreatedByName);
public sealed record SaveSettingsRequest(DateOnly EffectiveFrom, PayrollRules Rules);
public sealed record ProfileDto(Guid EmployeeId, string Code, string FullName, string? DepartmentName, int Dependents, bool? Insured, string? TaxCode, string? Note);
public sealed record SaveProfileRequest(int Dependents, bool? Insured, string? TaxCode, string? Note);
public sealed record PeriodDto(Guid Id, string Month, string Status, DateTimeOffset CreatedAt, DateTimeOffset? ComputedAt, DateTimeOffset? LockedAt,
    string? LockedByName, int Employees, decimal TotalGross, decimal TotalNet, decimal TotalTax, decimal TotalEmployeeInsurance, decimal TotalEmployerCost);
public sealed record AdjustmentDto(Guid Id, Guid EmployeeId, string Label, decimal Amount, bool Taxable, string? CreatedByName);
public sealed record PayslipDto(Guid Id, Guid EmployeeId, PayslipData Data, IReadOnlyList<AdjustmentDto> Adjustments);
public sealed record PeriodDetailDto(PeriodDto Period, IReadOnlyList<PayslipDto> Payslips);
public sealed record CreatePeriodRequest(string Month);
public sealed record CreateAdjustmentRequest(Guid EmployeeId, string Label, decimal Amount, bool Taxable);
public sealed record MyPayslipDto(Guid PeriodId, string Month, PayslipData Data);

/// <summary>
/// Bảng lương. HR: thông số luật, hồ sơ thuế, kỳ lương (tính / khoản cộng trừ / chốt / mở lại / Excel).
/// Nhân viên: chỉ phiếu lương ĐÃ CHỐT của chính mình. Không có trong danh sách route của token AI.
/// </summary>
internal static class PayrollEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        var hr = g.MapGroup("").RequireAuthorization(AuthPolicies.Hr);
        hr.MapGet("/settings", SettingsAsync);
        hr.MapPost("/settings", SaveSettingsAsync);
        hr.MapGet("/profiles", ProfilesAsync);
        hr.MapPut("/profiles/{employeeId:guid}", SaveProfileAsync);
        hr.MapGet("/periods", PeriodsAsync);
        hr.MapPost("/periods", CreatePeriodAsync);
        hr.MapGet("/periods/{id:guid}", PeriodAsync);
        hr.MapPost("/periods/{id:guid}/compute", ComputeAsync);
        hr.MapPost("/periods/{id:guid}/lock", LockAsync);
        hr.MapPost("/periods/{id:guid}/unlock", UnlockAsync);
        hr.MapGet("/periods/{id:guid}/export.xlsx", ExportAsync);
        hr.MapPost("/periods/{id:guid}/adjustments", AddAdjustmentAsync);
        hr.MapDelete("/adjustments/{id:guid}", DeleteAdjustmentAsync);

        g.MapGet("/my", MyAsync);
    }

    private static string? Actor(ClaimsPrincipal u) => u.FindFirstValue(ClaimNames.FullName);

    // ---------------- Thông số ----------------

    private static async Task<Ok<List<SettingsDto>>> SettingsAsync(PayrollDbContext db, CancellationToken ct) =>
        TypedResults.Ok((await db.Settings.AsNoTracking().OrderByDescending(s => s.EffectiveFrom).ToListAsync(ct))
            .Select(s => new SettingsDto(s.Id, s.EffectiveFrom, JsonSerializer.Deserialize<PayrollRules>(s.RulesJson, PayrollDbContext.Json)!, s.CreatedAt, s.CreatedByName))
            .ToList());

    /// <summary>Lưu bộ thông số mới (hoặc ghi đè bộ cùng ngày hiệu lực). Kỳ đã chốt không bị ảnh hưởng.</summary>
    private static async Task<Results<Ok<SettingsDto>, ValidationProblem>> SaveSettingsAsync(SaveSettingsRequest req, ClaimsPrincipal user,
        PayrollDbContext db, TimeProvider clock, CancellationToken ct)
    {
        var r = req.Rules;
        var v = new Validation()
            .When(r.BaseSalary <= 0 || r.RegionMinWage <= 0 || r.CapMultiplier <= 0, "rules", "Lương cơ sở, lương tối thiểu vùng, hệ số trần phải > 0")
            .When(new[] { r.EmployeeSocial, r.EmployeeHealth, r.EmployeeUnemployment, r.EmployerSocial, r.EmployerHealth, r.EmployerUnemployment, r.FlatTaxRate }
                .Any(x => x is < 0 or > 50), "rules", "Tỉ lệ % phải trong 0–50")
            .When(r.PersonalDeduction < 0 || r.DependentDeduction < 0, "rules", "Mức giảm trừ không được âm")
            .When(r.Brackets.Count == 0 || r.Brackets[^1].UpTo is not null, "rules", "Biểu thuế phải có bậc cuối không giới hạn")
            .When(r.Brackets.Zip(r.Brackets.Skip(1)).Any(p => p.First.UpTo is null || p.Second.UpTo is { } u && u <= p.First.UpTo), "rules", "Các bậc thuế phải tăng dần");
        if (v.Failed) return v.Problem();
        var row = await db.Settings.FirstOrDefaultAsync(s => s.EffectiveFrom == req.EffectiveFrom, ct);
        if (row is null) db.Settings.Add(row = new PayrollSettings { EffectiveFrom = req.EffectiveFrom });
        row.RulesJson = JsonSerializer.Serialize(r, PayrollDbContext.Json);
        row.CreatedAt = clock.GetUtcNow();
        row.CreatedByName = Actor(user);
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(new SettingsDto(row.Id, row.EffectiveFrom, r, row.CreatedAt, row.CreatedByName));
    }

    // ---------------- Hồ sơ thuế ----------------

    private static async Task<Ok<List<ProfileDto>>> ProfilesAsync(PayrollDbContext db, IEmployeeDirectory dir, CancellationToken ct)
    {
        var emps = await dir.ListActiveAsync(ct);
        var profiles = await db.Profiles.AsNoTracking().ToDictionaryAsync(p => p.EmployeeId, ct);
        return TypedResults.Ok(emps.Select(e => profiles.GetValueOrDefault(e.Id) is { } p
            ? new ProfileDto(e.Id, e.Code, e.FullName, e.DepartmentName, p.Dependents, p.Insured, p.TaxCode, p.Note)
            : new ProfileDto(e.Id, e.Code, e.FullName, e.DepartmentName, 0, null, null, null)).ToList());
    }

    private static async Task<Results<NoContent, NotFound, ValidationProblem>> SaveProfileAsync(Guid employeeId, SaveProfileRequest req,
        PayrollDbContext db, IEmployeeDirectory dir, TimeProvider clock, CancellationToken ct)
    {
        if (await dir.GetAsync(employeeId, ct) is null) return TypedResults.NotFound();
        var v = new Validation().When(req.Dependents is < 0 or > 20, "dependents", "Số người phụ thuộc 0–20")
            .MaxLength(req.TaxCode, 20, "taxCode", "Mã số thuế").MaxLength(req.Note, 500, "note", "Ghi chú");
        if (v.Failed) return v.Problem();
        var p = await db.Profiles.FirstOrDefaultAsync(x => x.EmployeeId == employeeId, ct);
        if (p is null) db.Profiles.Add(p = new EmployeePayProfile { EmployeeId = employeeId });
        p.Dependents = req.Dependents;
        p.Insured = req.Insured;
        p.TaxCode = string.IsNullOrWhiteSpace(req.TaxCode) ? null : req.TaxCode.Trim();
        p.Note = string.IsNullOrWhiteSpace(req.Note) ? null : req.Note.Trim();
        p.UpdatedAt = clock.GetUtcNow();
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    // ---------------- Kỳ lương ----------------

    private static PeriodDto ToDto(PayPeriod p, IReadOnlyList<PayslipData> slips) =>
        new(p.Id, p.Month.ToString("yyyy-MM", CultureInfo.InvariantCulture), p.Status.ToString(), p.CreatedAt, p.ComputedAt, p.LockedAt, p.LockedByName,
            slips.Count, slips.Sum(s => s.Gross), slips.Sum(s => s.Net), slips.Sum(s => s.Tax), slips.Sum(s => s.EmployeeInsurance), slips.Sum(s => s.EmployerCost));

    private static async Task<Ok<List<PeriodDto>>> PeriodsAsync(PayrollDbContext db, PayrollService svc, CancellationToken ct)
    {
        var periods = await db.Periods.AsNoTracking().OrderByDescending(p => p.Month).Take(36).ToListAsync(ct);
        var ids = periods.Select(p => p.Id).ToList();
        var slips = (await db.Payslips.AsNoTracking().Where(s => ids.Contains(s.PeriodId)).ToListAsync(ct)).ToLookup(s => s.PeriodId);
        return TypedResults.Ok(periods.Select(p => ToDto(p, slips[p.Id].Select(svc.Read).ToList())).ToList());
    }

    /// <summary>{ month: "yyyy-MM" } → tạo kỳ + tính bản nháp. Không tạo trước tháng hiện tại quá 1 tháng tới, không trùng tháng.</summary>
    private static async Task<Results<Ok<PeriodDto>, ValidationProblem, ProblemHttpResult>> CreatePeriodAsync(CreatePeriodRequest req, PayrollDbContext db,
        PayrollService svc, TimeProvider clock, CancellationToken ct)
    {
        if (!DateOnly.TryParseExact((req.Month ?? "") + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var month))
            return new Validation().Add("month", "Tháng phải có dạng yyyy-MM").Problem();
        var thisMonth = new DateOnly(svc.Today.Year, svc.Today.Month, 1);
        if (month > thisMonth) return new Validation().Add("month", "Chưa tới kỳ lương này").Problem();
        if (await db.Periods.AnyAsync(p => p.Month == month, ct)) return Problems.Conflict($"Kỳ lương {req.Month} đã có");
        var period = new PayPeriod { Month = month, Status = PeriodStatus.Draft, CreatedAt = clock.GetUtcNow() };
        db.Periods.Add(period);
        await db.SaveChangesAsync(ct);
        await svc.ComputeAsync(period, ct);
        return TypedResults.Ok(ToDto(period, (await db.Payslips.AsNoTracking().Where(s => s.PeriodId == period.Id).ToListAsync(ct)).Select(svc.Read).ToList()));
    }

    private static async Task<Results<Ok<PeriodDetailDto>, NotFound>> PeriodAsync(Guid id, PayrollDbContext db, PayrollService svc, CancellationToken ct)
    {
        var p = await db.Periods.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p is null) return TypedResults.NotFound();
        var rows = await db.Payslips.AsNoTracking().Where(s => s.PeriodId == id).ToListAsync(ct);
        var adj = (await db.Adjustments.AsNoTracking().Where(a => a.PeriodId == id).ToListAsync(ct)).ToLookup(a => a.EmployeeId);
        var slips = rows.Select(r => new PayslipDto(r.Id, r.EmployeeId, svc.Read(r),
                adj[r.EmployeeId].Select(a => new AdjustmentDto(a.Id, a.EmployeeId, a.Label, svc.Amount(a), a.Taxable, a.CreatedByName)).ToList()))
            .OrderBy(s => s.Data.EmployeeCode).ToList();
        return TypedResults.Ok(new PeriodDetailDto(ToDto(p, slips.Select(s => s.Data).ToList()), slips));
    }

    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> ComputeAsync(Guid id, PayrollDbContext db, PayrollService svc, CancellationToken ct)
    {
        var p = await db.Periods.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p is null) return TypedResults.NotFound();
        if (p.Status == PeriodStatus.Locked) return Problems.Conflict("Kỳ lương đã chốt — mở lại trước khi tính lại");
        await svc.ComputeAsync(p, ct);
        return TypedResults.NoContent();
    }

    /// <summary>Chốt: tính lại lần cuối rồi khoá; nhân viên thấy phiếu lương + nhận thông báo (chuông).</summary>
    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> LockAsync(Guid id, ClaimsPrincipal user, PayrollDbContext db,
        PayrollService svc, IEmployeeDirectory dir, INotifier notifier, TimeProvider clock, CancellationToken ct)
    {
        var p = await db.Periods.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p is null) return TypedResults.NotFound();
        if (p.Status == PeriodStatus.Locked) return Problems.Conflict("Kỳ lương đã chốt");
        if (p.Month.AddMonths(1) > svc.Today) return Problems.Conflict("Chỉ chốt được khi tháng đã kết thúc");
        await svc.ComputeAsync(p, ct);
        p.Status = PeriodStatus.Locked;
        p.LockedAt = clock.GetUtcNow();
        p.LockedByName = Actor(user);
        await db.SaveChangesAsync(ct);

        var empIds = await db.Payslips.AsNoTracking().Where(s => s.PeriodId == id).Select(s => s.EmployeeId).ToListAsync(ct);
        var users = new List<Guid>();
        foreach (var e in empIds) if ((await dir.GetAsync(e, ct))?.UserId is { } u) users.Add(u);
        if (users.Count > 0)
            await notifier.NotifyAsync(new NotificationRequest(users, NotificationCategories.PayslipReady, $"Phiếu lương tháng {p.Month:MM/yyyy}",
                "Phiếu lương của bạn đã có. Mở để xem chi tiết.", "/payslips", SendEmail: false), ct);
        return TypedResults.NoContent();
    }

    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> UnlockAsync(Guid id, PayrollDbContext db, CancellationToken ct)
    {
        var p = await db.Periods.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p is null) return TypedResults.NotFound();
        if (p.Status != PeriodStatus.Locked) return Problems.Conflict("Kỳ lương chưa chốt");
        p.Status = PeriodStatus.Draft;
        p.LockedAt = null;
        p.LockedByName = null;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private static async Task<Results<Ok<AdjustmentDto>, NotFound, ValidationProblem, ProblemHttpResult>> AddAdjustmentAsync(Guid id,
        CreateAdjustmentRequest req, ClaimsPrincipal user, PayrollDbContext db, PayrollService svc, TimeProvider clock, CancellationToken ct)
    {
        var p = await db.Periods.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p is null) return TypedResults.NotFound();
        if (p.Status == PeriodStatus.Locked) return Problems.Conflict("Kỳ lương đã chốt");
        var v = new Validation().Required(req.Label, "label", "Nội dung").MaxLength(req.Label, 200, "label", "Nội dung")
            .When(req.Amount == 0 || Math.Abs(req.Amount) > 10_000_000_000m, "amount", "Số tiền không hợp lệ")
            .When(!await db.Payslips.AnyAsync(s => s.PeriodId == id && s.EmployeeId == req.EmployeeId, ct), "employeeId", "Nhân viên không có trong kỳ lương");
        if (v.Failed) return v.Problem();
        var a = new PayAdjustment
        {
            PeriodId = id, EmployeeId = req.EmployeeId, Label = req.Label.Trim(), AmountEncrypted = svc.EncryptAmount(Math.Round(req.Amount, 0)),
            Taxable = req.Taxable, CreatedAt = clock.GetUtcNow(), CreatedByName = Actor(user),
        };
        db.Adjustments.Add(a);
        await db.SaveChangesAsync(ct);
        await svc.ComputeAsync(p, ct);
        return TypedResults.Ok(new AdjustmentDto(a.Id, a.EmployeeId, a.Label, svc.Amount(a), a.Taxable, a.CreatedByName));
    }

    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> DeleteAdjustmentAsync(Guid id, PayrollDbContext db, PayrollService svc, CancellationToken ct)
    {
        var a = await db.Adjustments.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a is null) return TypedResults.NotFound();
        var p = await db.Periods.FirstAsync(x => x.Id == a.PeriodId, ct);
        if (p.Status == PeriodStatus.Locked) return Problems.Conflict("Kỳ lương đã chốt");
        db.Adjustments.Remove(a);
        await db.SaveChangesAsync(ct);
        await svc.ComputeAsync(p, ct);
        return TypedResults.NoContent();
    }

    // ---------------- Nhân viên ----------------

    private static async Task<Results<Ok<List<MyPayslipDto>>, NotFound>> MyAsync(ClaimsPrincipal user, IEmployeeDirectory dir, PayrollDbContext db,
        PayrollService svc, CancellationToken ct)
    {
        if (user.IsAccessToken()) return TypedResults.NotFound(); // lương không qua kênh AI (route cũng bị chặn)
        if (user.GetUserId() is not { } uid || await dir.GetByUserIdAsync(uid, ct) is not { } me) return TypedResults.NotFound();
        var rows = await (from s in db.Payslips.AsNoTracking()
                          join p in db.Periods.AsNoTracking() on s.PeriodId equals p.Id
                          where s.EmployeeId == me.Id && p.Status == PeriodStatus.Locked
                          orderby p.Month descending
                          select new { s, p.Month, p.Id }).Take(24).ToListAsync(ct);
        return TypedResults.Ok(rows.Select(r => new MyPayslipDto(r.Id, r.Month.ToString("yyyy-MM", CultureInfo.InvariantCulture), svc.Read(r.s))).ToList());
    }

    // ---------------- Excel ----------------

    private static async Task<Results<FileContentHttpResult, NotFound>> ExportAsync(Guid id, PayrollDbContext db, PayrollService svc, CancellationToken ct)
    {
        var p = await db.Periods.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p is null) return TypedResults.NotFound();
        var slips = (await db.Payslips.AsNoTracking().Where(s => s.PeriodId == id).ToListAsync(ct)).Select(svc.Read).OrderBy(s => s.EmployeeCode).ToList();
        using var wb = new XLWorkbook();
        var ws = wb.AddWorksheet("Bảng lương");
        ws.Cell(1, 1).Value = $"Bảng lương tháng {p.Month:MM/yyyy} — {(p.Status == PeriodStatus.Locked ? $"đã chốt {p.LockedAt:dd/MM/yyyy}" : "BẢN NHÁP")}";
        ws.Cell(1, 1).Style.Font.SetBold().Font.SetFontSize(14);
        string[] head = ["Mã NV", "Họ tên", "Phòng ban", "Số HĐ", "Lương HĐ", "Phụ cấp HĐ", "Công chuẩn", "Công hưởng lương", "Lương theo công", "Phụ cấp theo công",
            "Tăng ca", "Khoản cộng/trừ chịu thuế", "Tổng thu nhập", "BHXH (NLĐ)", "BHYT (NLĐ)", "BHTN (NLĐ)", "Người phụ thuộc", "Thu nhập tính thuế", "Thuế TNCN",
            "Khoản không chịu thuế", "Thực lĩnh", "BH doanh nghiệp đóng", "Tổng chi phí", "Ghi chú"];
        for (var i = 0; i < head.Length; i++) ws.Cell(3, i + 1).Value = head[i];
        ws.Range(3, 1, 3, head.Length).Style.Font.SetBold().Fill.SetBackgroundColor(XLColor.FromHtml("#E2E8F0")).Alignment.SetWrapText();
        var r = 4;
        foreach (var s in slips)
        {
            object?[] v = [s.EmployeeCode, s.FullName, s.DepartmentName, s.ContractNumber, s.Salary, s.Allowance, s.StandardDays, s.PaidDays, s.BasePay, s.AllowancePay,
                s.OvertimePay, s.Adjustments.Where(a => a.Taxable).Sum(a => a.Amount), s.Gross, s.EmployeeSocial, s.EmployeeHealth, s.EmployeeUnemployment, s.Dependents,
                s.AssessableIncome, s.Tax, s.NonTaxableAdjustments, s.Net, s.EmployerInsurance, s.EmployerCost, string.Join("; ", s.Warnings)];
            for (var i = 0; i < v.Length; i++)
                ws.Cell(r, i + 1).Value = v[i] switch { null => Blank.Value, string x => x, int x => x, decimal x => x, _ => v[i]!.ToString() };
            r++;
        }
        ws.Cell(r, 2).Value = "Tổng";
        foreach (var col in new[] { 9, 10, 11, 12, 13, 14, 15, 16, 19, 20, 21, 22, 23 })
            ws.Cell(r, col).FormulaA1 = $"SUM({ws.Cell(4, col).Address}:{ws.Cell(r - 1, col).Address})";
        ws.Row(r).Style.Font.Bold = true;
        ws.Range(4, 5, r, 23).Style.NumberFormat.Format = "#,##0";
        ws.Range(4, 7, r, 8).Style.NumberFormat.Format = "0.##";
        ws.SheetView.Freeze(3, 2);
        ws.Columns(1, head.Length).AdjustToContents(3, Math.Max(3, r), 8, 30);
        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return TypedResults.File(ms.ToArray(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"bang-luong-{p.Month:yyyy-MM}.xlsx");
    }
}
