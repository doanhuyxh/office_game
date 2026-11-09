using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.BuildingBlocks.Storage;
using OfficeHub.Modules.Assets.Domain;
using OfficeHub.Modules.Assets.Infrastructure;

namespace OfficeHub.Modules.Assets.Features;

/// <summary>
/// Ảnh / hoá đơn / tệp khác của thiết bị (chỉ HR): xin link (presigned PUT, S3 <c>assets/devices/</c>) → trình duyệt tải thẳng →
/// xác nhận (HEAD kiểm tra kích thước). Xoá = ẩn, file giữ lại. Thiết bị đã thanh lý / mất vẫn thêm được (lưu chứng từ thanh lý).
/// </summary>
internal static class AttachmentEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        var hr = g.MapGroup("").RequireAuthorization(AuthPolicies.Hr);
        hr.MapGet("/devices/{id:guid}/attachments", ListAsync);
        hr.MapPost("/devices/{id:guid}/attachments", CreateAsync);
        hr.MapPost("/attachments/{id:guid}/confirm", ConfirmAsync);
        hr.MapGet("/attachments/{id:guid}/url", UrlAsync);
        hr.MapDelete("/attachments/{id:guid}", DeleteAsync);
    }

    private static AttachmentDto ToDto(DeviceAttachment a) =>
        new(a.Id, a.DeviceId, a.Kind, a.FileName, a.ContentType, a.Size, a.CreatedAt, a.CreatedByName);

    private static string NameOf(ClaimsPrincipal user) => user.FindFirstValue(ClaimNames.FullName) ?? user.Identity?.Name ?? "?";

    private static async Task<Results<Ok<List<AttachmentDto>>, ProblemHttpResult>> ListAsync(Guid id, AssetsDbContext db, CancellationToken ct)
    {
        if (!await db.Devices.AnyAsync(d => d.Id == id, ct)) return Problems.NotFound("thiết bị");
        var rows = await db.Attachments.AsNoTracking().Where(a => a.DeviceId == id && a.Ready && a.DeletedAt == null)
            .OrderBy(a => a.Kind).ThenBy(a => a.CreatedAt).ToListAsync(ct);
        return TypedResults.Ok(rows.Select(ToDto).ToList());
    }

    private static async Task<Results<Ok<AttachmentUploadDto>, ValidationProblem, ProblemHttpResult>> CreateAsync(Guid id, AttachmentUploadRequest r,
        ClaimsPrincipal user, AssetsDbContext db, IFileStorage files, AssetClock clock, CancellationToken ct)
    {
        if (!await db.Devices.AnyAsync(d => d.Id == id, ct)) return Problems.NotFound("thiết bị");
        var name = AssetRules.CleanFileName(r.FileName);
        var v = new Validation();
        if (!Enum.IsDefined(r.Kind)) v.Add("kind", "Loại tệp không hợp lệ");
        else foreach (var (field, msg) in AssetRules.ValidateAttachment(r.Kind, name, r.Size)) v.Add(field, msg);
        if (await db.Attachments.CountAsync(a => a.DeviceId == id && a.Ready && a.DeletedAt == null, ct) >= AssetRules.MaxAttachmentsPerDevice)
            v.Add("fileName", $"Tối đa {AssetRules.MaxAttachmentsPerDevice} tệp mỗi thiết bị");
        if (v.Failed) return v.Problem();
        var now = clock.Now;
        // Dọn link bỏ dở (> 1 ngày chưa xác nhận) — chỉ xoá dòng, file mồ côi (nếu có) để lại.
        await db.Attachments.Where(a => !a.Ready && a.CreatedAt < now.AddDays(-1)).ExecuteDeleteAsync(ct);
        var contentType = AssetRules.NormalizeContentType(r.ContentType);
        var a = new DeviceAttachment
        {
            DeviceId = id, Kind = r.Kind, FileName = name, ContentType = contentType, Size = r.Size, CreatedAt = now,
            CreatedByUserId = user.GetUserId()!.Value, CreatedByName = NameOf(user), FileKey = "",
        };
        a.FileKey = AssetRules.AttachmentKey(id, a.Id, name);
        db.Attachments.Add(a);
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(new AttachmentUploadDto(a.Id, await files.GetUploadUrlAsync(a.FileKey, contentType, AssetRules.UploadUrlTtl), contentType,
            now + AssetRules.UploadUrlTtl));
    }

    /// <summary>Trình duyệt đã PUT xong → kiểm tra file có thật trên S3 và không vượt 20 MB. Chỉ người xin link (người khác: 404).</summary>
    private static async Task<Results<Ok<AttachmentDto>, NotFound, ValidationProblem, ProblemHttpResult>> ConfirmAsync(Guid id, ClaimsPrincipal user,
        AssetsDbContext db, IFileStorage files, CancellationToken ct)
    {
        var a = await db.Attachments.FirstOrDefaultAsync(x => x.Id == id && x.DeletedAt == null, ct);
        if (a is null || a.CreatedByUserId != user.GetUserId()) return TypedResults.NotFound();
        if (a.Ready) return TypedResults.Ok(ToDto(a));
        var size = await files.GetSizeAsync(a.FileKey, ct);
        if (size is null) return Problems.Conflict("Tệp chưa tải lên xong — thử lại");
        if (size.Value <= 0 || size.Value > AssetRules.MaxAttachmentBytes)
        {
            await files.DeleteAsync(a.FileKey, ct);
            db.Attachments.Remove(a);
            await db.SaveChangesAsync(ct);
            return new Validation().Add("size", "Tệp tối đa 20 MB").Problem();
        }
        a.Size = size.Value;
        a.Ready = true;
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(ToDto(a));
    }

    /// <summary>Presigned GET 10 phút; ảnh / PDF xem trong trình duyệt trừ khi <c>download=true</c>.</summary>
    private static async Task<Results<Ok<FileUrlDto>, NotFound>> UrlAsync(Guid id, bool? download, AssetsDbContext db, IFileStorage files, CancellationToken ct)
    {
        var a = await db.Attachments.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id && x.Ready && x.DeletedAt == null, ct);
        if (a is null) return TypedResults.NotFound();
        return TypedResults.Ok(new FileUrlDto(await files.GetDownloadUrlAsync(a.FileKey, a.FileName, download != true && AssetRules.IsInline(a.ContentType),
            TimeSpan.FromMinutes(10))));
    }

    private static async Task<Results<NoContent, NotFound>> DeleteAsync(Guid id, ClaimsPrincipal user, AssetsDbContext db, AssetClock clock, CancellationToken ct)
    {
        var a = await db.Attachments.FirstOrDefaultAsync(x => x.Id == id && x.Ready && x.DeletedAt == null, ct);
        if (a is null) return TypedResults.NotFound();
        a.DeletedAt = clock.Now;
        a.DeletedByName = NameOf(user);
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }
}
