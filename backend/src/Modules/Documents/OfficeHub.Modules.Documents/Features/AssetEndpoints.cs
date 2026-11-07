using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.BuildingBlocks.Storage;
using OfficeHub.Modules.Approval.Contracts;
using OfficeHub.Modules.Documents.Domain;
using OfficeHub.Modules.Documents.Infrastructure;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Documents.Features;

/// <summary>
/// Tài liệu: tải lên thẳng S3 (vé + presigned PUT → đăng ký), danh sách / tìm, chi tiết, phiên bản, xem / tải (presigned GET, ghi nhật ký),
/// sửa thông tin, thùng rác, gửi duyệt ban hành, lưu trữ, đổi người phụ trách.
/// </summary>
internal static class AssetEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapPost("/uploads", CreateUploadAsync);
        g.MapGet("/assets", ListAsync);
        g.MapPost("/assets", CreateAsync);
        g.MapGet("/assets/{id:guid}", GetAsync);
        g.MapPut("/assets/{id:guid}", UpdateAsync);
        g.MapPost("/assets/{id:guid}/versions", AddVersionAsync);
        g.MapGet("/assets/{id:guid}/file", FileAsync);
        g.MapGet("/assets/{id:guid}/access-log", AccessLogAsync);
        g.MapDelete("/assets/{id:guid}", TrashAsync);
        g.MapPost("/assets/{id:guid}/restore", RestoreAsync);
        g.MapDelete("/assets/{id:guid}/purge", PurgeAsync);
        g.MapPost("/assets/{id:guid}/submit", SubmitAsync);
        g.MapPost("/assets/{id:guid}/archive", ArchiveAsync);
        g.MapPut("/assets/{id:guid}/custodian", CustodianAsync);
        g.MapGet("/trash", TrashListAsync);
    }

    // ---------------- Tải lên ----------------

    private static async Task<Results<Ok<UploadTicketDto>, ValidationProblem>> CreateUploadAsync(UploadRequest req, ClaimsPrincipal user,
        DocumentAccess access, DocumentsDbContext db, IFileStorage files, DocClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var name = DocumentRules.CleanFileName(req.FileName ?? "");
        var val = new Validation().Required(name, "fileName", "Tên file");
        if (name.Length > 0 && DocumentRules.IsBlocked(name)) val.Add("fileName", "Không lưu file chạy chương trình (.exe, .bat, .apk…) vào kho");
        if (req.Size <= 0) val.Add("size", "File rỗng");
        else if (req.Size > DocumentRules.MaxFileSize) val.Add("size", "File tối đa 5 GB");
        if (val.Failed) return val.Problem();

        var contentType = DocumentRules.NormalizeContentType(req.ContentType);
        var now = clock.Now;
        var t = new UploadTicket { FileName = name, ContentType = contentType, Size = req.Size, UserId = v.UserId, CreatedAt = now,
            FileKey = "" };
        t.FileKey = $"documents/{now:yyyy}/{now:MM}/{t.Id:N}/{DocumentRules.SafeKeyName(name)}";
        db.UploadTickets.Add(t);
        await db.SaveChangesAsync(ct);
        var url = await files.GetUploadUrlAsync(t.FileKey, contentType, DocumentRules.UploadUrlTtl);
        return TypedResults.Ok(new UploadTicketDto(t.Id, url, contentType, now + DocumentRules.UploadUrlTtl));
    }

    /// <summary>Lấy vé của chính người gọi + kiểm tra file đã thật sự nằm trên S3 (HEAD). Trả (vé, kích thước thật) hoặc lỗi.</summary>
    private static async Task<(UploadTicket? Ticket, long Size, ProblemHttpResult? Error)> ClaimTicketAsync(Guid ticketId, Viewer v,
        DocumentsDbContext db, IFileStorage files, CancellationToken ct)
    {
        var t = await db.UploadTickets.FirstOrDefaultAsync(x => x.Id == ticketId && x.UserId == v.UserId, ct);
        if (t is null) return (null, 0, Problems.NotFound("phiên tải lên (đã hết hạn hoặc đã dùng)"));
        var size = await files.GetSizeAsync(t.FileKey, ct);
        if (size is null) return (null, 0, Problems.Conflict("File chưa tải lên xong — thử tải lại"));
        return (t, size.Value, null);
    }

    // ---------------- Danh sách ----------------

    /// <summary>
    /// Danh sách theo trang (luôn trả PagedResult). Có kho: không tìm → tài liệu trong <paramref name="folderId"/> (null = gốc kho);
    /// có <paramref name="search"/> → tìm cả kho. Không truyền kho: bắt buộc có từ khoá → tìm mọi kho người gọi vào được.
    /// </summary>
    private static async Task<Results<Ok<PagedResult<AssetRowDto>>, ProblemHttpResult>> ListAsync(SpaceKind? spaceKind, Guid? spaceId, Guid? folderId,
        string? search, Guid? docTypeId, AssetKind? kind, AssetStatus? status, int? page, int? pageSize, ClaimsPrincipal user, DocumentAccess access,
        DocumentsDbContext db, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var q = db.Assets.AsNoTracking().Where(a => a.DeletedAt == null);
        var term = search?.Trim();
        if (spaceKind is { } sk)
        {
            if (!DocumentAccess.CanRead(v, sk, spaceId)) return Http.Forbidden();
            q = q.Where(a => a.SpaceKind == sk && a.SpaceId == spaceId);
            if (string.IsNullOrEmpty(term)) q = q.Where(a => a.FolderId == folderId);
        }
        else
        {
            if (string.IsNullOrEmpty(term)) return TypedResults.Problem("Nhập từ khoá để tìm trong mọi kho", statusCode: StatusCodes.Status400BadRequest);
            if (!v.IsHr)
            {
                var depts = v.Departments.Select(d => (Guid?)d).ToList();
                var projects = v.Projects.Keys.Select(p => (Guid?)p).ToList();
                q = q.Where(a => a.SpaceKind == SpaceKind.Company
                                 || (a.SpaceKind == SpaceKind.Department && depts.Contains(a.SpaceId))
                                 || (a.SpaceKind == SpaceKind.Project && projects.Contains(a.SpaceId)));
            }
        }
        if (!v.IsHr) q = q.Where(a => a.Classification == Classification.Internal);
        if (!string.IsNullOrEmpty(term))
        {
            var s = $"%{term}%";
            q = q.Where(a => EF.Functions.ILike(a.Title, s) || EF.Functions.ILike(a.Code, s) || (a.Description != null && EF.Functions.ILike(a.Description, s))
                             || (a.DocumentNumber != null && EF.Functions.ILike(a.DocumentNumber, s)) || a.Tags.Any(t => EF.Functions.ILike(t, s))
                             || a.Versions.Any(x => EF.Functions.ILike(x.FileName, s)));
        }
        if (docTypeId is { } dt) q = q.Where(a => a.DocTypeId == dt);
        if (kind is { } k) q = q.Where(a => a.Kind == k);
        if (status is { } st) q = q.Where(a => a.Status == st);
        var paged = await q.Include(a => a.Versions).OrderByDescending(a => a.UpdatedAt ?? a.CreatedAt).ThenByDescending(a => a.Id)
            .ToPagedAsync(page ?? 1, pageSize, ct);
        var types = await TypeNamesAsync(db, ct);
        return TypedResults.Ok(paged.Map(a => Row(a, types)));
    }

    internal static async Task<Dictionary<Guid, string>> TypeNamesAsync(DocumentsDbContext db, CancellationToken ct) =>
        await db.DocTypes.AsNoTracking().ToDictionaryAsync(t => t.Id, t => t.Name, ct);

    internal static AssetRowDto Row(Asset a, IReadOnlyDictionary<Guid, string> types)
    {
        var cur = a.Versions.OrderByDescending(x => x.Number).FirstOrDefault();
        return new(a.Id, a.Code, a.Title, a.Kind, a.Status, a.Classification, a.SpaceKind, a.SpaceId, a.FolderId, a.DocTypeId,
            types.GetValueOrDefault(a.DocTypeId, "?"), a.CurrentVersion, cur?.FileName ?? "", cur?.ContentType ?? "", cur?.Size ?? 0, a.TotalSize,
            a.Tags, a.CustodianName, a.CreatedByName, a.CreatedAt, a.UpdatedAt, a.DocumentNumber, a.RetentionUntil, a.DeletedAt);
    }

    // ---------------- Tạo / sửa ----------------

    private static async Task<Results<Ok<AssetDetailDto>, ValidationProblem, ProblemHttpResult>> CreateAsync(CreateAssetRequest req, ClaimsPrincipal user,
        DocumentAccess access, DocumentsDbContext db, IFileStorage files, IEmployeeDirectory dir, DocClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        if (await access.SpaceAsync(req.SpaceKind, req.SpaceId, ct) is not { } space) return Problems.NotFound("kho tài liệu");
        if (!await access.CanWriteAsync(v, req.SpaceKind, req.SpaceId, ct)) return Http.Forbidden();
        if (req.FolderId is { } fid && !await db.Folders.AnyAsync(f => f.Id == fid && f.SpaceKind == req.SpaceKind && f.SpaceId == req.SpaceId, ct))
            return Problems.NotFound("thư mục");
        var val = new Validation().MaxLength(req.Title?.Trim(), 300, "title", "Tiêu đề").MaxLength(req.Description, 4000, "description", "Mô tả");
        if (val.Failed) return val.Problem();
        var (t, size, err) = await ClaimTicketAsync(req.TicketId, v, db, files, ct);
        if (err is not null) return err;

        var kind = DocumentRules.KindOf(t!.ContentType, t.FileName);
        var type = req.DocTypeId is { } tid ? await db.DocTypes.FirstOrDefaultAsync(x => x.Id == tid && x.IsActive, ct) : await DefaultTypeAsync(db, kind, ct);
        if (type is null) return new Validation().Add("docTypeId", "Loại tài liệu không tồn tại").Problem();

        var now = clock.Now;
        var today = clock.Today;
        var seq = await db.NextAsync($"asset:{today.Year}", ct);
        var title = string.IsNullOrWhiteSpace(req.Title) ? Path.GetFileNameWithoutExtension(t.FileName) : req.Title.Trim();
        var a = new Asset
        {
            Code = DocumentRules.AssetCode(space.Code, today.Year, seq),
            Title = title.Length > 300 ? title[..300] : title,
            Description = string.IsNullOrWhiteSpace(req.Description) ? null : req.Description.Trim(),
            Tags = DocumentRules.NormalizeTags(req.Tags),
            SpaceKind = req.SpaceKind, SpaceId = req.SpaceId, FolderId = req.FolderId, DocTypeId = type.Id, Kind = kind,
            Status = AssetStatus.Draft, CurrentVersion = 1, TotalSize = size,
            CustodianEmployeeId = v.Employee?.Id, CustodianName = v.Employee?.FullName,
            CreatedByUserId = v.UserId, CreatedByEmployeeId = v.Employee?.Id, CreatedByName = v.Name, CreatedAt = now, UpdatedAt = now,
            RetentionUntil = DocumentRules.RetentionUntil(today, type.RetentionYears),
        };
        a.Versions.Add(new AssetVersion { AssetId = a.Id, Number = 1, FileKey = t.FileKey, FileName = t.FileName, ContentType = t.ContentType, Size = size,
            UploadedByUserId = v.UserId, UploadedByName = v.Name, UploadedAt = now });
        db.Assets.Add(a);
        db.UploadTickets.Remove(t);
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(await DetailAsync(a, v, access, db, dir, ct));
    }

    /// <summary>Loại mặc định theo nhóm file: ảnh → HA, video → VD, còn lại → VB (nếu HR đã đổi / tắt mã thì lấy loại đầu tiên đang dùng).</summary>
    private static async Task<DocType?> DefaultTypeAsync(DocumentsDbContext db, AssetKind kind, CancellationToken ct)
    {
        var code = kind switch { AssetKind.Image => "HA", AssetKind.Video => "VD", _ => "VB" };
        return await db.DocTypes.FirstOrDefaultAsync(x => x.Code == code && x.IsActive, ct)
               ?? await db.DocTypes.Where(x => x.IsActive).OrderBy(x => x.SortOrder).FirstOrDefaultAsync(ct);
    }

    private static async Task<Results<Ok<AssetDetailDto>, ValidationProblem, ProblemHttpResult>> UpdateAsync(Guid id, UpdateAssetRequest req,
        ClaimsPrincipal user, DocumentAccess access, DocumentsDbContext db, IEmployeeDirectory dir, DocClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var a = await db.Assets.Include(x => x.Versions).FirstOrDefaultAsync(x => x.Id == id && x.DeletedAt == null, ct);
        if (a is null || !DocumentAccess.CanView(v, a)) return Problems.NotFound("tài liệu");
        if (a.Status == AssetStatus.Destroyed || !await access.CanWriteAsync(v, a.SpaceKind, a.SpaceId, ct)) return Http.Forbidden("Không sửa được tài liệu này");
        var val = new Validation().Required(req.Title, "title", "Tiêu đề").MaxLength(req.Title?.Trim(), 300, "title", "Tiêu đề")
            .MaxLength(req.Description, 4000, "description", "Mô tả");
        if (req.FolderId is { } fid && !await db.Folders.AnyAsync(f => f.Id == fid && f.SpaceKind == a.SpaceKind && f.SpaceId == a.SpaceId, ct))
            val.Add("folderId", "Thư mục không thuộc kho này");
        if (req.DocTypeId != a.DocTypeId)
        {
            if (!DocumentRules.CanChangeType(a.Status)) val.Add("docTypeId", "Chỉ đổi loại khi tài liệu còn nháp");
            else if (await db.DocTypes.FirstOrDefaultAsync(x => x.Id == req.DocTypeId && x.IsActive, ct) is { } nt)
                a.RetentionUntil = DocumentRules.RetentionUntil(clock.DateOf(a.CreatedAt), nt.RetentionYears);
            else val.Add("docTypeId", "Loại tài liệu không tồn tại");
        }
        if (val.Failed) return val.Problem();
        a.Title = req.Title!.Trim();
        a.Description = string.IsNullOrWhiteSpace(req.Description) ? null : req.Description.Trim();
        a.Tags = DocumentRules.NormalizeTags(req.Tags);
        a.DocTypeId = req.DocTypeId;
        a.FolderId = req.FolderId;
        a.UpdatedAt = clock.Now;
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(await DetailAsync(a, v, access, db, dir, ct));
    }

    /// <summary>Phiên bản mới (chỉ khi còn nháp — đã ban hành thì khoá nội dung). Bản cũ vẫn giữ trên S3.</summary>
    private static async Task<Results<Ok<AssetDetailDto>, ProblemHttpResult>> AddVersionAsync(Guid id, NewVersionRequest req, ClaimsPrincipal user,
        DocumentAccess access, DocumentsDbContext db, IFileStorage files, IEmployeeDirectory dir, DocClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var a = await db.Assets.Include(x => x.Versions).FirstOrDefaultAsync(x => x.Id == id && x.DeletedAt == null, ct);
        if (a is null || !DocumentAccess.CanView(v, a)) return Problems.NotFound("tài liệu");
        if (!DocumentRules.CanChangeFile(a.Status)) return Problems.Conflict("Tài liệu đã gửi duyệt / ban hành — không thay file được");
        if (!await access.CanWriteAsync(v, a.SpaceKind, a.SpaceId, ct)) return Http.Forbidden();
        var (t, size, err) = await ClaimTicketAsync(req.TicketId, v, db, files, ct);
        if (err is not null) return err;
        var now = clock.Now;
        var n = a.Versions.Max(x => x.Number) + 1;
        var note = req.Note?.Trim();
        db.Versions.Add(new AssetVersion { AssetId = a.Id, Number = n, FileKey = t!.FileKey, FileName = t.FileName, ContentType = t.ContentType, Size = size,
            Note = string.IsNullOrEmpty(note) ? null : note.Length > 500 ? note[..500] : note, UploadedByUserId = v.UserId, UploadedByName = v.Name, UploadedAt = now });
        a.CurrentVersion = n;
        a.TotalSize += size;
        a.Kind = DocumentRules.KindOf(t.ContentType, t.FileName);
        a.UpdatedAt = now;
        db.UploadTickets.Remove(t);
        await db.SaveChangesAsync(ct);
        await db.Entry(a).Collection(x => x.Versions).LoadAsync(ct);
        return TypedResults.Ok(await DetailAsync(a, v, access, db, dir, ct));
    }

    // ---------------- Chi tiết / xem ----------------

    private static async Task<Results<Ok<AssetDetailDto>, ProblemHttpResult>> GetAsync(Guid id, ClaimsPrincipal user, DocumentAccess access,
        DocumentsDbContext db, IEmployeeDirectory dir, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var a = await db.Assets.AsNoTracking().Include(x => x.Versions).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a is null || !await CanSeeAsync(v, a, dir, ct)) return Problems.NotFound("tài liệu");
        return TypedResults.Ok(await DetailAsync(a, v, access, db, dir, ct));
    }

    /// <summary>Xem được kho, HOẶC là quản lý trực tiếp của người gửi khi tài liệu đang chờ mình duyệt ban hành. Thùng rác: chỉ chủ / người quản lý kho.</summary>
    private static async Task<bool> CanSeeAsync(Viewer v, Asset a, IEmployeeDirectory dir, CancellationToken ct)
    {
        if (a.DeletedAt is not null) return DocumentAccess.IsOwner(v, a) || DocumentAccess.CanManage(v, a.SpaceKind, a.SpaceId);
        if (DocumentAccess.CanView(v, a)) return true;
        return a.Status == AssetStatus.PendingApproval && v.Employee is { } me && a.CreatedByEmployeeId is { } cid
               && (await dir.GetAsync(cid, ct))?.ManagerId == me.Id;
    }

    internal static async Task<AssetDetailDto> DetailAsync(Asset a, Viewer v, DocumentAccess access, DocumentsDbContext db, IEmployeeDirectory dir,
        CancellationToken ct)
    {
        var types = await TypeNamesAsync(db, ct);
        var space = await access.SpaceAsync(a.SpaceKind, a.SpaceId, ct);
        string? path = null;
        if (a.FolderId is { } fid)
        {
            var folders = await db.Folders.AsNoTracking().Where(f => f.SpaceKind == a.SpaceKind && f.SpaceId == a.SpaceId).ToDictionaryAsync(f => f.Id, ct);
            var parts = new List<string>();
            for (Guid? cur = fid; cur is { } c && folders.TryGetValue(c, out var f) && parts.Count < 30; cur = f.ParentId) parts.Insert(0, f.Name);
            path = string.Join(" / ", parts);
        }
        var write = a.Status != AssetStatus.Destroyed && a.DeletedAt is null && await access.CanWriteAsync(v, a.SpaceKind, a.SpaceId, ct);
        var manage = DocumentAccess.CanManage(v, a.SpaceKind, a.SpaceId);
        var owner = DocumentAccess.IsOwner(v, a);
        var can = new AssetPermissions(
            Edit: write,
            ChangeFile: write && DocumentRules.CanChangeFile(a.Status),
            Delete: a.DeletedAt is null && DocumentRules.CanTrash(a.Status) && (owner || manage),
            Restore: a.DeletedAt is not null && (owner || manage),
            Purge: a.DeletedAt is not null && (owner || manage),
            Submit: a.DeletedAt is null && DocumentRules.CanSubmit(a.Status) && (owner || manage) && v.Employee is not null,
            Archive: a.DeletedAt is null && DocumentRules.CanArchive(a.Status) && (owner || manage),
            Manage: manage || owner,
            HrAdmin: v.IsHr);
        var versions = a.Versions.OrderByDescending(x => x.Number)
            .Select(x => new VersionDto(x.Number, x.FileName, x.ContentType, x.Size, x.Note, x.UploadedByName, x.UploadedAt, x.FileKey is not null)).ToList();
        return new AssetDetailDto(Row(a, types), a.Description, space?.Name ?? "?", path, a.CustodianEmployeeId, a.PublishedAt, a.ApprovalRequestId,
            a.RejectReason, a.DestroyedAt, a.DestroyReason, a.DestroyedByName, a.DeletedByName, versions, can);
    }

    /// <summary>
    /// Link presigned để xem / tải (ghi nhật ký). Mặc định bản hiện tại; xem trong trình duyệt với ảnh / video / âm thanh / PDF / văn bản thuần,
    /// còn lại tải về. Link video / âm thanh sống 3 giờ (tua khi đang xem), loại khác 15 phút.
    /// </summary>
    private static async Task<Results<Ok<FileUrlDto>, ProblemHttpResult>> FileAsync(Guid id, int? version, bool? download, ClaimsPrincipal user,
        HttpContext http, DocumentAccess access, DocumentsDbContext db, IFileStorage files, IEmployeeDirectory dir, DocClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var a = await db.Assets.AsNoTracking().Include(x => x.Versions).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a is null || !await CanSeeAsync(v, a, dir, ct)) return Problems.NotFound("tài liệu");
        var ver = a.Versions.FirstOrDefault(x => x.Number == (version ?? a.CurrentVersion));
        if (ver is null) return Problems.NotFound("phiên bản");
        if (ver.FileKey is null) return TypedResults.Problem("File đã bị huỷ theo hạn lưu trữ", statusCode: StatusCodes.Status410Gone);
        var kind = DocumentRules.KindOf(ver.ContentType, ver.FileName);
        var previewable = kind is AssetKind.Image or AssetKind.Video or AssetKind.Audio || ver.ContentType is "application/pdf" or "text/plain";
        var inline = download != true && previewable;
        var ttl = kind is AssetKind.Video or AssetKind.Audio ? TimeSpan.FromHours(3) : TimeSpan.FromMinutes(15);
        var url = await files.GetDownloadUrlAsync(ver.FileKey, ver.FileName, inline, ttl);
        db.AccessLogs.Add(new AccessLog { AssetId = a.Id, VersionNumber = ver.Number, UserId = v.UserId, UserName = v.Name,
            Action = inline ? AccessAction.View : AccessAction.Download, At = clock.Now, Ip = http.Connection.RemoteIpAddress?.ToString() });
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(new FileUrlDto(url, ver.FileName, ver.ContentType, kind, ver.Number, inline));
    }

    /// <summary>Nhật ký xem / tải: người phụ trách, người tạo, người quản lý kho, HR.</summary>
    private static async Task<Results<Ok<PagedResult<AccessLogDto>>, ProblemHttpResult>> AccessLogAsync(Guid id, int? page, int? pageSize, ClaimsPrincipal user,
        DocumentAccess access, DocumentsDbContext db, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var a = await db.Assets.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a is null) return Problems.NotFound("tài liệu");
        if (!DocumentAccess.IsOwner(v, a) && !DocumentAccess.CanManage(v, a.SpaceKind, a.SpaceId)) return Http.Forbidden("Chỉ người phụ trách / quản lý kho xem được nhật ký");
        var paged = await db.AccessLogs.AsNoTracking().Where(x => x.AssetId == id).OrderByDescending(x => x.At).ThenByDescending(x => x.Id)
            .ToPagedAsync(page ?? 1, pageSize, ct);
        return TypedResults.Ok(paged.Map(x => new AccessLogDto(x.At, x.UserName, x.Action, x.VersionNumber, x.Ip)));
    }

    // ---------------- Thùng rác ----------------

    private static async Task<Results<NoContent, ProblemHttpResult>> TrashAsync(Guid id, ClaimsPrincipal user, DocumentAccess access,
        DocumentsDbContext db, DocClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var a = await db.Assets.FirstOrDefaultAsync(x => x.Id == id && x.DeletedAt == null, ct);
        if (a is null || !DocumentAccess.CanView(v, a)) return Problems.NotFound("tài liệu");
        if (!DocumentRules.CanTrash(a.Status)) return Problems.Conflict("Chỉ xoá được tài liệu nháp — tài liệu đã ban hành chỉ lưu trữ hoặc huỷ theo hạn");
        if (!DocumentAccess.IsOwner(v, a) && !DocumentAccess.CanManage(v, a.SpaceKind, a.SpaceId)) return Http.Forbidden("Chỉ người phụ trách / quản lý kho được xoá");
        a.DeletedAt = clock.Now;
        a.DeletedByName = v.Name;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private static async Task<Results<NoContent, ProblemHttpResult>> RestoreAsync(Guid id, ClaimsPrincipal user, DocumentAccess access,
        DocumentsDbContext db, DocClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var a = await db.Assets.FirstOrDefaultAsync(x => x.Id == id && x.DeletedAt != null, ct);
        if (a is null) return Problems.NotFound("tài liệu trong thùng rác");
        if (!DocumentAccess.IsOwner(v, a) && !DocumentAccess.CanManage(v, a.SpaceKind, a.SpaceId)) return Http.Forbidden("Chỉ người phụ trách / quản lý kho được khôi phục");
        a.DeletedAt = null;
        a.DeletedByName = null;
        a.UpdatedAt = clock.Now;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    /// <summary>Xoá hẳn khỏi thùng rác: xoá mọi phiên bản trên S3 + hồ sơ (không khôi phục được).</summary>
    private static async Task<Results<NoContent, ProblemHttpResult>> PurgeAsync(Guid id, ClaimsPrincipal user, DocumentAccess access,
        DocumentsDbContext db, IFileStorage files, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var a = await db.Assets.Include(x => x.Versions).FirstOrDefaultAsync(x => x.Id == id && x.DeletedAt != null, ct);
        if (a is null) return Problems.NotFound("tài liệu trong thùng rác");
        if (!DocumentAccess.IsOwner(v, a) && !DocumentAccess.CanManage(v, a.SpaceKind, a.SpaceId)) return Http.Forbidden("Chỉ người phụ trách / quản lý kho được xoá hẳn");
        foreach (var ver in a.Versions.Where(x => x.FileKey is not null)) await files.DeleteAsync(ver.FileKey!, ct);
        db.Assets.Remove(a);
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    /// <summary>Thùng rác: HR thấy tất cả; người khác thấy tài liệu mình tạo / phụ trách và tài liệu trong kho mình quản lý.</summary>
    private static async Task<Ok<PagedResult<AssetRowDto>>> TrashListAsync(int? page, int? pageSize, ClaimsPrincipal user, DocumentAccess access,
        DocumentsDbContext db, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var q = db.Assets.AsNoTracking().Include(a => a.Versions).Where(a => a.DeletedAt != null);
        if (!v.IsHr)
        {
            var me = v.Employee?.Id;
            var managedDepts = v.ManagedDepartments.Select(d => (Guid?)d).ToList();
            var managedProjects = v.Projects.Where(p => p.Value == ProjectRole.Manager).Select(p => (Guid?)p.Key).ToList();
            q = q.Where(a => a.CreatedByUserId == v.UserId || (me != null && a.CustodianEmployeeId == me)
                             || (a.SpaceKind == SpaceKind.Department && managedDepts.Contains(a.SpaceId))
                             || (a.SpaceKind == SpaceKind.Project && managedProjects.Contains(a.SpaceId)));
        }
        var paged = await q.OrderByDescending(a => a.DeletedAt).ThenByDescending(a => a.Id).ToPagedAsync(page ?? 1, pageSize, ct);
        var types = await TypeNamesAsync(db, ct);
        return TypedResults.Ok(paged.Map(a => Row(a, types)));
    }

    // ---------------- Vòng đời ----------------

    /// <summary>Gửi duyệt ban hành: bước Quản lý trực tiếp (không có → HR). Duyệt xong mới có số hiệu (DocumentPublishHandler).</summary>
    private static async Task<Results<Ok<AssetDetailDto>, ProblemHttpResult>> SubmitAsync(Guid id, ClaimsPrincipal user, DocumentAccess access,
        DocumentsDbContext db, IApprovalService approvals, IEmployeeDirectory dir, DocClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var a = await db.Assets.Include(x => x.Versions).FirstOrDefaultAsync(x => x.Id == id && x.DeletedAt == null, ct);
        if (a is null || !DocumentAccess.CanView(v, a)) return Problems.NotFound("tài liệu");
        if (!DocumentRules.CanSubmit(a.Status)) return Problems.Conflict("Chỉ gửi duyệt được tài liệu nháp");
        if (!DocumentAccess.IsOwner(v, a) && !DocumentAccess.CanManage(v, a.SpaceKind, a.SpaceId)) return Http.Forbidden("Chỉ người phụ trách / quản lý kho được gửi duyệt");
        if (v.Employee is not { } me) return Http.NoProfile();
        var types = await TypeNamesAsync(db, ct);
        var space = await access.SpaceAsync(a.SpaceKind, a.SpaceId, ct);
        var cur = a.Versions.First(x => x.Number == a.CurrentVersion);
        a.Status = AssetStatus.PendingApproval;
        a.RejectReason = null;
        a.UpdatedAt = clock.Now;
        await db.SaveChangesAsync(ct);
        try
        {
            a.ApprovalRequestId = await approvals.SubmitAsync(new ApprovalSubmission(ApprovalTypes.DocumentPublish, a.Id, me.Id,
                $"Ban hành tài liệu: {a.Title}",
                $"{a.Code} · {types.GetValueOrDefault(a.DocTypeId, "?")} · kho {space?.Name}\n{cur.FileName} (phiên bản {cur.Number})",
                [ApprovalStepKind.Manager]), ct);
        }
        catch
        {
            a.Status = AssetStatus.Draft;
            await db.SaveChangesAsync(CancellationToken.None);
            throw;
        }
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(await DetailAsync(a, v, access, db, dir, ct));
    }

    private static async Task<Results<Ok<AssetDetailDto>, ProblemHttpResult>> ArchiveAsync(Guid id, ClaimsPrincipal user, DocumentAccess access,
        DocumentsDbContext db, IEmployeeDirectory dir, DocClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var a = await db.Assets.Include(x => x.Versions).FirstOrDefaultAsync(x => x.Id == id && x.DeletedAt == null, ct);
        if (a is null || !DocumentAccess.CanView(v, a)) return Problems.NotFound("tài liệu");
        if (!DocumentRules.CanArchive(a.Status)) return Problems.Conflict("Chỉ lưu trữ được tài liệu đã ban hành");
        if (!DocumentAccess.IsOwner(v, a) && !DocumentAccess.CanManage(v, a.SpaceKind, a.SpaceId)) return Http.Forbidden("Chỉ người phụ trách / quản lý kho được lưu trữ");
        a.Status = AssetStatus.Archived;
        a.UpdatedAt = clock.Now;
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(await DetailAsync(a, v, access, db, dir, ct));
    }

    private static async Task<Results<Ok<AssetDetailDto>, ValidationProblem, ProblemHttpResult>> CustodianAsync(Guid id, CustodianRequest req,
        ClaimsPrincipal user, DocumentAccess access, DocumentsDbContext db, IEmployeeDirectory dir, DocClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var a = await db.Assets.Include(x => x.Versions).FirstOrDefaultAsync(x => x.Id == id && x.DeletedAt == null, ct);
        if (a is null || !DocumentAccess.CanView(v, a)) return Problems.NotFound("tài liệu");
        if (!DocumentAccess.IsOwner(v, a) && !DocumentAccess.CanManage(v, a.SpaceKind, a.SpaceId)) return Http.Forbidden("Chỉ người phụ trách / quản lý kho được đổi người phụ trách");
        if (await dir.GetAsync(req.EmployeeId, ct) is not { IsActive: true } e) return new Validation().Add("employeeId", "Nhân viên không tồn tại hoặc đã nghỉ việc").Problem();
        a.CustodianEmployeeId = e.Id;
        a.CustodianName = e.FullName;
        a.UpdatedAt = clock.Now;
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(await DetailAsync(a, v, access, db, dir, ct));
    }
}
