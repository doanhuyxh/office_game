using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.BuildingBlocks.Security;
using OfficeHub.Modules.Assets.Domain;
using OfficeHub.Modules.Assets.Infrastructure;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Assets.Features;

/// <summary>
/// Tài khoản mạng xã hội (Facebook Business Manager) — chỉ HR: đăng ký, token System User (mã hoá, chỉ ghi), đồng bộ trang, bàn giao / thu hồi
/// cho nhân viên, ngừng dùng. Token không bao giờ trả ra API.
/// </summary>
internal static class SocialAccountEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        var hr = g.MapGroup("/social/accounts").RequireAuthorization(AuthPolicies.Hr);
        hr.MapGet("", ListAsync);
        hr.MapPost("", CreateAsync);
        hr.MapGet("/{id:guid}", GetAsync);
        hr.MapPut("/{id:guid}", UpdateAsync);
        hr.MapPut("/{id:guid}/token", SetTokenAsync);
        hr.MapPost("/{id:guid}/sync", SyncAsync);
        hr.MapPost("/{id:guid}/assign", AssignAsync);
        hr.MapPost("/{id:guid}/return", ReturnAsync);
        hr.MapPost("/{id:guid}/status", StatusAsync);
    }

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    internal static SocialAccountDto ToDto(SocialAccount a, int pages, IReadOnlyDictionary<Guid, EmployeeRef> emps, IReadOnlyDictionary<Guid, DepartmentRef> depts)
    {
        var h = a.HolderEmployeeId is { } id ? emps.GetValueOrDefault(id) : null;
        return new(a.Id, a.Platform, a.Name, a.ExternalId, a.LoginHint, a.OwnerDepartmentId,
            a.OwnerDepartmentId is { } d ? depts.GetValueOrDefault(d)?.Name : null, a.Status, a.HolderEmployeeId, h?.FullName, h?.Code, a.Note,
            a.TokenEncrypted is not null, a.TokenStatus, a.TokenError, a.TokenCheckedAt, a.TokenOwnerName, a.PagesSyncedAt, pages, a.CreatedAt);
    }

    internal static SocialPageDto ToDto(SocialPage p, string accountName) =>
        new(p.Id, p.AccountId, accountName, p.ExternalId, p.Name, p.Category, p.Link, p.PictureUrl, p.IsActive, p.IsActive && p.TokenEncrypted is not null,
            p.SyncedAt);

    private static async Task<Dictionary<Guid, DepartmentRef>> DeptsAsync(IEmployeeDirectory dir, CancellationToken ct) =>
        (await dir.ListDepartmentsAsync(ct)).ToDictionary(d => d.Id);

    private static async Task<Ok<List<SocialAccountDto>>> ListAsync(AssetsDbContext db, AssetAccess access, IEmployeeDirectory dir, CancellationToken ct)
    {
        var emps = await access.EmployeesAsync(ct);
        var depts = await DeptsAsync(dir, ct);
        var counts = await db.SocialPages.AsNoTracking().Where(p => p.IsActive).GroupBy(p => p.AccountId)
            .Select(x => new { x.Key, N = x.Count() }).ToDictionaryAsync(x => x.Key, x => x.N, ct);
        var rows = await db.SocialAccounts.AsNoTracking().OrderBy(a => a.Status).ThenBy(a => a.Name).ToListAsync(ct);
        return TypedResults.Ok(rows.Select(a => ToDto(a, counts.GetValueOrDefault(a.Id), emps, depts)).ToList());
    }

    private static async Task<SocialAccountDetailDto> DetailAsync(SocialAccount a, AssetsDbContext db, AssetAccess access, IEmployeeDirectory dir,
        CancellationToken ct)
    {
        var emps = await access.EmployeesAsync(ct);
        var pages = await db.SocialPages.AsNoTracking().Where(p => p.AccountId == a.Id).OrderByDescending(p => p.IsActive).ThenBy(p => p.Name).ToListAsync(ct);
        var history = await db.SocialAssignments.AsNoTracking().Where(x => x.AccountId == a.Id).OrderByDescending(x => x.AssignedAt).ToListAsync(ct);
        return new(ToDto(a, pages.Count(p => p.IsActive), emps, await DeptsAsync(dir, ct)), [.. pages.Select(p => ToDto(p, a.Name))],
            [.. history.Select(x =>
            {
                var e = emps.GetValueOrDefault(x.EmployeeId);
                return new SocialAssignmentDto(x.Id, x.EmployeeId, e?.FullName ?? "(không rõ)", e?.Code ?? "", x.AssignedAt, x.AssignedByName, x.AssignNote,
                    x.ReturnedAt, x.ReturnedByName, x.ReturnNote);
            })]);
    }

    private static async Task<Results<Ok<SocialAccountDetailDto>, ProblemHttpResult>> GetAsync(Guid id, AssetsDbContext db, AssetAccess access,
        IEmployeeDirectory dir, CancellationToken ct)
    {
        var a = await db.SocialAccounts.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        return a is null ? Problems.NotFound("tài khoản mạng xã hội") : TypedResults.Ok(await DetailAsync(a, db, access, dir, ct));
    }

    private static async Task<Validation> ValidateAsync(SocialAccountRequest r, Guid? id, AssetsDbContext db, IEmployeeDirectory dir, CancellationToken ct)
    {
        var ext = Clean(r.ExternalId);
        var v = new Validation()
            .Required(r.Name, "name", "Tên tài khoản").MaxLength(r.Name?.Trim(), 200, "name", "Tên tài khoản")
            .MaxLength(ext, 50, "externalId", "ID Business Manager").MaxLength(r.LoginHint?.Trim(), 200, "loginHint", "Email / SĐT quản trị")
            .MaxLength(r.Note?.Trim(), 2000, "note", "Ghi chú")
            .When(ext is not null && !ext.All(char.IsAsciiDigit), "externalId", "ID Business Manager chỉ gồm chữ số");
        if (ext is not null && await db.SocialAccounts.AnyAsync(a => a.Platform == SocialPlatform.Facebook && a.ExternalId == ext && a.Id != id, ct))
            v.Add("externalId", "Business Manager này đã được đăng ký");
        if (r.OwnerDepartmentId is { } d && (await dir.ListDepartmentsAsync(ct)).All(x => x.Id != d)) v.Add("ownerDepartmentId", "Phòng ban không tồn tại");
        return v;
    }

    private static async Task<Results<Ok<SocialAccountDetailDto>, ValidationProblem>> CreateAsync(SocialAccountRequest req, AssetsDbContext db,
        AssetAccess access, IEmployeeDirectory dir, IFieldEncryptor enc, SocialService social, AssetClock clock, CancellationToken ct)
    {
        var v = await ValidateAsync(req, null, db, dir, ct);
        var token = Clean(req.Token);
        v.MaxLength(token, 4000, "token", "Token");
        if (v.Failed) return v.Problem();
        var a = new SocialAccount
        {
            Platform = SocialPlatform.Facebook, Name = req.Name!.Trim(), ExternalId = Clean(req.ExternalId), LoginHint = Clean(req.LoginHint),
            OwnerDepartmentId = req.OwnerDepartmentId, Note = Clean(req.Note), Status = SocialAccountStatus.Active, CreatedAt = clock.Now,
            TokenEncrypted = token is null ? null : enc.Encrypt(token),
        };
        db.SocialAccounts.Add(a);
        await db.SaveChangesAsync(ct);
        if (token is not null) await social.CheckAndSyncAsync(a, ct);
        return TypedResults.Ok(await DetailAsync(a, db, access, dir, ct));
    }

    private static async Task<Results<Ok<SocialAccountDetailDto>, ValidationProblem, ProblemHttpResult>> UpdateAsync(Guid id, SocialAccountRequest req,
        AssetsDbContext db, AssetAccess access, IEmployeeDirectory dir, AssetClock clock, CancellationToken ct)
    {
        var a = await db.SocialAccounts.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a is null) return Problems.NotFound("tài khoản mạng xã hội");
        var v = await ValidateAsync(req, id, db, dir, ct);
        if (v.Failed) return v.Problem();
        a.Name = req.Name!.Trim();
        a.ExternalId = Clean(req.ExternalId);
        a.LoginHint = Clean(req.LoginHint);
        a.OwnerDepartmentId = req.OwnerDepartmentId;
        a.Note = Clean(req.Note);
        a.UpdatedAt = clock.Now;
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(await DetailAsync(a, db, access, dir, ct));
    }

    /// <summary>Đặt token mới (chỉ ghi) → kiểm tra với Facebook + đồng bộ trang. Token sai vẫn lưu (trạng thái "Lỗi" + lý do) để HR thấy.</summary>
    private static async Task<Results<Ok<SocialAccountDetailDto>, ValidationProblem, ProblemHttpResult>> SetTokenAsync(Guid id, SocialTokenRequest req,
        AssetsDbContext db, AssetAccess access, IEmployeeDirectory dir, IFieldEncryptor enc, SocialService social, AssetClock clock, CancellationToken ct)
    {
        var a = await db.SocialAccounts.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a is null) return Problems.NotFound("tài khoản mạng xã hội");
        var token = Clean(req.Token);
        var v = new Validation().Required(token, "token", "Token").MaxLength(token, 4000, "token", "Token")
            .When(token is not null && token.Any(char.IsWhiteSpace), "token", "Token không được chứa khoảng trắng");
        if (v.Failed) return v.Problem();
        a.TokenEncrypted = enc.Encrypt(token!);
        a.TokenStatus = SocialTokenStatus.None;
        a.TokenError = null;
        a.UpdatedAt = clock.Now;
        await db.SaveChangesAsync(ct);
        await social.CheckAndSyncAsync(a, ct);
        return TypedResults.Ok(await DetailAsync(a, db, access, dir, ct));
    }

    private static async Task<Results<Ok<SocialAccountDetailDto>, ProblemHttpResult>> SyncAsync(Guid id, AssetsDbContext db, AssetAccess access,
        IEmployeeDirectory dir, SocialService social, CancellationToken ct)
    {
        var a = await db.SocialAccounts.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a is null) return Problems.NotFound("tài khoản mạng xã hội");
        if (a.TokenEncrypted is null) return Problems.Conflict("Chưa nhập token System User");
        await social.CheckAndSyncAsync(a, ct);
        return TypedResults.Ok(await DetailAsync(a, db, access, dir, ct));
    }

    private static async Task<Results<Ok<SocialAccountDetailDto>, ValidationProblem, ProblemHttpResult>> AssignAsync(Guid id, AssignRequest req,
        ClaimsPrincipal user, AssetsDbContext db, AssetAccess access, AssetOps ops, IEmployeeDirectory dir, AssetClock clock, CancellationToken ct)
    {
        var a = await db.SocialAccounts.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a is null) return Problems.NotFound("tài khoản mạng xã hội");
        var v = new Validation().Required(req.EmployeeId?.ToString(), "employeeId", "Nhân viên").MaxLength(req.Note?.Trim(), 1000, "note", "Ghi chú");
        if (v.Failed) return v.Problem();
        var emp = await dir.GetAsync(req.EmployeeId!.Value, ct);
        if (SocialRules.CannotAssign(a.Status, a.HolderEmployeeId, emp is { IsActive: true }) is { } err)
            return emp is { IsActive: true } ? Problems.Conflict(err) : new Validation().Add("employeeId", err).Problem();
        var me = await access.ViewerAsync(user, ct);
        db.SocialAssignments.Add(new SocialAccountAssignment
        {
            AccountId = a.Id, EmployeeId = emp!.Id, AssignedAt = clock.Now, AssignedByName = me.Name, AssignNote = Clean(req.Note),
        });
        a.HolderEmployeeId = emp.Id;
        a.UpdatedAt = clock.Now;
        await db.SaveChangesAsync(ct);
        var pages = await db.SocialPages.CountAsync(p => p.AccountId == a.Id && p.IsActive, ct);
        await ops.NotifyEmployeeAsync(emp.Id, NotificationCategories.AssetAssigned, $"Bạn được bàn giao Business Manager \"{a.Name}\"",
            $"Bạn có thể đăng bài lên {pages} trang của BM này tại Đăng bài MXH.", email: true, link: "/social");
        return TypedResults.Ok(await DetailAsync(a, db, access, dir, ct));
    }

    /// <summary>Thu hồi BM: đóng bàn giao + huỷ bài đang chờ đăng của người đó trên các trang của BM.</summary>
    private static async Task<Results<Ok<SocialAccountDetailDto>, ProblemHttpResult>> ReturnAsync(Guid id, ReturnRequest req, ClaimsPrincipal user,
        AssetsDbContext db, AssetAccess access, AssetOps ops, SocialService social, IEmployeeDirectory dir, AssetClock clock, CancellationToken ct)
    {
        var a = await db.SocialAccounts.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a is null) return Problems.NotFound("tài khoản mạng xã hội");
        if (a.HolderEmployeeId is not { } holder) return Problems.Conflict("Tài khoản chưa giao cho ai");
        var me = await access.ViewerAsync(user, ct);
        await ReturnCoreAsync(a, holder, Clean(req.Note), me.Name, db, social, clock, ct);
        await db.SaveChangesAsync(ct);
        await ops.NotifyEmployeeAsync(holder, NotificationCategories.AssetReturned, $"Business Manager \"{a.Name}\" đã được thu hồi",
            "Bạn không còn đăng bài lên các trang của BM này; bài hẹn giờ chưa đăng đã được huỷ.", email: false, link: "/social");
        return TypedResults.Ok(await DetailAsync(a, db, access, dir, ct));
    }

    internal static async Task ReturnCoreAsync(SocialAccount a, Guid holder, string? note, string byName, AssetsDbContext db, SocialService social,
        AssetClock clock, CancellationToken ct)
    {
        foreach (var x in await db.SocialAssignments.Where(x => x.AccountId == a.Id && x.ReturnedAt == null).ToListAsync(ct))
        {
            x.ReturnedAt = clock.Now;
            x.ReturnedByName = byName;
            x.ReturnNote = note;
        }
        await social.CancelPendingAsync(a.Id, holder, "Đã huỷ vì BM được thu hồi khỏi người đăng", byName, ct);
        a.HolderEmployeeId = null;
        a.UpdatedAt = clock.Now;
    }

    /// <summary>Ngừng dùng (phải thu hồi trước; huỷ mọi bài chờ trên trang của BM) ↔ dùng lại.</summary>
    private static async Task<Results<Ok<SocialAccountDetailDto>, ProblemHttpResult>> StatusAsync(Guid id, SocialStatusRequest req, ClaimsPrincipal user,
        AssetsDbContext db, AssetAccess access, SocialService social, IEmployeeDirectory dir, AssetClock clock, CancellationToken ct)
    {
        var a = await db.SocialAccounts.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a is null) return Problems.NotFound("tài khoản mạng xã hội");
        if (!Enum.IsDefined(req.Status)) return Problems.Conflict("Trạng thái không hợp lệ");
        if (a.Status == req.Status) return TypedResults.Ok(await DetailAsync(a, db, access, dir, ct));
        if (req.Status == SocialAccountStatus.Disabled)
        {
            if (SocialRules.CannotDisable(a.HolderEmployeeId) is { } err) return Problems.Conflict(err);
            var me = await access.ViewerAsync(user, ct);
            await social.CancelPendingAsync(a.Id, null, "Đã huỷ vì BM ngừng dùng", me.Name, ct);
        }
        a.Status = req.Status;
        a.UpdatedAt = clock.Now;
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(await DetailAsync(a, db, access, dir, ct));
    }
}
