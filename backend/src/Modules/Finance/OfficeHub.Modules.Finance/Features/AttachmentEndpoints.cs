using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.BuildingBlocks.Storage;
using OfficeHub.Modules.Finance.Domain;
using OfficeHub.Modules.Finance.Infrastructure;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Finance.Features;

public sealed record AttachmentDto(Guid Id, AttachmentOwner OwnerType, Guid OwnerId, string FileName, string ContentType, long Size, DateTimeOffset CreatedAt,
    string CreatedByName, bool CanDelete);
public sealed record AttachmentUploadRequest(AttachmentOwner OwnerType, Guid OwnerId, string FileName, string? ContentType, long Size);
public sealed record AttachmentUploadDto(Guid Id, string UploadUrl, string ContentType, DateTimeOffset ExpiresAt);
public sealed record AttachmentUrlDto(string Url);

/// <summary>
/// Chứng từ của dòng sổ / đề nghị chi: xin link (presigned PUT, S3 <c>finance/</c>) → trình duyệt tải thẳng → xác nhận (HEAD kiểm tra kích thước).
/// Dòng sổ: Xem tài chính đọc, Ghi sổ thêm / xoá (dòng còn hiệu lực; kỳ đã khoá thì không xoá). Đề nghị chi: người gửi + quản lý trực tiếp + Xem tài chính đọc;
/// người gửi thêm / xoá khi chưa chi, Ghi sổ luôn được. Dòng sổ sinh từ đề nghị chi hiện cả chứng từ của đề nghị (chỉ đọc ở đó).
/// </summary>
internal static class AttachmentEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/attachments", ListAsync);
        g.MapPost("/attachments", CreateAsync);
        g.MapPost("/attachments/{id:guid}/confirm", ConfirmAsync);
        g.MapGet("/attachments/{id:guid}/url", UrlAsync);
        g.MapDelete("/attachments/{id:guid}", DeleteAsync);
    }

    /// <param name="Locked">Dòng sổ trong kỳ đã khoá: vẫn thêm được chứng từ, không xoá.</param>
    private sealed record Access(bool Found, bool Read, bool Write, string? WhyNot, bool Locked = false);

    private static async Task<Access> AccessAsync(AttachmentOwner type, Guid ownerId, ClaimsPrincipal user, FinanceDbContext db, IFinanceAccess finance,
        IEmployeeDirectory dir, CancellationToken ct)
    {
        if (user.GetUserId() is not { } uid) return new(false, false, false, null);
        var perms = await finance.GetAsync(uid, ct);
        if (type == AttachmentOwner.Entry)
        {
            var e = await db.Entries.AsNoTracking().FirstOrDefaultAsync(x => x.Id == ownerId, ct);
            if (e is null) return new(false, false, false, null);
            var locked = LedgerRules.IsLocked(e.Date, (await db.Settings.AsNoTracking().FirstOrDefaultAsync(ct))?.LockedThrough);
            var write = perms.Has(FinancePermission.Record) && e.Status == TxStatus.Active;
            return new(true, perms.Has(FinancePermission.View), write,
                !perms.Has(FinancePermission.Record) ? "Chỉ người có quyền Ghi sổ thêm / xoá chứng từ" : e.Status != TxStatus.Active ? "Giao dịch đã huỷ" : null, locked);
        }
        var x = await db.Expenses.AsNoTracking().FirstOrDefaultAsync(r => r.Id == ownerId, ct);
        if (x is null) return new(false, false, false, null);
        var me = await dir.GetByUserIdAsync(uid, ct);
        var isRequester = me is not null && me.Id == x.RequesterEmployeeId;
        var isManager = me is not null && (await dir.GetAsync(x.RequesterEmployeeId, ct))?.ManagerId == me.Id;
        var requesterCanWrite = isRequester && x.Status is ExpenseStatus.Pending or ExpenseStatus.Approved;
        var canWrite = requesterCanWrite || perms.Has(FinancePermission.Record);
        return new(true, isRequester || isManager || perms.Has(FinancePermission.View), canWrite,
            canWrite ? null : isRequester ? "Đề nghị đã chi / đã đóng — nhờ kế toán bổ sung chứng từ" : "Bạn không thêm chứng từ cho đề nghị này");
    }

    private static AttachmentDto ToDto(FinanceAttachment a, bool canDelete) =>
        new(a.Id, a.OwnerType, a.OwnerId, a.FileName, a.ContentType, a.Size, a.CreatedAt, a.CreatedByName, canDelete);

    /// <summary>Chứng từ của một dòng sổ / đề nghị chi. Dòng sổ chi theo đề nghị → kèm chứng từ của đề nghị (không xoá được từ đây).</summary>
    private static async Task<Results<Ok<List<AttachmentDto>>, NotFound>> ListAsync(AttachmentOwner ownerType, Guid ownerId, ClaimsPrincipal user, FinanceDbContext db,
        IFinanceAccess finance, IEmployeeDirectory dir, CancellationToken ct)
    {
        var acc = await AccessAsync(ownerType, ownerId, user, db, finance, dir, ct);
        if (!acc.Found || !acc.Read) return TypedResults.NotFound();
        var owners = new List<(AttachmentOwner, Guid)> { (ownerType, ownerId) };
        if (ownerType == AttachmentOwner.Entry && await db.Entries.AsNoTracking().Where(e => e.Id == ownerId && e.SourceType == ExpenseEndpoints.SourceType)
                .Select(e => e.SourceId).FirstOrDefaultAsync(ct) is { } expId)
            owners.Add((AttachmentOwner.Expense, expId));
        var ids = owners.Select(o => o.Item2).ToList();
        var rows = await db.Attachments.AsNoTracking().Where(a => ids.Contains(a.OwnerId) && a.Ready && a.DeletedAt == null).OrderBy(a => a.CreatedAt).ToListAsync(ct);
        var canDelete = acc.Write && !acc.Locked;
        return TypedResults.Ok(rows.Where(a => owners.Contains((a.OwnerType, a.OwnerId)))
            .Select(a => ToDto(a, canDelete && a.OwnerType == ownerType && a.OwnerId == ownerId)).ToList());
    }

    private static async Task<Results<Ok<AttachmentUploadDto>, NotFound, ValidationProblem, ProblemHttpResult>> CreateAsync(AttachmentUploadRequest r, ClaimsPrincipal user,
        FinanceDbContext db, IFinanceAccess finance, IEmployeeDirectory dir, IFileStorage files, FinanceClock clock, CancellationToken ct)
    {
        var acc = await AccessAsync(r.OwnerType, r.OwnerId, user, db, finance, dir, ct);
        if (!acc.Found || !acc.Read) return TypedResults.NotFound();
        if (!acc.Write) return TypedResults.Problem(acc.WhyNot, statusCode: StatusCodes.Status403Forbidden);
        var name = AttachmentRules.CleanFileName(r.FileName);
        var val = new Validation();
        foreach (var (field, msg) in AttachmentRules.Validate(name, r.Size)) val.Add(field, msg);
        if (await db.Attachments.CountAsync(a => a.OwnerId == r.OwnerId && a.Ready && a.DeletedAt == null, ct) >= AttachmentRules.MaxPerOwner)
            val.Add("fileName", $"Tối đa {AttachmentRules.MaxPerOwner} chứng từ");
        if (val.Failed) return val.Problem();
        var now = clock.Now;
        // Dọn link bỏ dở (> 1 ngày chưa xác nhận) — chỉ xoá dòng, file mồ côi (nếu có) để lại.
        await db.Attachments.Where(a => !a.Ready && a.CreatedAt < now.AddDays(-1)).ExecuteDeleteAsync(ct);
        var contentType = FileTypes.ContentTypeFor(name); // TEST-13: theo đuôi, không tin trình duyệt
        var a = new FinanceAttachment
        {
            OwnerType = r.OwnerType, OwnerId = r.OwnerId, FileName = name, ContentType = contentType, Size = r.Size, CreatedAt = now,
            CreatedByUserId = user.GetUserId()!.Value, CreatedByName = user.FindFirstValue(ClaimNames.FullName) ?? user.Identity?.Name ?? "?", FileKey = "",
        };
        a.FileKey = AttachmentRules.FileKey(now, a.Id, name);
        db.Attachments.Add(a);
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(new AttachmentUploadDto(a.Id, await files.GetUploadUrlAsync(a.FileKey, contentType, AttachmentRules.UploadUrlTtl), contentType,
            now + AttachmentRules.UploadUrlTtl));
    }

    /// <summary>Trình duyệt đã PUT xong → kiểm tra file có thật trên S3 và không vượt 20 MB.</summary>
    private static async Task<Results<Ok<AttachmentDto>, NotFound, ValidationProblem, ProblemHttpResult>> ConfirmAsync(Guid id, ClaimsPrincipal user, FinanceDbContext db,
        IFileStorage files, CancellationToken ct)
    {
        var a = await db.Attachments.FirstOrDefaultAsync(x => x.Id == id && x.DeletedAt == null, ct);
        if (a is null || a.CreatedByUserId != user.GetUserId()) return TypedResults.NotFound();
        if (a.Ready) return TypedResults.Ok(ToDto(a, true));
        // TEST-13: chép key tạm → key chính rồi kiểm cỡ + chữ ký trên bản đã chép (link PUT còn hạn không thay được chứng từ đã xác nhận)
        var check = await files.PromoteUploadAsync(a.FileKey, a.FileName, ct);
        if (check.Error is { } bad)
        {
            db.Attachments.Remove(a);
            await db.SaveChangesAsync(ct);
            return new Validation().Add("fileName", bad).Problem();
        }
        var size = check.Size;
        if (size is null) return Problems.Conflict("Tệp chưa tải lên xong — thử lại");
        if (size.Value <= 0 || size.Value > AttachmentRules.MaxBytes)
        {
            await files.DeleteAsync(a.FileKey, ct);
            db.Attachments.Remove(a);
            await db.SaveChangesAsync(ct);
            return new Validation().Add("size", "Tệp tối đa 20 MB").Problem();
        }
        a.Size = size.Value;
        a.Ready = true;
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(ToDto(a, true));
    }

    private static async Task<Results<Ok<AttachmentUrlDto>, NotFound>> UrlAsync(Guid id, bool? download, ClaimsPrincipal user, FinanceDbContext db, IFinanceAccess finance,
        IEmployeeDirectory dir, IFileStorage files, CancellationToken ct)
    {
        var a = await db.Attachments.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id && x.Ready && x.DeletedAt == null, ct);
        if (a is null) return TypedResults.NotFound();
        var acc = await AccessAsync(a.OwnerType, a.OwnerId, user, db, finance, dir, ct);
        // Chứng từ của đề nghị chi cũng đọc được qua dòng sổ đã chi → người có quyền Xem tài chính đã được tính trong AccessAsync(Expense).
        if (!acc.Read) return TypedResults.NotFound();
        return TypedResults.Ok(new AttachmentUrlDto(await files.GetDownloadUrlAsync(a.FileKey, a.FileName, download != true && AttachmentRules.IsInline(a.ContentType),
            TimeSpan.FromMinutes(10))));
    }

    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> DeleteAsync(Guid id, ClaimsPrincipal user, FinanceDbContext db, IFinanceAccess finance,
        IEmployeeDirectory dir, FinanceClock clock, CancellationToken ct)
    {
        var a = await db.Attachments.FirstOrDefaultAsync(x => x.Id == id && x.Ready && x.DeletedAt == null, ct);
        if (a is null) return TypedResults.NotFound();
        var acc = await AccessAsync(a.OwnerType, a.OwnerId, user, db, finance, dir, ct);
        if (!acc.Read) return TypedResults.NotFound();
        if (acc.Locked) return Problems.Conflict("Sổ đã khoá kỳ này — không xoá chứng từ (vẫn thêm được)");
        if (!acc.Write) return TypedResults.Problem(acc.WhyNot, statusCode: StatusCodes.Status403Forbidden);
        a.DeletedAt = clock.Now;
        a.DeletedByName = user.FindFirstValue(ClaimNames.FullName) ?? user.Identity?.Name ?? "?";
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    /// <summary>Số chứng từ (đã xác nhận, chưa xoá) theo chủ sở hữu — cho cột đếm ở danh sách.</summary>
    internal static async Task<Dictionary<Guid, int>> CountsAsync(FinanceDbContext db, IReadOnlyCollection<Guid> ownerIds, CancellationToken ct) =>
        ownerIds.Count == 0 ? [] : await db.Attachments.AsNoTracking().Where(a => ownerIds.Contains(a.OwnerId) && a.Ready && a.DeletedAt == null)
            .GroupBy(a => a.OwnerId).Select(g => new { g.Key, N = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.N, ct);
}
