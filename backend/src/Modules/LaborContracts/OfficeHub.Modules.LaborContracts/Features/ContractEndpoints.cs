using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.BuildingBlocks.Security;
using OfficeHub.BuildingBlocks.Storage;
using OfficeHub.Modules.LaborContracts.Domain;
using OfficeHub.Modules.LaborContracts.Infrastructure;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.LaborContracts.Features;

public sealed record EmployeeBrief(Guid Id, string Code, string FullName, string? DepartmentName, bool IsActive);
public sealed record FileDto(string Name, string? ContentType, long? Size);
public sealed record AmendmentDto(Guid Id, string Number, DateOnly EffectiveDate, string Content, decimal? Salary, decimal? Allowance, FileDto? File,
    DateTimeOffset CreatedAt);
/// <summary>status = Upcoming | Active | Expired | Terminated. currentSalary / currentAllowance: hiệu lực hôm nay (tính cả phụ lục).</summary>
public sealed record ContractDto(Guid Id, EmployeeBrief Employee, string Number, string Type, string Status, DateOnly? SignedDate, DateOnly StartDate,
    DateOnly? EndDate, DateOnly? TerminatedOn, string? TerminationReason, string? JobTitle, decimal? Salary, decimal? Allowance,
    decimal? CurrentSalary, decimal? CurrentAllowance, string? Note, int? DaysLeft, FileDto? File, IReadOnlyList<AmendmentDto> Amendments,
    DateTimeOffset CreatedAt);
/// <summary>type = "Indefinite" | "Fixed" | "Probation".</summary>
public sealed record UpsertContractRequest(Guid EmployeeId, string Number, string Type, DateOnly? SignedDate, DateOnly StartDate, DateOnly? EndDate,
    string? JobTitle, decimal? Salary, decimal? Allowance, string? Note);
public sealed record TerminateRequest(DateOnly TerminatedOn, string Reason);
public sealed record CreateAmendmentRequest(string Number, DateOnly EffectiveDate, string Content, decimal? Salary, decimal? Allowance);
public sealed record FileUrlDto(string Url, string Name);
public sealed record NextNumberDto(string Number);
/// <summary>Số hợp đồng theo từng nút lọc của FE + nhân viên đang làm chưa có hợp đồng hiệu lực.</summary>
public sealed record ContractSummaryDto(int All, int Active, int Expiring, int Ended, IReadOnlyList<EmployeeBrief> WithoutContract);

/// <summary>
/// Hợp đồng lao động. Quyền (chủ dự án chốt): HR/admin quản lý mọi hợp đồng; nhân viên chỉ XEM hợp đồng của chính mình (kể cả lương, file).
/// Quản lý không xem hợp đồng cấp dưới.
/// </summary>
internal static class ContractEndpoints
{
    private const decimal MaxMoney = 10_000_000_000m;

    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/", ListAsync).RequireAuthorization(AuthPolicies.Hr);
        g.MapGet("/summary", SummaryAsync).RequireAuthorization(AuthPolicies.Hr);
        g.MapGet("/next-number", NextNumberEndpointAsync).RequireAuthorization(AuthPolicies.Hr);
        g.MapGet("/my", MyAsync);
        g.MapGet("/{id:guid}", GetAsync);
        g.MapPost("/", CreateAsync).RequireAuthorization(AuthPolicies.Hr);
        g.MapPut("/{id:guid}", UpdateAsync).RequireAuthorization(AuthPolicies.Hr);
        g.MapPost("/{id:guid}/terminate", TerminateAsync).RequireAuthorization(AuthPolicies.Hr);
        g.MapDelete("/{id:guid}", DeleteAsync).RequireAuthorization(AuthPolicies.Hr);
        g.MapPost("/{id:guid}/amendments", AddAmendmentAsync).RequireAuthorization(AuthPolicies.Hr);
        g.MapDelete("/{id:guid}/amendments/{amendmentId:guid}", DeleteAmendmentAsync).RequireAuthorization(AuthPolicies.Hr);
        // Upload multipart: SameSite=Lax chặn POST chéo site kèm cookie (dự án chưa dùng antiforgery — xem business/README.md).
        g.MapPost("/{id:guid}/file", UploadFileAsync).RequireAuthorization(AuthPolicies.Hr).DisableAntiforgery();
        g.MapGet("/{id:guid}/file", FileUrlAsync);
        g.MapPost("/{id:guid}/amendments/{amendmentId:guid}/file", UploadAmendmentFileAsync).RequireAuthorization(AuthPolicies.Hr).DisableAntiforgery();
        g.MapGet("/{id:guid}/amendments/{amendmentId:guid}/file", AmendmentFileUrlAsync);
    }

    private static DateOnly Today(IOptions<OfficeSettings> office, TimeProvider clock) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), TimeZoneInfo.FindSystemTimeZoneById(office.Value.TimeZone)).DateTime);

    private static IQueryable<LaborContract> WithAmendments(ContractsDbContext db) => db.Contracts.Include(c => c.Amendments);

    // ---------- Đọc ----------

    /// <summary>HR: mọi hợp đồng (lọc theo nhân viên / trạng thái), mới nhất trước.</summary>
    /// <summary>
    /// HR: mọi hợp đồng. <c>status</c> = Upcoming | Active | Expired | Terminated; <c>filter</c> = all | active (đang + sắp hiệu lực) | expiring (Active, còn ≤ 30 ngày)
    /// | ended (hết hạn / chấm dứt); <c>search</c> = tên / mã nhân viên / số HĐ. Có <c>page</c> → trang (lọc + cắt ở DB, chỉ giải mã lương của trang); không → cả danh sách.
    /// </summary>
    private static async Task<Results<Ok<List<ContractDto>>, Ok<PagedResult<ContractDto>>>> ListAsync(Guid? employeeId, string? status, string? filter, string? search,
        int? page, int? pageSize, ContractsDbContext db, IEmployeeDirectory dir, IFieldEncryptor enc, IOptions<OfficeSettings> office, TimeProvider clock,
        CancellationToken ct)
    {
        var today = Today(office, clock);
        var q = WithAmendments(db).AsNoTracking();
        if (employeeId is { } eid) q = q.Where(c => c.EmployeeId == eid);
        q = ByStatus(ByFilter(q, filter, today), status, today);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim();
            var like = $"%{s}%";
            // Tên / mã nhân viên nằm ở module Organization (không JOIN chéo schema) → lọc id qua directory rồi đưa vào truy vấn.
            var ids = (await dir.ListEmployedAsync(DateOnly.MinValue, DateOnly.MaxValue, ct))
                .Where(e => e.FullName.Contains(s, StringComparison.OrdinalIgnoreCase) || e.Code.Contains(s, StringComparison.OrdinalIgnoreCase))
                .Select(e => e.Id).ToList();
            q = q.Where(c => EF.Functions.ILike(c.Number, like) || ids.Contains(c.EmployeeId));
        }
        var ordered = q.OrderByDescending(c => c.StartDate).ThenBy(c => c.Number);
        if (page is { } pg)
        {
            var paged = await ordered.ToPagedAsync(pg, pageSize, ct);
            return TypedResults.Ok(paged.With(await ToDtosAsync([.. paged.Items], dir, enc, today, ct)));
        }
        return TypedResults.Ok(await ToDtosAsync(await ordered.ToListAsync(ct), dir, enc, today, ct));
    }

    /// <summary>Cùng quy tắc với <see cref="ContractRules.Status"/> nhưng viết dạng truy vấn để lọc / đếm ở DB.</summary>
    private static IQueryable<LaborContract> ByStatus(IQueryable<LaborContract> q, string? status, DateOnly today) =>
        status?.ToLowerInvariant() switch
        {
            "active" => q.Where(c => c.TerminatedOn == null && c.StartDate <= today && (c.EndDate == null || c.EndDate >= today)),
            "upcoming" => q.Where(c => c.TerminatedOn == null && c.StartDate > today),
            "expired" => q.Where(c => c.TerminatedOn == null && c.EndDate != null && c.EndDate < today),
            "terminated" => q.Where(c => c.TerminatedOn != null),
            _ => q,
        };

    /// <summary>Nút lọc trên FE: active = Active + Upcoming; expiring = Active còn ≤ <see cref="ContractRules.RemindDays"/> ngày; ended = Expired + Terminated.</summary>
    private static IQueryable<LaborContract> ByFilter(IQueryable<LaborContract> q, string? filter, DateOnly today)
    {
        var soon = today.AddDays(ContractRules.RemindDays);
        return filter?.ToLowerInvariant() switch
        {
            "active" => q.Where(c => c.TerminatedOn == null && (c.EndDate == null || c.EndDate >= today)),
            "expiring" => q.Where(c => c.TerminatedOn == null && c.StartDate <= today && c.EndDate != null && c.EndDate >= today && c.EndDate <= soon),
            "ended" => q.Where(c => c.TerminatedOn != null || (c.EndDate != null && c.EndDate < today)),
            _ => q,
        };
    }

    private static async Task<Ok<ContractSummaryDto>> SummaryAsync(ContractsDbContext db, IEmployeeDirectory dir, IOptions<OfficeSettings> office,
        TimeProvider clock, CancellationToken ct)
    {
        var today = Today(office, clock);
        var q = db.Contracts.AsNoTracking();
        var covered = (await ByStatus(q, "active", today).Select(c => c.EmployeeId).Distinct().ToListAsync(ct)).ToHashSet();
        var without = (await dir.ListActiveAsync(ct)).Where(e => !covered.Contains(e.Id))
            .Select(e => new EmployeeBrief(e.Id, e.Code, e.FullName, e.DepartmentName, e.IsActive)).ToList();
        return TypedResults.Ok(new ContractSummaryDto(await q.CountAsync(ct), await ByFilter(q, "active", today).CountAsync(ct),
            await ByFilter(q, "expiring", today).CountAsync(ct), await ByFilter(q, "ended", today).CountAsync(ct), without));
    }

    private static async Task<Results<Ok<List<ContractDto>>, ProblemHttpResult>> MyAsync(ClaimsPrincipal user, ContractsDbContext db, IEmployeeDirectory dir,
        IFieldEncryptor enc, IOptions<OfficeSettings> office, TimeProvider clock, CancellationToken ct)
    {
        if (await MeAsync(user, dir, ct) is not { } me) return NoProfile();
        var rows = await WithAmendments(db).AsNoTracking().Where(c => c.EmployeeId == me.Id).OrderByDescending(c => c.StartDate).ToListAsync(ct);
        return TypedResults.Ok(await ToDtosAsync(rows, dir, enc, Today(office, clock), ct));
    }

    private static async Task<Results<Ok<ContractDto>, NotFound, ProblemHttpResult>> GetAsync(Guid id, ClaimsPrincipal user, ContractsDbContext db,
        IEmployeeDirectory dir, IFieldEncryptor enc, IOptions<OfficeSettings> office, TimeProvider clock, CancellationToken ct)
    {
        var c = await WithAmendments(db).AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (c is null) return TypedResults.NotFound();
        if (!await CanViewAsync(user, c, dir, ct)) return Forbidden();
        return TypedResults.Ok((await ToDtosAsync([c], dir, enc, Today(office, clock), ct))[0]);
    }

    // ---------- Ghi (HR) ----------

    private static async Task<Results<Ok<ContractDto>, ValidationProblem>> CreateAsync(UpsertContractRequest req, ContractsDbContext db,
        IEmployeeDirectory dir, IFieldEncryptor enc, IOptions<OfficeSettings> office, TimeProvider clock, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Number) && Enum.TryParse<ContractType>(req.Type, true, out var t) && Enum.IsDefined(t))
            req = req with { Number = await NextNumberAsync(db, t, Today(office, clock).Year, ct) }; // để trống = tự sinh
        if (await ValidateAsync(req, null, db, dir, ct) is { } problem) return problem;
        var c = new LaborContract { Number = req.Number.Trim(), CreatedAt = clock.GetUtcNow() };
        Apply(c, req, enc);
        db.Contracts.Add(c);
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok((await ToDtosAsync([c], dir, enc, Today(office, clock), ct))[0]);
    }

    private static async Task<Results<Ok<ContractDto>, NotFound, ValidationProblem>> UpdateAsync(Guid id, UpsertContractRequest req,
        ContractsDbContext db, IEmployeeDirectory dir, IFieldEncryptor enc, IOptions<OfficeSettings> office, TimeProvider clock, CancellationToken ct)
    {
        var c = await WithAmendments(db).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (c is null) return TypedResults.NotFound();
        if (await ValidateAsync(req, c, db, dir, ct) is { } problem) return problem;
        if (c.EndDate != req.EndDate) (c.Reminded30At, c.Reminded7At, c.Reminded3At, c.OverdueRemindedAt) = (null, null, null, null); // đổi hạn → nhắc lại theo hạn mới
        Apply(c, req, enc);
        c.UpdatedAt = clock.GetUtcNow();
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok((await ToDtosAsync([c], dir, enc, Today(office, clock), ct))[0]);
    }

    /// <summary>Gợi ý số hợp đồng kế tiếp (form "Thêm hợp đồng" điền sẵn, HR sửa được).</summary>
    private static async Task<Results<Ok<NextNumberDto>, ValidationProblem>> NextNumberEndpointAsync(string? type, ContractsDbContext db,
        IOptions<OfficeSettings> office, TimeProvider clock, CancellationToken ct)
    {
        if (!Enum.TryParse<ContractType>(type ?? nameof(ContractType.Fixed), true, out var t) || !Enum.IsDefined(t))
            return new Validation().Add("type", "Chọn loại hợp đồng").Problem();
        return TypedResults.Ok(new NextNumberDto(await NextNumberAsync(db, t, Today(office, clock).Year, ct)));
    }

    /// <summary>Tính cả hợp đồng đã xoá mềm để không cấp lại số cũ.</summary>
    private static async Task<string> NextNumberAsync(ContractsDbContext db, ContractType type, int year, CancellationToken ct)
    {
        var marker = $"/{year}/";
        var numbers = await db.Contracts.IgnoreQueryFilters().Where(c => c.Number.Contains(marker)).Select(c => c.Number).ToListAsync(ct);
        return ContractRules.FormatNumber(ContractRules.NextSeq(numbers, year), year, type);
    }

    private static void Apply(LaborContract c, UpsertContractRequest r, IFieldEncryptor enc)
    {
        c.EmployeeId = r.EmployeeId;
        c.Number = r.Number.Trim();
        c.Type = Enum.Parse<ContractType>(r.Type, true);
        c.SignedDate = r.SignedDate;
        c.StartDate = r.StartDate;
        c.EndDate = r.EndDate;
        c.JobTitle = Clean(r.JobTitle);
        c.SalaryEncrypted = enc.EncryptDecimal(r.Salary);
        c.AllowanceEncrypted = enc.EncryptDecimal(r.Allowance);
        c.Note = Clean(r.Note);
    }

    /// <summary>Thứ tự: field cơ bản → thời hạn theo loại → số HĐ trùng → trùng thời gian với hợp đồng khác của cùng nhân viên.</summary>
    private static async Task<ValidationProblem?> ValidateAsync(UpsertContractRequest r, LaborContract? self, ContractsDbContext db,
        IEmployeeDirectory dir, CancellationToken ct)
    {
        var v = new Validation()
            .Required(r.Number, "number", "Số hợp đồng").MaxLength(r.Number, 50, "number", "Số hợp đồng")
            .When(!Enum.TryParse<ContractType>(r.Type, true, out var type) || !Enum.IsDefined(type), "type", "Chọn loại hợp đồng")
            .When(r.StartDate == default, "startDate", "Ngày bắt đầu không được để trống")
            .MaxLength(r.JobTitle, 200, "jobTitle", "Chức danh").MaxLength(r.Note, 1000, "note", "Ghi chú")
            .When(r.Salary is < 0 or > MaxMoney, "salary", "Mức lương không hợp lệ")
            .When(r.Allowance is < 0 or > MaxMoney, "allowance", "Phụ cấp không hợp lệ");
        if (await dir.GetAsync(r.EmployeeId, ct) is null) v.Add("employeeId", "Chọn nhân viên");
        if (v.Failed) return v.Problem();
        foreach (var (field, message) in ContractRules.ValidateTerm(type, r.StartDate, r.EndDate)) v.Add(field, message);
        if (v.Failed) return v.Problem();

        var number = r.Number.Trim();
        if (await db.Contracts.AnyAsync(c => c.Number == number && c.Id != (self == null ? Guid.Empty : self.Id), ct))
            return v.Add("number", "Số hợp đồng đã tồn tại").Problem();
        var others = await db.Contracts.AsNoTracking()
            .Where(c => c.EmployeeId == r.EmployeeId && c.Id != (self == null ? Guid.Empty : self.Id)).ToListAsync(ct);
        var newEnd = ContractRules.EffectiveEnd(r.EndDate, self?.TerminatedOn);
        if (others.FirstOrDefault(o => ContractRules.Overlaps(r.StartDate, newEnd, o.StartDate, ContractRules.EffectiveEnd(o.EndDate, o.TerminatedOn))) is { } dup)
            return v.Add("startDate", $"Trùng thời gian với hợp đồng {dup.Number} ({dup.StartDate:dd/MM/yyyy} – {(ContractRules.EffectiveEnd(dup.EndDate, dup.TerminatedOn) is { } e ? e.ToString("dd/MM/yyyy") : "không thời hạn")})").Problem();
        return null;
    }

    private static async Task<Results<Ok<ContractDto>, NotFound, ValidationProblem, ProblemHttpResult>> TerminateAsync(Guid id, TerminateRequest req,
        ContractsDbContext db, IEmployeeDirectory dir, IFieldEncryptor enc, IOptions<OfficeSettings> office, TimeProvider clock, CancellationToken ct)
    {
        var c = await WithAmendments(db).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (c is null) return TypedResults.NotFound();
        if (c.TerminatedOn is not null) return Problems.Conflict("Hợp đồng đã chấm dứt");
        var v = new Validation()
            .Required(req.Reason, "reason", "Lý do").MaxLength(req.Reason, 500, "reason", "Lý do")
            .When(req.TerminatedOn < c.StartDate, "terminatedOn", "Ngày chấm dứt phải từ ngày bắt đầu hợp đồng")
            .When(c.EndDate is { } e && req.TerminatedOn > e, "terminatedOn", "Ngày chấm dứt phải trước ngày hết hạn (hết hạn thì không cần chấm dứt)");
        if (v.Failed) return v.Problem();
        c.TerminatedOn = req.TerminatedOn;
        c.TerminationReason = req.Reason.Trim();
        c.UpdatedAt = clock.GetUtcNow();
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok((await ToDtosAsync([c], dir, enc, Today(office, clock), ct))[0]);
    }

    /// <summary>Xoá mềm (nhập nhầm). File trên S3 giữ lại.</summary>
    private static async Task<Results<NoContent, NotFound>> DeleteAsync(Guid id, ContractsDbContext db, TimeProvider clock, CancellationToken ct)
    {
        var c = await db.Contracts.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (c is null) return TypedResults.NotFound();
        c.DeletedAt = clock.GetUtcNow();
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private static async Task<Results<Ok<ContractDto>, NotFound, ValidationProblem>> AddAmendmentAsync(Guid id, CreateAmendmentRequest req,
        ContractsDbContext db, IEmployeeDirectory dir, IFieldEncryptor enc, IOptions<OfficeSettings> office, TimeProvider clock, CancellationToken ct)
    {
        var c = await WithAmendments(db).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (c is null) return TypedResults.NotFound();
        var end = ContractRules.EffectiveEnd(c.EndDate, c.TerminatedOn);
        var v = new Validation()
            .Required(req.Number, "number", "Số phụ lục").MaxLength(req.Number, 50, "number", "Số phụ lục")
            .Required(req.Content, "content", "Nội dung").MaxLength(req.Content, 2000, "content", "Nội dung")
            .When(req.EffectiveDate < c.StartDate || (end is { } e && req.EffectiveDate > e), "effectiveDate", "Ngày hiệu lực phải nằm trong thời hạn hợp đồng")
            .When(req.Salary is < 0 or > MaxMoney, "salary", "Mức lương không hợp lệ")
            .When(req.Allowance is < 0 or > MaxMoney, "allowance", "Phụ cấp không hợp lệ");
        if (!v.Failed && c.Amendments.Any(a => a.Number == req.Number.Trim())) v.Add("number", "Số phụ lục đã có trong hợp đồng này");
        if (v.Failed) return v.Problem();
        db.Amendments.Add(new ContractAmendment
        {
            ContractId = c.Id, Number = req.Number.Trim(), EffectiveDate = req.EffectiveDate, Content = req.Content.Trim(),
            SalaryEncrypted = enc.EncryptDecimal(req.Salary), AllowanceEncrypted = enc.EncryptDecimal(req.Allowance), CreatedAt = clock.GetUtcNow(),
        });
        await db.SaveChangesAsync(ct);
        var fresh = await WithAmendments(db).AsNoTracking().FirstAsync(x => x.Id == id, ct);
        return TypedResults.Ok((await ToDtosAsync([fresh], dir, enc, Today(office, clock), ct))[0]);
    }

    private static async Task<Results<NoContent, NotFound>> DeleteAmendmentAsync(Guid id, Guid amendmentId, ContractsDbContext db, CancellationToken ct)
    {
        var a = await db.Amendments.FirstOrDefaultAsync(x => x.Id == amendmentId && x.ContractId == id, ct);
        if (a is null || !await db.Contracts.AnyAsync(c => c.Id == id, ct)) return TypedResults.NotFound();
        db.Amendments.Remove(a);
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    // ---------- File scan (S3) ----------

    private static async Task<Results<Ok<FileDto>, NotFound, ValidationProblem>> UploadFileAsync(Guid id, IFormFile file, ContractsDbContext db,
        IFileStorage storage, CancellationToken ct)
    {
        var c = await db.Contracts.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (c is null) return TypedResults.NotFound();
        if (CheckFile(file) is { } bad) return bad;
        await StoreAsync(c.File, $"contracts/{c.EmployeeId}/{c.Id}", file, storage, ct);
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(new FileDto(c.File.Name!, c.File.ContentType, c.File.Size));
    }

    private static async Task<Results<Ok<FileDto>, NotFound, ValidationProblem>> UploadAmendmentFileAsync(Guid id, Guid amendmentId, IFormFile file,
        ContractsDbContext db, IFileStorage storage, CancellationToken ct)
    {
        var c = await WithAmendments(db).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (c?.Amendments.FirstOrDefault(a => a.Id == amendmentId) is not { } a) return TypedResults.NotFound();
        if (CheckFile(file) is { } bad) return bad;
        await StoreAsync(a.File, $"contracts/{c.EmployeeId}/{c.Id}/amendments/{a.Id}", file, storage, ct);
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(new FileDto(a.File.Name!, a.File.ContentType, a.File.Size));
    }

    private static async Task<Results<Ok<FileUrlDto>, NotFound, ProblemHttpResult>> FileUrlAsync(Guid id, ClaimsPrincipal user, ContractsDbContext db,
        IEmployeeDirectory dir, IFileStorage storage, CancellationToken ct)
    {
        var c = await db.Contracts.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (c is null) return TypedResults.NotFound();
        if (!await CanViewAsync(user, c, dir, ct)) return Forbidden();
        if (c.File.Key is not { } key) return TypedResults.NotFound();
        return TypedResults.Ok(new FileUrlDto(await storage.GetDownloadUrlAsync(key), c.File.Name ?? "hop-dong"));
    }

    private static async Task<Results<Ok<FileUrlDto>, NotFound, ProblemHttpResult>> AmendmentFileUrlAsync(Guid id, Guid amendmentId, ClaimsPrincipal user,
        ContractsDbContext db, IEmployeeDirectory dir, IFileStorage storage, CancellationToken ct)
    {
        var c = await WithAmendments(db).AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (c is null) return TypedResults.NotFound();
        if (!await CanViewAsync(user, c, dir, ct)) return Forbidden();
        if (c.Amendments.FirstOrDefault(a => a.Id == amendmentId)?.File is not { Key: { } key } f) return TypedResults.NotFound();
        return TypedResults.Ok(new FileUrlDto(await storage.GetDownloadUrlAsync(key), f.Name ?? "phu-luc"));
    }

    private static ValidationProblem? CheckFile(IFormFile? file)
    {
        var v = new Validation();
        if (file is null || file.Length == 0) v.Add("file", "Chọn file");
        else if (!ContractRules.AllowedFiles.ContainsKey(file.ContentType)) v.Add("file", "Chỉ nhận file PDF, JPG, PNG");
        else if (file.Length > ContractRules.MaxFileBytes) v.Add("file", $"File tối đa {ContractRules.MaxFileBytes / 1024 / 1024} MB");
        return v.Failed ? v.Problem() : null;
    }

    /// <summary>Tải file mới lên trước, lưu thông tin, rồi xoá file cũ (best effort) — lỗi upload không làm mất file cũ.</summary>
    private static async Task StoreAsync(StoredFile target, string folder, IFormFile file, IFileStorage storage, CancellationToken ct)
    {
        var key = $"{folder}/{Guid.CreateVersion7()}{ContractRules.AllowedFiles[file.ContentType]}";
        await using (var s = file.OpenReadStream()) await storage.UploadAsync(key, s, file.ContentType, ct);
        var old = target.Key;
        (target.Key, target.Name, target.ContentType, target.Size) = (key, Path.GetFileName(file.FileName), file.ContentType, file.Length);
        if (old is not null) try { await storage.DeleteAsync(old, ct); } catch { /* giữ file cũ cũng không sao */ }
    }

    // ---------- Chung ----------

    private static async Task<EmployeeRef?> MeAsync(ClaimsPrincipal user, IEmployeeDirectory dir, CancellationToken ct) =>
        user.GetUserId() is { } uid ? await dir.GetByUserIdAsync(uid, ct) : null;

    /// <summary>HR / admin: mọi hợp đồng; nhân viên: chỉ hợp đồng của mình.</summary>
    private static async Task<bool> CanViewAsync(ClaimsPrincipal user, LaborContract c, IEmployeeDirectory dir, CancellationToken ct) =>
        user.IsHr() || (await MeAsync(user, dir, ct))?.Id == c.EmployeeId;

    private static async Task<List<ContractDto>> ToDtosAsync(List<LaborContract> rows, IEmployeeDirectory dir, IFieldEncryptor enc, DateOnly today,
        CancellationToken ct)
    {
        var people = new Dictionary<Guid, EmployeeBrief>();
        foreach (var id in rows.Select(r => r.EmployeeId).Distinct())
            people[id] = await dir.GetAsync(id, ct) is { } e ? new(e.Id, e.Code, e.FullName, e.DepartmentName, e.IsActive) : new(id, "?", "(không rõ)", null, false);
        return [.. rows.Select(c =>
        {
            var amendments = c.Amendments.OrderBy(a => a.EffectiveDate).ThenBy(a => a.CreatedAt)
                .Select(a => new AmendmentDto(a.Id, a.Number, a.EffectiveDate, a.Content, enc.DecryptDecimal(a.SalaryEncrypted),
                    enc.DecryptDecimal(a.AllowanceEncrypted), File(a.File), a.CreatedAt)).ToList();
            var salary = enc.DecryptDecimal(c.SalaryEncrypted);
            var allowance = enc.DecryptDecimal(c.AllowanceEncrypted);
            var status = ContractRules.Status(c.StartDate, c.EndDate, c.TerminatedOn, today);
            var end = ContractRules.EffectiveEnd(c.EndDate, c.TerminatedOn);
            return new ContractDto(c.Id, people[c.EmployeeId], c.Number, c.Type.ToString(), status.ToString(), c.SignedDate, c.StartDate, c.EndDate,
                c.TerminatedOn, c.TerminationReason, c.JobTitle, salary, allowance,
                ContractRules.EffectiveValue(salary, amendments.Select(a => (a.EffectiveDate, a.Salary)), today),
                ContractRules.EffectiveValue(allowance, amendments.Select(a => (a.EffectiveDate, a.Allowance)), today),
                c.Note, status == ContractStatus.Active && end is { } d ? d.DayNumber - today.DayNumber : null, File(c.File), amendments, c.CreatedAt);
        })];
    }

    private static FileDto? File(StoredFile f) => f.Key is null ? null : new FileDto(f.Name ?? "file", f.ContentType, f.Size);
    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
    private static ProblemHttpResult NoProfile() =>
        TypedResults.Problem("Tài khoản chưa gắn hồ sơ nhân viên", title: "no_employee_profile", statusCode: StatusCodes.Status409Conflict);
    private static ProblemHttpResult Forbidden() =>
        TypedResults.Problem("Bạn không có quyền xem hợp đồng này", statusCode: StatusCodes.Status403Forbidden);
}
