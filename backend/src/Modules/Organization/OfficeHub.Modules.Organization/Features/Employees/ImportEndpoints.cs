using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Organization.Domain;
using OfficeHub.Modules.Organization.Infrastructure;

namespace OfficeHub.Modules.Organization.Features.Employees;

/// <param name="Code">Mã sẽ dùng (đã tự cấp nếu file để trống).</param>
public sealed record ImportRowDto(int Row, string? Code, string? FullName, string? Email, string? Phone, DateOnly? DateOfBirth,
    string? DepartmentName, string? PositionName, string? JobTitle, string? ManagerCode, string? ManagerName, DateOnly? JoinedAt, string Status, IReadOnlyList<string> Errors);
public sealed record ImportPreviewDto(IReadOnlyList<ImportRowDto> Rows, int ValidCount, int ErrorCount, string? FileError);
public sealed record ImportResultDto(int Created, IReadOnlyList<string> Codes);

/// <summary>
/// Nhập nhân viên từ Excel (HR): tải mẫu → xem trước (lỗi từng dòng) → nhập. Có lỗi ở bất kỳ dòng nào thì không nhập dòng nào.
/// Dùng chung quy tắc với form thêm nhân viên (<see cref="EmployeeEndpoints.ValidateAsync"/>). Chỉ tạo hồ sơ — cấp tài khoản làm riêng.
/// </summary>
internal static class ImportEndpoints
{
    private const long MaxBytes = 5 * 1024 * 1024;
    private const string XlsxType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    public static void Map(RouteGroupBuilder org)
    {
        var g = org.MapGroup("/employees").WithTags("Organization").RequireAuthorization(AuthPolicies.Hr);
        g.MapGet("/import-template", TemplateAsync);
        g.MapPost("/import/preview", PreviewAsync).DisableAntiforgery();
        g.MapPost("/import", ImportAsync).DisableAntiforgery();
    }

    private static async Task<FileContentHttpResult> TemplateAsync(OrgDbContext db, CancellationToken ct)
    {
        var deps = await db.Departments.AsNoTracking().OrderBy(d => d.SortOrder).ThenBy(d => d.Name).Select(d => d.Name).ToListAsync(ct);
        var pos = await db.Positions.AsNoTracking().OrderBy(p => p.Level).ThenBy(p => p.SortOrder).ThenBy(p => p.Name).Select(p => p.Name).ToListAsync(ct);
        return TypedResults.File(EmployeeImportSheet.Template(deps, pos), XlsxType, "mau-nhap-nhan-vien.xlsx");
    }

    private static async Task<Results<Ok<ImportPreviewDto>, ValidationProblem>> PreviewAsync(IFormFile? file, OrgDbContext db, CancellationToken ct)
    {
        if (CheckFile(file) is { } bad) return bad;
        var (preview, _) = await AnalyzeAsync(file!, db, ct);
        return TypedResults.Ok(preview);
    }

    private static async Task<Results<Ok<ImportResultDto>, BadRequest<ImportPreviewDto>, ValidationProblem>> ImportAsync(IFormFile? file,
        OrgDbContext db, CancellationToken ct)
    {
        if (CheckFile(file) is { } bad) return bad;
        var (preview, plan) = await AnalyzeAsync(file!, db, ct);
        if (preview.FileError is not null || preview.ErrorCount > 0) return TypedResults.BadRequest(preview);

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var created = new Dictionary<string, Employee>(StringComparer.OrdinalIgnoreCase);
        foreach (var p in plan)
        {
            var e = new Employee { Code = p.Request.Code!, FullName = p.Request.FullName.Trim() };
            EmployeeEndpoints.Apply(e, p.Request);
            db.Employees.Add(e);
            created[e.Code] = e;
        }
        await db.SaveChangesAsync(ct);
        // Quản lý nằm trong cùng file: gán sau khi mọi người đã có Id.
        foreach (var p in plan.Where(p => p.ManagerCodeInFile is not null))
            created[p.Request.Code!].ManagerId = created[p.ManagerCodeInFile!].Id;
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return TypedResults.Ok(new ImportResultDto(created.Count, [.. created.Keys]));
    }

    private static ValidationProblem? CheckFile(IFormFile? file)
    {
        var v = new Validation();
        if (file is null || file.Length == 0) v.Add("file", "Chọn file Excel (.xlsx)");
        else if (!file.FileName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase)) v.Add("file", "Chỉ nhận file .xlsx (Excel 2007 trở lên)");
        else if (file.Length > MaxBytes) v.Add("file", "File tối đa 5 MB");
        return v.Failed ? v.Problem() : null;
    }

    private sealed record Planned(UpsertEmployeeRequest Request, string? ManagerCodeInFile);

    private static readonly Dictionary<string, string> FieldLabel = new()
    {
        ["code"] = "Mã NV", ["fullName"] = "Họ tên", ["email"] = "Email", ["phone"] = "Điện thoại", ["joinedAt"] = "Ngày vào làm",
        ["status"] = "Trạng thái", ["departmentId"] = "Phòng ban", ["positionId"] = "Chức vụ", ["managerId"] = "Mã quản lý",
    };

    /// <summary>Đọc file, tra cứu, kiểm tra từng dòng. Trả bản xem trước + kế hoạch tạo (chỉ dùng khi không có lỗi).</summary>
    private static async Task<(ImportPreviewDto Preview, List<Planned> Plan)> AnalyzeAsync(IFormFile file, OrgDbContext db, CancellationToken ct)
    {
        List<ImportSheetRow> rows;
        string? fileError;
        try
        {
            await using var s = file.OpenReadStream();
            using var ms = new MemoryStream();
            await s.CopyToAsync(ms, ct);
            ms.Position = 0;
            rows = EmployeeImportSheet.Read(ms, out fileError);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            return (new ImportPreviewDto([], 0, 0, "Không đọc được file — kiểm tra đúng là file Excel .xlsx"), []);
        }
        if (fileError is not null) return (new ImportPreviewDto([], 0, 0, fileError), []);

        var deps = await db.Departments.AsNoTracking().Select(d => new { d.Id, d.Name, d.Code }).ToListAsync(ct);
        var poss = await db.Positions.AsNoTracking().Select(p => new { p.Id, p.Name }).ToListAsync(ct);
        var managersInDb = await db.Employees.AsNoTracking().Where(e => e.Status != EmployeeStatus.Resigned)
            .Select(e => new { e.Id, e.Code, e.FullName }).ToListAsync(ct);

        // Cấp mã cho dòng để trống, tiếp nối mã lớn nhất hiện có (tránh trùng mã được ghi trong file).
        var next = int.Parse((await EmployeeEndpoints.NextCodeAsync(db, ct))[2..]);
        var usedCodes = rows.Where(r => r.Code is not null).Select(r => r.Code!).ToHashSet(StringComparer.OrdinalIgnoreCase);
        string NewCode() { string c; do c = $"NV{next++:000}"; while (usedCodes.Contains(c)); usedCodes.Add(c); return c; }
        var codes = rows.Select(r => r.Code ?? NewCode()).ToList();
        var fileNames = rows.Select((r, i) => (Code: codes[i], r.FullName)).ToDictionary(x => x.Code, x => x.FullName, StringComparer.OrdinalIgnoreCase);

        var dtos = new List<ImportRowDto>();
        var plan = new List<Planned>();
        for (var i = 0; i < rows.Count; i++)
        {
            var r = rows[i];
            var code = codes[i];
            var errors = new List<string>(r.Errors);

            var dep = r.Department is null ? null : deps.FirstOrDefault(d => Eq(d.Name, r.Department) || (d.Code is not null && Eq(d.Code, r.Department)));
            if (r.Department is not null && dep is null) errors.Add($"Phòng ban \"{r.Department}\" chưa có");
            var pos = r.Position is null ? null : poss.FirstOrDefault(p => Eq(p.Name, r.Position));
            if (r.Position is not null && pos is null) errors.Add($"Chức vụ \"{r.Position}\" chưa có");
            var status = EmployeeImportSheet.ParseStatus(r.Status);
            if (status is null) errors.Add($"Trạng thái \"{r.Status}\" không hợp lệ (Thử việc / Chính thức)");

            if (codes.Count(c => Eq(c, code)) > 1) errors.Add($"Mã {code} bị trùng trong file");
            if (r.Email is not null && rows.Count(x => x.Email is not null && Eq(x.Email, r.Email)) > 1) errors.Add($"Email {r.Email} bị trùng trong file");

            Guid? managerId = null;
            string? managerInFile = null, managerName = null;
            if (r.ManagerCode is not null)
            {
                if (Eq(r.ManagerCode, code)) errors.Add("Không thể tự quản lý chính mình");
                else if (managersInDb.FirstOrDefault(m => Eq(m.Code, r.ManagerCode)) is { } m) { managerId = m.Id; managerName = m.FullName; }
                else if (fileNames.TryGetValue(r.ManagerCode, out var n)) { managerInFile = r.ManagerCode; managerName = n; }
                else errors.Add($"Mã quản lý {r.ManagerCode} không có (trong hệ thống hoặc trong file)");
            }

            var req = new UpsertEmployeeRequest(code, r.FullName ?? "", r.Email, r.Phone, r.DateOfBirth, dep?.Id, pos?.Id, managerId,
                (status ?? EmployeeStatus.Probation).ToString(), r.JoinedAt ?? default, r.Note, r.JobTitle);
            var v = await EmployeeEndpoints.ValidateAsync(req, null, db, ct);
            foreach (var (field, msgs) in v.Errors)
                foreach (var m in msgs)
                    if (!(field == "joinedAt" && r.Errors.Any(e => e.StartsWith("Ngày vào làm"))))
                        errors.Add(FieldLabel.TryGetValue(field, out var label) && !m.Contains(label, StringComparison.OrdinalIgnoreCase) ? $"{label}: {m}" : m);

            dtos.Add(new ImportRowDto(r.RowNumber, code, r.FullName, r.Email, r.Phone, r.DateOfBirth, dep?.Name, pos?.Name, r.JobTitle, r.ManagerCode, managerName,
                r.JoinedAt, status == EmployeeStatus.Active ? "Chính thức" : "Thử việc", errors));
            if (errors.Count == 0) plan.Add(new Planned(req, managerInFile));
        }
        var errorCount = dtos.Count(d => d.Errors.Count > 0);
        return (new ImportPreviewDto(dtos, dtos.Count - errorCount, errorCount, null), plan);
    }

    private static bool Eq(string a, string b) =>
        string.Equals(EmployeeImportSheet.Normalize(a), EmployeeImportSheet.Normalize(b), StringComparison.Ordinal);
}
