using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.BuildingBlocks.Storage;
using OfficeHub.Modules.Documents.Domain;
using OfficeHub.Modules.Documents.Infrastructure;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Documents.Features;

/// <summary>Quản trị kho (HR / admin): loại tài liệu, bảng tài sản số, hạn lưu trữ + huỷ, bàn giao tài liệu của người nghỉ việc.</summary>
internal static class AdminEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/doc-types", TypesAsync);
        g.MapPost("/doc-types", CreateTypeAsync).RequireAuthorization(AuthPolicies.Hr);
        g.MapPut("/doc-types/{id:guid}", UpdateTypeAsync).RequireAuthorization(AuthPolicies.Hr);

        var hr = g.MapGroup("/admin").RequireAuthorization(AuthPolicies.Hr);
        hr.MapGet("/stats", StatsAsync);
        hr.MapGet("/retention", RetentionDueAsync);
        hr.MapGet("/orphans", OrphansAsync);
        hr.MapPost("/handover", HandoverAsync);
        hr.MapPut("/assets/{id:guid}/retention", SetRetentionAsync);
        hr.MapPost("/assets/{id:guid}/destroy", DestroyAsync);
    }

    // ---------------- Loại tài liệu ----------------

    private static async Task<Ok<List<DocTypeDto>>> TypesAsync(DocumentsDbContext db, CancellationToken ct) =>
        TypedResults.Ok(await db.DocTypes.AsNoTracking().OrderBy(t => t.SortOrder).ThenBy(t => t.Name)
            .Select(t => new DocTypeDto(t.Id, t.Code, t.Name, t.RetentionYears, t.SortOrder, t.IsActive)).ToListAsync(ct));

    private static Validation ValidateType(DocTypeRequest req) => new Validation()
        .Required(req.Code, "code", "Mã loại").MaxLength(req.Code?.Trim(), 10, "code", "Mã loại")
        .Required(req.Name, "name", "Tên loại").MaxLength(req.Name?.Trim(), 100, "name", "Tên loại")
        .When(req.RetentionYears is < 1 or > 100, "retentionYears", "Số năm lưu trữ từ 1 đến 100 (bỏ trống = vĩnh viễn)");

    private static async Task<Results<Ok<DocTypeDto>, ValidationProblem>> CreateTypeAsync(DocTypeRequest req, DocumentsDbContext db, CancellationToken ct)
    {
        var v = ValidateType(req);
        var code = req.Code?.Trim().ToUpperInvariant();
        if (!v.Has("code") && await db.DocTypes.AnyAsync(t => t.Code == code, ct)) v.Add("code", "Mã loại đã tồn tại");
        if (v.Failed) return v.Problem();
        var t = new DocType { Code = code!, Name = req.Name!.Trim(), RetentionYears = req.RetentionYears, SortOrder = req.SortOrder, IsActive = req.IsActive };
        db.DocTypes.Add(t);
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(new DocTypeDto(t.Id, t.Code, t.Name, t.RetentionYears, t.SortOrder, t.IsActive));
    }

    /// <summary>Đổi số năm chỉ áp dụng cho tài liệu tạo / ban hành SAU đó (hạn của tài liệu cũ giữ nguyên, HR đổi riêng từng cái).</summary>
    private static async Task<Results<Ok<DocTypeDto>, ValidationProblem, ProblemHttpResult>> UpdateTypeAsync(Guid id, DocTypeRequest req,
        DocumentsDbContext db, CancellationToken ct)
    {
        var t = await db.DocTypes.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (t is null) return Problems.NotFound("loại tài liệu");
        var v = ValidateType(req);
        var code = req.Code?.Trim().ToUpperInvariant();
        if (!v.Has("code") && await db.DocTypes.AnyAsync(x => x.Id != id && x.Code == code, ct)) v.Add("code", "Mã loại đã tồn tại");
        if (v.Failed) return v.Problem();
        t.Code = code!;
        t.Name = req.Name!.Trim();
        t.RetentionYears = req.RetentionYears;
        t.SortOrder = req.SortOrder;
        t.IsActive = req.IsActive;
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(new DocTypeDto(t.Id, t.Code, t.Name, t.RetentionYears, t.SortOrder, t.IsActive));
    }

    // ---------------- Bảng tài sản số ----------------

    private static readonly Dictionary<AssetKind, string> KindLabel = new()
    {
        [AssetKind.Document] = "Văn bản", [AssetKind.Image] = "Hình ảnh", [AssetKind.Video] = "Video",
        [AssetKind.Audio] = "Âm thanh", [AssetKind.Archive] = "File nén", [AssetKind.Other] = "Khác",
    };

    /// <summary>Tổng quan: số lượng / dung lượng theo kho, nhóm file, loại tài liệu, 12 tháng gần nhất; tài liệu mồ côi, sắp hết hạn, thùng rác.</summary>
    private static async Task<Ok<StatsDto>> StatsAsync(DocumentAccess access, DocumentsDbContext db, IEmployeeDirectory dir, DocClock clock, CancellationToken ct)
    {
        var live = db.Assets.AsNoTracking().Where(a => a.DeletedAt == null && a.Status != AssetStatus.Destroyed);
        var rows = await live.Select(a => new { a.SpaceKind, a.SpaceId, a.Kind, a.DocTypeId, a.Status, a.TotalSize, a.CreatedAt, a.CustodianEmployeeId })
            .ToListAsync(ct);
        var depts = (await access.DepartmentsAsync(ct)).ToDictionary(d => d.Id, d => d.Name);
        var projects = await db.Projects.AsNoTracking().IgnoreQueryFilters().ToDictionaryAsync(p => p.Id, p => p.Name, ct);
        var types = await AssetEndpoints.TypeNamesAsync(db, ct);
        string SpaceName(SpaceKind k, Guid? id) => k switch
        {
            SpaceKind.Company => "Công ty",
            SpaceKind.Department => id is { } d ? depts.GetValueOrDefault(d, "(phòng đã xoá)") : "?",
            _ => id is { } p ? $"Dự án {projects.GetValueOrDefault(p, "?")}" : "?",
        };
        var active = (await dir.ListActiveAsync(ct)).Select(e => e.Id).ToHashSet();
        var today = clock.Today;
        var horizon = today.AddDays(DocumentRules.RetentionNoticeDays);
        var firstMonth = new DateOnly(today.Year, today.Month, 1).AddMonths(-11);
        var monthly = Enumerable.Range(0, 12).Select(i => firstMonth.AddMonths(i)).Select(m =>
        {
            var inMonth = rows.Where(r => clock.DateOf(r.CreatedAt) is var d && d.Year == m.Year && d.Month == m.Month).ToList();
            return new CountSize(m.ToString("yyyy-MM"), $"T{m.Month}/{m.Year % 100:D2}", inMonth.Count, inMonth.Sum(r => r.TotalSize));
        }).ToList();
        return TypedResults.Ok(new StatsDto(
            rows.Count, rows.Sum(r => r.TotalSize),
            rows.Count(r => r.Status == AssetStatus.Published), rows.Count(r => r.Status == AssetStatus.Draft),
            rows.Count(r => r.Status == AssetStatus.PendingApproval),
            await db.Assets.CountAsync(a => a.DeletedAt != null, ct),
            rows.Count(r => r.CustodianEmployeeId is { } c && !active.Contains(c)),
            await live.CountAsync(a => a.RetentionUntil != null && a.RetentionUntil <= horizon, ct),
            rows.GroupBy(r => (r.SpaceKind, r.SpaceId)).Select(g => new CountSize($"{g.Key.SpaceKind}:{g.Key.SpaceId}", SpaceName(g.Key.SpaceKind, g.Key.SpaceId),
                g.Count(), g.Sum(r => r.TotalSize))).OrderByDescending(x => x.Size).ToList(),
            rows.GroupBy(r => r.Kind).Select(g => new CountSize(g.Key.ToString(), KindLabel[g.Key], g.Count(), g.Sum(r => r.TotalSize)))
                .OrderByDescending(x => x.Size).ToList(),
            rows.GroupBy(r => r.DocTypeId).Select(g => new CountSize(g.Key.ToString(), types.GetValueOrDefault(g.Key, "?"), g.Count(), g.Sum(r => r.TotalSize)))
                .OrderByDescending(x => x.Count).ToList(),
            monthly));
    }

    /// <summary>Tài liệu đã / sắp hết hạn lưu trữ (≤ 30 ngày), hạn gần nhất trước.</summary>
    private static async Task<Ok<PagedResult<AssetRowDto>>> RetentionDueAsync(int? page, int? pageSize, DocumentsDbContext db, DocClock clock, CancellationToken ct)
    {
        var horizon = clock.Today.AddDays(DocumentRules.RetentionNoticeDays);
        var paged = await db.Assets.AsNoTracking().Include(a => a.Versions)
            .Where(a => a.DeletedAt == null && a.Status != AssetStatus.Destroyed && a.RetentionUntil != null && a.RetentionUntil <= horizon)
            .OrderBy(a => a.RetentionUntil).ThenBy(a => a.Id).ToPagedAsync(page ?? 1, pageSize, ct);
        var types = await AssetEndpoints.TypeNamesAsync(db, ct);
        return TypedResults.Ok(paged.Map(a => AssetEndpoints.Row(a, types)));
    }

    private static async Task<Results<NoContent, ValidationProblem, ProblemHttpResult>> SetRetentionAsync(Guid id, RetentionRequest req,
        DocumentsDbContext db, DocClock clock, CancellationToken ct)
    {
        var a = await db.Assets.FirstOrDefaultAsync(x => x.Id == id && x.DeletedAt == null, ct);
        if (a is null) return Problems.NotFound("tài liệu");
        if (a.Status == AssetStatus.Destroyed) return Problems.Conflict("Tài liệu đã huỷ");
        if (req.Until is { } u && u <= clock.Today) return new Validation().Add("until", "Hạn mới phải sau hôm nay").Problem();
        a.RetentionUntil = req.Until;
        a.RetentionNotifiedAt = null;
        a.UpdatedAt = clock.Now;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    /// <summary>
    /// Huỷ tài liệu (HR, bắt buộc lý do): xoá file mọi phiên bản trên S3, giữ hồ sơ làm biên bản (ai huỷ, khi nào, lý do, mã, số hiệu).
    /// Không khôi phục được.
    /// </summary>
    private static async Task<Results<NoContent, ValidationProblem, ProblemHttpResult>> DestroyAsync(Guid id, DestroyRequest req, ClaimsPrincipal user,
        DocumentAccess access, DocumentsDbContext db, IFileStorage files, DocClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var a = await db.Assets.Include(x => x.Versions).FirstOrDefaultAsync(x => x.Id == id && x.DeletedAt == null, ct);
        if (a is null) return Problems.NotFound("tài liệu");
        if (!DocumentRules.CanDestroy(a.Status)) return Problems.Conflict("Tài liệu đang chờ duyệt hoặc đã huỷ");
        var reason = req.Reason?.Trim();
        var val = new Validation().Required(reason, "reason", "Lý do huỷ").MaxLength(reason, 1000, "reason", "Lý do huỷ");
        if (val.Failed) return val.Problem();
        foreach (var ver in a.Versions.Where(x => x.FileKey is not null))
        {
            await files.DeleteAsync(ver.FileKey!, ct);
            ver.FileKey = null;
        }
        a.Status = AssetStatus.Destroyed;
        a.DestroyedAt = clock.Now;
        a.DestroyReason = reason;
        a.DestroyedByName = v.Name;
        a.UpdatedAt = clock.Now;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    // ---------------- Bàn giao ----------------

    /// <summary>Người phụ trách tài liệu đã nghỉ việc (hoặc không còn hồ sơ) — cần HR bàn giao.</summary>
    private static async Task<Ok<List<OrphanDto>>> OrphansAsync(DocumentsDbContext db, IEmployeeDirectory dir, CancellationToken ct)
    {
        var groups = await db.Assets.AsNoTracking().Where(a => a.DeletedAt == null && a.Status != AssetStatus.Destroyed && a.CustodianEmployeeId != null)
            .GroupBy(a => a.CustodianEmployeeId).Select(g => new { Id = g.Key!.Value, Count = g.Count(), Size = g.Sum(a => a.TotalSize) }).ToListAsync(ct);
        var active = (await dir.ListActiveAsync(ct)).Select(e => e.Id).ToHashSet();
        var list = new List<OrphanDto>();
        foreach (var g in groups.Where(g => !active.Contains(g.Id)))
        {
            var e = await dir.GetAsync(g.Id, ct);
            list.Add(new OrphanDto(g.Id, e?.Code, e?.FullName ?? "(không rõ)", e?.LeftAt, g.Count, g.Size));
        }
        return TypedResults.Ok(list.OrderByDescending(x => x.AssetCount).ToList());
    }

    /// <summary>
    /// Chuyển mọi tài liệu người A phụ trách sang người B (đang làm việc); B cũng được thêm vào các dự án A tham gia (giữ vai trò).
    /// Báo B qua chuông + email.
    /// </summary>
    private static async Task<Results<Ok<int>, ValidationProblem>> HandoverAsync(HandoverRequest req, ClaimsPrincipal user, DocumentAccess access,
        DocumentsDbContext db, IEmployeeDirectory dir, INotifier notifier, DocClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var val = new Validation().When(req.FromEmployeeId == req.ToEmployeeId, "toEmployeeId", "Chọn người nhận khác người giao");
        var to = await dir.GetAsync(req.ToEmployeeId, ct);
        if (to is not { IsActive: true }) val.Add("toEmployeeId", "Người nhận không tồn tại hoặc đã nghỉ việc");
        var from = await dir.GetAsync(req.FromEmployeeId, ct);
        if (from is null) val.Add("fromEmployeeId", "Không tìm thấy người giao");
        if (val.Failed) return val.Problem();

        var now = clock.Now;
        var n = await db.Assets.Where(a => a.CustodianEmployeeId == req.FromEmployeeId && a.DeletedAt == null && a.Status != AssetStatus.Destroyed)
            .ExecuteUpdateAsync(s => s.SetProperty(a => a.CustodianEmployeeId, to!.Id).SetProperty(a => a.CustodianName, to.FullName)
                .SetProperty(a => a.UpdatedAt, now), ct);
        var memberships = await db.ProjectMembers.Where(m => m.EmployeeId == req.FromEmployeeId).ToListAsync(ct);
        foreach (var m in memberships)
            if (!await db.ProjectMembers.AnyAsync(x => x.ProjectId == m.ProjectId && x.EmployeeId == to!.Id, ct))
                db.ProjectMembers.Add(new ProjectMember { ProjectId = m.ProjectId, EmployeeId = to!.Id, Role = m.Role, AddedAt = now });
        await db.SaveChangesAsync(ct);
        if (to!.UserId is { } uid && (n > 0 || memberships.Count > 0))
            await notifier.NotifyAsync(new NotificationRequest([uid], NotificationCategories.DocumentHandover,
                $"Bạn được bàn giao {n} tài liệu của {from!.FullName}",
                $"{v.Name} đã chuyển cho bạn phụ trách {n} tài liệu{(memberships.Count > 0 ? $" và {memberships.Count} dự án" : "")} của {from.Code} · {from.FullName}.",
                "/documents"), ct);
        return TypedResults.Ok(n);
    }
}
