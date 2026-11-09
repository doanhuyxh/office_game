using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Documents;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.BuildingBlocks.Storage;
using OfficeHub.Modules.Assets.Domain;
using OfficeHub.Modules.Assets.Infrastructure;

namespace OfficeHub.Modules.Assets.Features;

/// <summary>
/// Biên bản giao nhận thiết bị: nhân viên xem + bấm xác nhận biên bản của mình (ghi thời điểm + IP), tải Word (HR hoặc chính chủ).
/// HR: danh sách biên bản chưa xác nhận, mẫu Word riêng của công ty (Danh mục → Mẫu biên bản).
/// </summary>
internal static class HandoverEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/handovers/my", MyAsync);
        g.MapPost("/handovers/{id:guid}/confirm", ConfirmAsync);
        g.MapGet("/handovers/{id:guid}/docx", DocxAsync);
        var hr = g.MapGroup("").RequireAuthorization(AuthPolicies.Hr);
        hr.MapGet("/handovers", ListAsync);
        hr.MapGet("/settings", SettingsAsync);
        hr.MapGet("/settings/handover-template/fields", () => TypedResults.Ok(HandoverDocument.Fields));
        hr.MapGet("/settings/handover-template/default",
            () => TypedResults.File(HandoverDocument.DefaultTemplate(), HandoverDocument.DocxType, "mau-bien-ban-giao-nhan-mac-dinh.docx"));
        hr.MapPost("/settings/handover-template", UploadTemplateAsync).DisableAntiforgery();
        hr.MapDelete("/settings/handover-template", DeleteTemplateAsync);
    }

    /// <summary>Biên bản của chính mình — chờ xác nhận lên đầu.</summary>
    private static async Task<Ok<List<HandoverDto>>> MyAsync(ClaimsPrincipal user, AssetsDbContext db, AssetAccess access, CancellationToken ct)
    {
        var me = await access.ViewerAsync(user, ct);
        if (me.Employee is null) return TypedResults.Ok(new List<HandoverDto>());
        var rows = await db.Handovers.AsNoTracking().Where(h => h.EmployeeId == me.Employee.Id)
            .OrderByDescending(h => h.RequiresConfirmation && h.ConfirmedAt == null).ThenByDescending(h => h.CreatedAt).Take(100).ToListAsync(ct);
        return TypedResults.Ok(rows.Select(DeviceEndpoints.ToDto).ToList());
    }

    /// <summary>HR: biên bản gần đây; <paramref name="unconfirmed"/> = chỉ biên bản đang chờ nhân viên xác nhận.</summary>
    private static async Task<Ok<List<HandoverDto>>> ListAsync(bool? unconfirmed, AssetsDbContext db, CancellationToken ct)
    {
        var q = db.Handovers.AsNoTracking();
        if (unconfirmed == true) q = q.Where(h => h.RequiresConfirmation && h.ConfirmedAt == null);
        return TypedResults.Ok((await q.OrderByDescending(h => h.CreatedAt).Take(200).ToListAsync(ct)).Select(DeviceEndpoints.ToDto).ToList());
    }

    /// <summary>Nhân viên xác nhận đã nhận / đã trả thiết bị. Chỉ đúng người trong biên bản (người khác: 404).</summary>
    private static async Task<Results<Ok<HandoverDto>, NotFound, ProblemHttpResult>> ConfirmAsync(Guid id, HttpContext http, AssetsDbContext db,
        AssetAccess access, AssetClock clock, CancellationToken ct)
    {
        var me = await access.ViewerAsync(http.User, ct);
        var h = await db.Handovers.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (h is null || me.Employee?.Id != h.EmployeeId) return TypedResults.NotFound();
        if (AssetRules.CannotConfirmHandover(true, h.RequiresConfirmation, h.ConfirmedAt is not null) is { } err) return Problems.Conflict(err);
        h.ConfirmedAt = clock.Now;
        h.ConfirmedIp = http.Connection.RemoteIpAddress?.ToString();
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(DeviceEndpoints.ToDto(h));
    }

    /// <summary>File Word biên bản theo mẫu công ty (nếu có) hoặc mẫu mặc định. HR hoặc chính nhân viên trong biên bản.</summary>
    private static async Task<Results<FileContentHttpResult, NotFound, ProblemHttpResult>> DocxAsync(Guid id, ClaimsPrincipal user, AssetsDbContext db,
        AssetAccess access, AssetClock clock, IFileStorage storage, CancellationToken ct)
    {
        var me = await access.ViewerAsync(user, ct);
        var h = await db.Handovers.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (h is null || (!me.IsHr && me.Employee?.Id != h.EmployeeId)) return TypedResults.NotFound();
        var settings = await db.Settings.AsNoTracking().FirstOrDefaultAsync(ct);
        Stream template = settings?.HandoverTemplateKey is { } key ? await storage.OpenReadAsync(key, ct) : new MemoryStream(HandoverDocument.DefaultTemplate());
        await using (template)
        {
            try
            {
                return TypedResults.File(HandoverDocument.Render(template, h, clock.TimeZone), HandoverDocument.DocxType, HandoverDocument.FileName(h));
            }
            catch (Exception ex) when (ex is DocumentFormat.OpenXml.Packaging.OpenXmlPackageException or InvalidDataException)
            {
                return Problems.Conflict("Mẫu biên bản của công ty bị lỗi — tải lại mẫu ở Tài sản → Danh mục");
            }
        }
    }

    private static async Task<Ok<AssetSettingsDto>> SettingsAsync(AssetsDbContext db, CancellationToken ct)
    {
        var s = await db.Settings.AsNoTracking().FirstOrDefaultAsync(ct);
        return TypedResults.Ok(new AssetSettingsDto(s?.HandoverTemplateName, s?.UpdatedAt, s?.UpdatedByName));
    }

    private static async Task<AssetSettings> RowForWriteAsync(AssetsDbContext db, CancellationToken ct)
    {
        var s = await db.Settings.FirstOrDefaultAsync(ct);
        if (s is null) { s = new AssetSettings(); db.Settings.Add(s); }
        return s;
    }

    /// <summary>Mẫu Word riêng (HR). Kiểm tra mở được + có ít nhất một trường dạng <c>{{SoBienBan}}</c>.</summary>
    private static async Task<Results<NoContent, ValidationProblem>> UploadTemplateAsync(IFormFile file, ClaimsPrincipal user, AssetsDbContext db,
        AssetAccess access, IFileStorage storage, AssetClock clock, CancellationToken ct)
    {
        if (file.Length is 0 or > 10 * 1024 * 1024 || !file.FileName.EndsWith(".docx", StringComparison.OrdinalIgnoreCase))
            return new Validation().Add("file", "Chọn file Word .docx (≤ 10 MB)").Problem();
        using var ms = new MemoryStream();
        await file.CopyToAsync(ms, ct);
        IReadOnlyList<string> fields;
        try { ms.Position = 0; fields = DocxTemplate.ScanFields(ms); }
        catch (Exception e) when (e is DocumentFormat.OpenXml.Packaging.OpenXmlPackageException or InvalidDataException or FileFormatException)
        { return new Validation().Add("file", "File không phải Word .docx hợp lệ").Problem(); }
        if (fields.Count == 0) return new Validation().Add("file", "Mẫu chưa có trường nào dạng {{SoBienBan}}").Problem();
        var key = $"assets/templates/handover-{Guid.CreateVersion7():N}.docx";
        ms.Position = 0;
        await storage.UploadAsync(key, ms, HandoverDocument.DocxType, ct);
        var me = await access.ViewerAsync(user, ct);
        var s = await RowForWriteAsync(db, ct);
        s.HandoverTemplateKey = key;
        s.HandoverTemplateName = Path.GetFileName(file.FileName) is { Length: > 200 } longName ? longName[..200] : Path.GetFileName(file.FileName);
        s.UpdatedAt = clock.Now;
        s.UpdatedByName = me.Name;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    /// <summary>Quay về mẫu mặc định (file cũ giữ trên S3).</summary>
    private static async Task<NoContent> DeleteTemplateAsync(ClaimsPrincipal user, AssetsDbContext db, AssetAccess access, AssetClock clock, CancellationToken ct)
    {
        var me = await access.ViewerAsync(user, ct);
        var s = await RowForWriteAsync(db, ct);
        s.HandoverTemplateKey = null;
        s.HandoverTemplateName = null;
        s.UpdatedAt = clock.Now;
        s.UpdatedByName = me.Name;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }
}
