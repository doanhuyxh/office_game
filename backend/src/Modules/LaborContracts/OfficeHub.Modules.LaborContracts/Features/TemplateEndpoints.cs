using System.Security.Claims;
using DocumentFormat.OpenXml.Packaging;
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
using OfficeHub.BuildingBlocks.Documents;

namespace OfficeHub.Modules.LaborContracts.Features;

public sealed record TemplateFieldDto(string Name, string Description, string Example);
/// <param name="UnknownFields">Trường có trong file nhưng hệ thống không hỗ trợ — sẽ giữ nguyên khi xuất.</param>
public sealed record TemplateDto(Guid Id, string Name, string? ContractType, string FileName, long? FileSize, IReadOnlyList<string> Fields,
    IReadOnlyList<string> UnknownFields, DateTimeOffset CreatedAt, string? CreatedByName);

/// <summary>Mẫu hợp đồng Word (HR): tải mẫu .docx có {{Truong}} lên, xuất hợp đồng đã điền để in / ký. Hợp đồng đã ký vẫn tải lên ở mục file của hợp đồng.</summary>
internal static class TemplateEndpoints
{
    public const string DocxType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    public const long MaxBytes = 5 * 1024 * 1024;

    public static void Map(RouteGroupBuilder g)
    {
        var t = g.MapGroup("/templates").RequireAuthorization(AuthPolicies.Hr);
        t.MapGet("/fields", () => TypedResults.Ok(ContractFields.All.Select(f => new TemplateFieldDto(f.Name, f.Description, f.Example)).ToList()));
        t.MapGet("/", ListAsync);
        t.MapPost("/", UploadAsync).DisableAntiforgery();
        t.MapGet("/{id:guid}/file", FileUrlAsync);
        t.MapDelete("/{id:guid}", DeleteAsync);
        g.MapGet("/{id:guid}/generate", GenerateAsync).RequireAuthorization(AuthPolicies.Hr);
    }

    private static TemplateDto ToDto(ContractTemplate t) => new(t.Id, t.Name, t.ContractType?.ToString(), t.File.Name ?? "", t.File.Size, t.Fields,
        t.Fields.Where(f => !ContractFields.Names.Contains(f)).ToList(), t.CreatedAt, t.CreatedByName);

    private static async Task<Ok<List<TemplateDto>>> ListAsync(ContractsDbContext db, CancellationToken ct) =>
        TypedResults.Ok((await db.Templates.AsNoTracking().OrderBy(t => t.Name).ToListAsync(ct)).Select(ToDto).ToList());

    /// <summary>multipart: file (.docx ≤ 5 MB), name, contractType (tuỳ chọn: Indefinite | Fixed | Probation).</summary>
    private static async Task<Results<Ok<TemplateDto>, ValidationProblem>> UploadAsync(IFormFile? file, [Microsoft.AspNetCore.Mvc.FromForm] string? name,
        [Microsoft.AspNetCore.Mvc.FromForm] string? contractType, ClaimsPrincipal user, ContractsDbContext db, IFileStorage storage, TimeProvider clock,
        CancellationToken ct)
    {
        var v = new Validation().Required(name, "name", "Tên mẫu").MaxLength(name?.Trim(), 200, "name", "Tên mẫu");
        ContractType? type = null;
        if (!string.IsNullOrWhiteSpace(contractType))
        {
            if (Enum.TryParse<ContractType>(contractType, true, out var ty)) type = ty;
            else v.Add("contractType", "Loại hợp đồng không hợp lệ");
        }
        if (file is null || file.Length == 0) v.Add("file", "Chọn file mẫu .docx");
        else if (!file.FileName.EndsWith(".docx", StringComparison.OrdinalIgnoreCase)) v.Add("file", "Chỉ nhận file Word .docx (file .doc cũ: mở bằng Word rồi Lưu thành .docx)");
        else if (file.Length > MaxBytes) v.Add("file", "File mẫu tối đa 5 MB");
        if (v.Failed) return v.Problem();

        using var ms = new MemoryStream();
        await file!.CopyToAsync(ms, ct);
        IReadOnlyList<string> fields;
        try { ms.Position = 0; fields = DocxTemplate.ScanFields(ms); }
        catch (Exception e) when (e is OpenXmlPackageException or InvalidDataException or System.IO.FileFormatException)
        {
            return v.Add("file", "File không mở được như tài liệu Word .docx").Problem();
        }
        if (fields.Count == 0) return v.Add("file", "Không thấy trường nào dạng {{HoTen}} trong mẫu").Problem();

        var t = new ContractTemplate
        {
            Name = name!.Trim(),
            ContractType = type,
            Fields = [.. fields],
            CreatedAt = clock.GetUtcNow(),
            CreatedByName = user.FindFirstValue(ClaimNames.FullName),
        };
        var key = $"contract-templates/{t.Id}.docx";
        ms.Position = 0;
        await storage.UploadAsync(key, ms, DocxType, ct);
        t.File = new StoredFile { Key = key, Name = Path.GetFileName(file.FileName), ContentType = DocxType, Size = file.Length };
        db.Templates.Add(t);
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(ToDto(t));
    }

    private static async Task<Results<Ok<FileUrlDto>, NotFound>> FileUrlAsync(Guid id, ContractsDbContext db, IFileStorage storage, CancellationToken ct)
    {
        var t = await db.Templates.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (t?.File.Key is not { } key) return TypedResults.NotFound();
        return TypedResults.Ok(new FileUrlDto(await storage.GetDownloadUrlAsync(key), t.File.Name ?? "mau.docx"));
    }

    private static async Task<Results<NoContent, NotFound>> DeleteAsync(Guid id, ContractsDbContext db, IFileStorage storage, CancellationToken ct)
    {
        var t = await db.Templates.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (t is null) return TypedResults.NotFound();
        db.Templates.Remove(t);
        await db.SaveChangesAsync(ct);
        if (t.File.Key is { } key) { try { await storage.DeleteAsync(key, ct); } catch { /* file mồ côi trên S3 không ảnh hưởng nghiệp vụ */ } }
        return TypedResults.NoContent();
    }

    /// <summary>Xuất hợp đồng đã điền (.docx) — không lưu lại; HR in, ký rồi tải bản đã ký vào mục file của hợp đồng.</summary>
    private static async Task<Results<FileContentHttpResult, NotFound, ProblemHttpResult>> GenerateAsync(Guid id, Guid templateId, ContractsDbContext db,
        IEmployeeDirectory dir, IFieldEncryptor enc, IFileStorage storage, IOptions<OfficeSettings> office, TimeProvider clock, CancellationToken ct)
    {
        var c = await db.Contracts.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        var t = await db.Templates.AsNoTracking().FirstOrDefaultAsync(x => x.Id == templateId, ct);
        if (c is null || t?.File.Key is not { } key) return TypedResults.NotFound();
        if (await dir.GetProfileAsync(c.EmployeeId, ct) is not { } p)
            return TypedResults.Problem("Không tìm thấy hồ sơ nhân viên của hợp đồng", statusCode: StatusCodes.Status409Conflict);

        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), TimeZoneInfo.FindSystemTimeZoneById(office.Value.TimeZone)).DateTime);
        var values = ContractFields.Values(new ContractFields.Source(p.Employee.FullName, p.Employee.Code, p.DateOfBirth, p.Email, p.Phone,
            p.Employee.DepartmentName, p.PositionName, c.Number, c.Type, c.SignedDate, c.StartDate, c.EndDate, c.JobTitle,
            enc.DecryptDecimal(c.SalaryEncrypted), enc.DecryptDecimal(c.AllowanceEncrypted), today,
            p.IdNumber, p.IdIssuedOn, p.IdIssuedPlace, p.PermanentAddress, p.CurrentAddress));
        await using var src = await storage.OpenReadAsync(key, ct);
        var bytes = DocxTemplate.Fill(src, values);
        var fileName = $"{c.Number}-{p.Employee.Code}.docx".Replace('/', '-').Replace('\\', '-');
        return TypedResults.File(bytes, DocxType, fileName);
    }
}
