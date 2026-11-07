using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Identity.Contracts;
using OfficeHub.Modules.Organization.Contracts;
using OfficeHub.Modules.Organization.Domain;
using OfficeHub.Modules.Organization.Infrastructure;

namespace OfficeHub.Modules.Organization.Features.Employees;

internal static class EmployeeEndpoints
{
    public static void Map(RouteGroupBuilder org)
    {
        var g = org.MapGroup("/employees").WithTags("Organization");
        g.MapGet("/", ListAsync);
        g.MapGet("/me", MeAsync);
        g.MapGet("/next-code", GetNextCodeAsync).RequireAuthorization(AuthPolicies.Hr);
        g.MapGet("/{id:guid}", GetAsync);
        g.MapPost("/", CreateAsync).RequireAuthorization(AuthPolicies.Hr);
        g.MapPut("/{id:guid}", UpdateAsync).RequireAuthorization(AuthPolicies.Hr);
        g.MapPost("/{id:guid}/resign", ResignAsync).RequireAuthorization(AuthPolicies.Hr);
        g.MapPost("/{id:guid}/reactivate", ReactivateAsync).RequireAuthorization(AuthPolicies.Hr);
    }

    // ---------------- Đọc ----------------

    /// <summary>
    /// Danh bạ nhân viên. Ai đăng nhập cũng xem được thông tin liên lạc (tên, email, điện thoại, phòng ban, chức vụ, quản lý).
    /// Chỉ HR: người đã nghỉ việc, lọc theo trạng thái, thông tin tài khoản. Trạng thái / ngày vào làm: HR, chính chủ, quản lý của người đó.
    /// </summary>
    /// <summary>Danh bạ. Có <c>page</c> → trang (COUNT + OFFSET/LIMIT theo mã NV); không có → cả danh sách (MCP, chọn nhân viên trong form).</summary>
    private static async Task<Results<Ok<List<EmployeeListItem>>, Ok<PagedResult<EmployeeListItem>>>> ListAsync(
        string? search, Guid? departmentId, string? status, bool? includeResigned, int? page, int? pageSize,
        ClaimsPrincipal user, OrgDbContext db, IAccountService accounts, IEmployeeDirectory dir, CancellationToken ct)
    {
        var hr = user.IsHr();
        if (!hr) { includeResigned = false; status = null; } // lọc theo trạng thái cũng làm lộ trạng thái → bỏ qua với người không phải HR
        var q = db.Employees.AsNoTracking();
        if (includeResigned != true && status is null) q = q.Where(e => e.Status != EmployeeStatus.Resigned);
        if (Enum.TryParse<EmployeeStatus>(status, true, out var st)) q = q.Where(e => e.Status == st);
        if (departmentId is { } did) q = q.Where(e => e.DepartmentId == did);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = $"%{search.Trim()}%";
            q = q.Where(e => EF.Functions.ILike(e.FullName, s) || EF.Functions.ILike(e.Code, s) || (e.Email != null && EF.Functions.ILike(e.Email, s)));
        }
        var ordered = q.OrderBy(e => e.Code);
        var hrFields = await HrFieldsVisibilityAsync(user, db, dir, ct);
        if (page is { } pg)
        {
            var paged = await ordered.ToPagedAsync(pg, pageSize, ct);
            return TypedResults.Ok(paged.With(await ToItemsAsync([.. paged.Items], hr, db, accounts, ct, hrFields)));
        }
        return TypedResults.Ok(await ToItemsAsync(await ordered.ToListAsync(ct), hr, db, accounts, ct, hrFields));
    }

    private static async Task<Results<Ok<EmployeeDetail>, NotFound, ForbidHttpResult>> GetAsync(
        Guid id, ClaimsPrincipal user, OrgDbContext db, IAccountService accounts, IEmployeeDirectory dir, CancellationToken ct)
    {
        var e = await db.Employees.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (e is null) return TypedResults.NotFound();
        var self = e.UserId is { } uid && uid == user.GetUserId();
        var visible = await HrFieldsVisibilityAsync(user, db, dir, ct);
        if (e.Status == EmployeeStatus.Resigned && !user.IsHr() && !self) return TypedResults.NotFound(); // người đã nghỉ: chỉ HR xem
        return TypedResults.Ok(await ToDetailAsync(e, user.IsHr() || self, db, accounts, ct, visible(e)));
    }

    /// <summary>Hồ sơ của người đang đăng nhập. 404 nếu tài khoản chưa gắn hồ sơ nhân viên (ví dụ admin hệ thống).</summary>
    private static async Task<Results<Ok<EmployeeDetail>, NotFound>> MeAsync(
        ClaimsPrincipal user, OrgDbContext db, IAccountService accounts, CancellationToken ct)
    {
        var uid = user.GetUserId();
        var e = await db.Employees.AsNoTracking().FirstOrDefaultAsync(x => x.UserId == uid, ct);
        return e is null ? TypedResults.NotFound() : TypedResults.Ok(await ToDetailAsync(e, true, db, accounts, ct));
    }

    private static async Task<Ok<NextCodeResponse>> GetNextCodeAsync(OrgDbContext db, CancellationToken ct) =>
        TypedResults.Ok(new NextCodeResponse(await NextCodeAsync(db, ct)));

    // ---------------- Ghi (HR) ----------------

    private static async Task<Results<Created<EmployeeDetail>, ValidationProblem>> CreateAsync(
        UpsertEmployeeRequest req, OrgDbContext db, IAccountService accounts, CancellationToken ct)
    {
        var code = string.IsNullOrWhiteSpace(req.Code) ? await NextCodeAsync(db, ct) : req.Code.Trim().ToUpperInvariant();
        var v = await ValidateAsync(req with { Code = code }, null, db, ct);
        if (v.Failed) return v.Problem();
        var e = new Employee { Code = code, FullName = req.FullName.Trim() };
        Apply(e, req);
        db.Employees.Add(e);
        await db.SaveChangesAsync(ct);
        return TypedResults.Created($"/api/org/employees/{e.Id}", await ToDetailAsync(e, true, db, accounts, ct));
    }

    private static async Task<Results<Ok<EmployeeDetail>, NotFound, ValidationProblem>> UpdateAsync(
        Guid id, UpsertEmployeeRequest req, OrgDbContext db, IAccountService accounts, CancellationToken ct)
    {
        var e = await db.Employees.FindAsync([id], ct);
        if (e is null) return TypedResults.NotFound();
        var code = string.IsNullOrWhiteSpace(req.Code) ? e.Code : req.Code.Trim().ToUpperInvariant();
        var v = await ValidateAsync(req with { Code = code }, id, db, ct);
        if (v.Failed) return v.Problem();
        e.Code = code;
        Apply(e, req);
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(await ToDetailAsync(e, true, db, accounts, ct));
    }

    /// <summary>Nghỉ việc: đổi trạng thái + khoá tài khoản đăng nhập. Dữ liệu được giữ lại.</summary>
    private static async Task<Results<NoContent, NotFound, ValidationProblem>> ResignAsync(
        Guid id, ResignRequest req, OrgDbContext db, IAccountService accounts, CancellationToken ct)
    {
        var e = await db.Employees.FindAsync([id], ct);
        if (e is null) return TypedResults.NotFound();
        if (req.LeftAt < e.JoinedAt) return new Validation().Add("leftAt", "Ngày nghỉ việc phải sau ngày vào làm").Problem();
        e.Status = EmployeeStatus.Resigned;
        e.LeftAt = req.LeftAt;
        // Gỡ khỏi vai trò quản lý / trưởng phòng
        await db.Employees.Where(x => x.ManagerId == id).ExecuteUpdateAsync(s => s.SetProperty(x => x.ManagerId, (Guid?)null), ct);
        await db.Departments.Where(x => x.HeadEmployeeId == id).ExecuteUpdateAsync(s => s.SetProperty(x => x.HeadEmployeeId, (Guid?)null), ct);
        await db.SaveChangesAsync(ct);
        if (e.UserId is { } uid) await accounts.SetActiveAsync(uid, false, ct);
        return TypedResults.NoContent();
    }

    private static async Task<Results<NoContent, NotFound>> ReactivateAsync(Guid id, OrgDbContext db, IAccountService accounts, CancellationToken ct)
    {
        var e = await db.Employees.FindAsync([id], ct);
        if (e is null) return TypedResults.NotFound();
        e.Status = EmployeeStatus.Active;
        e.LeftAt = null;
        await db.SaveChangesAsync(ct);
        if (e.UserId is { } uid) await accounts.SetActiveAsync(uid, true, ct);
        return TypedResults.NoContent();
    }

    // ---------------- Hỗ trợ ----------------

    internal static void Apply(Employee e, UpsertEmployeeRequest r)
    {
        e.FullName = r.FullName.Trim();
        e.Email = string.IsNullOrWhiteSpace(r.Email) ? null : r.Email.Trim().ToLowerInvariant();
        e.Phone = string.IsNullOrWhiteSpace(r.Phone) ? null : r.Phone.Trim();
        e.DateOfBirth = r.DateOfBirth;
        e.DepartmentId = r.DepartmentId;
        e.PositionId = r.PositionId;
        e.JobTitle = string.IsNullOrWhiteSpace(r.JobTitle) ? null : r.JobTitle.Trim();
        e.ManagerId = r.ManagerId;
        e.JoinedAt = r.JoinedAt;
        e.Note = string.IsNullOrWhiteSpace(r.Note) ? null : r.Note.Trim();
        if (Enum.TryParse<EmployeeStatus>(r.Status, true, out var st) && st != EmployeeStatus.Resigned) e.Status = st;
    }

    internal static async Task<Validation> ValidateAsync(UpsertEmployeeRequest r, Guid? selfId, OrgDbContext db, CancellationToken ct)
    {
        var v = new Validation()
            .Required(r.FullName, "fullName", "Họ tên").MaxLength(r.FullName, 200, "fullName", "Họ tên")
            .MaxLength(r.Code, 30, "code", "Mã nhân viên")
            .Email(r.Email, "email")
            .MaxLength(r.Phone, 30, "phone", "Số điện thoại")
            .MaxLength(r.JobTitle, 150, "jobTitle", "Chức danh")
            .When(r.JoinedAt == default, "joinedAt", "Ngày vào làm không được để trống")
            .When(r.Status is not null && !Enum.TryParse<EmployeeStatus>(r.Status, true, out _), "status", "Trạng thái không hợp lệ")
            .When(r.Status is not null && r.Status.Equals(nameof(EmployeeStatus.Resigned), StringComparison.OrdinalIgnoreCase),
                "status", "Dùng chức năng 'Nghỉ việc' để chuyển trạng thái nghỉ việc");

        if (await db.Employees.AnyAsync(e => e.Code == r.Code && e.Id != selfId, ct)) v.Add("code", "Mã nhân viên đã tồn tại");
        if (!string.IsNullOrWhiteSpace(r.Email) && await db.Employees.AnyAsync(e => e.Email == r.Email.Trim().ToLower() && e.Id != selfId, ct))
            v.Add("email", "Email đã được dùng cho nhân viên khác");
        if (r.DepartmentId is { } did && !await db.Departments.AnyAsync(d => d.Id == did, ct)) v.Add("departmentId", "Phòng ban không tồn tại");
        if (r.PositionId is { } pid && !await db.Positions.AnyAsync(p => p.Id == pid, ct)) v.Add("positionId", "Chức vụ không tồn tại");
        if (r.ManagerId is { } mid)
        {
            if (mid == selfId) v.Add("managerId", "Không thể tự quản lý chính mình");
            else if (!await db.Employees.AnyAsync(e => e.Id == mid && e.Status != EmployeeStatus.Resigned, ct))
                v.Add("managerId", "Quản lý không tồn tại hoặc đã nghỉ việc");
            else if (selfId is { } sid && await ManagesAsync(sid, mid, db, ct))
                v.Add("managerId", "Người này đang là cấp dưới, không thể làm quản lý (vòng lặp)");
        }
        return v;
    }

    /// <summary>manager có (trực tiếp/gián tiếp) quản lý employee không.</summary>
    private static async Task<bool> ManagesAsync(Guid manager, Guid employee, OrgDbContext db, CancellationToken ct)
    {
        var map = await db.Employees.AsNoTracking().ToDictionaryAsync(e => e.Id, e => e.ManagerId, ct);
        for (Guid? cur = map.GetValueOrDefault(employee); cur is { } c; cur = map.GetValueOrDefault(c))
            if (c == manager) return true;
        return false;
    }

    internal static async Task<string> NextCodeAsync(OrgDbContext db, CancellationToken ct)
    {
        var codes = await db.Employees.IgnoreQueryFilters().Where(e => e.Code.StartsWith("NV")).Select(e => e.Code).ToListAsync(ct);
        var max = codes.Select(c => int.TryParse(c[2..], out var n) ? n : 0).DefaultIfEmpty(0).Max();
        return $"NV{max + 1:000}";
    }

    /// <summary>
    /// Ai được xem thông tin nhân sự (trạng thái thử việc / chính thức, ngày vào làm / nghỉ) của nhân viên nào:
    /// HR → mọi người; người khác → chính mình + cấp dưới trực tiếp / gián tiếp (quản lý); không có hồ sơ → không ai.
    /// </summary>
    internal static async Task<Func<Employee, bool>> HrFieldsVisibilityAsync(ClaimsPrincipal user, OrgDbContext db, IEmployeeDirectory dir, CancellationToken ct)
    {
        if (user.IsHr()) return _ => true;
        var uid = user.GetUserId();
        var me = await db.Employees.Where(e => e.UserId == uid).Select(e => (Guid?)e.Id).FirstOrDefaultAsync(ct);
        if (me is not { } meId) return _ => false;
        var allowed = (await dir.GetSubordinateIdsAsync(meId, ct)).ToHashSet();
        allowed.Add(meId);
        return e => allowed.Contains(e.Id);
    }

    internal static async Task<List<EmployeeListItem>> ToItemsAsync(List<Employee> rows, bool includeAccount, OrgDbContext db,
        IAccountService accounts, CancellationToken ct, Func<Employee, bool>? hrFields = null)
    {
        hrFields ??= _ => true;
        var deps = await db.Departments.AsNoTracking().ToDictionaryAsync(d => d.Id, d => d.Name, ct);
        var poss = await db.Positions.IgnoreQueryFilters().AsNoTracking().ToDictionaryAsync(p => p.Id, p => (p.Name, p.Level), ct);
        var managerIds = rows.Where(r => r.ManagerId != null).Select(r => r.ManagerId!.Value).Distinct().ToList();
        var managers = await db.Employees.AsNoTracking().Where(e => managerIds.Contains(e.Id)).ToDictionaryAsync(e => e.Id, e => e.FullName, ct);
        var accs = includeAccount
            ? await accounts.GetManyAsync([.. rows.Where(r => r.UserId != null).Select(r => r.UserId!.Value)], ct)
            : new Dictionary<Guid, AccountInfo>();
        return rows.Select(e => new EmployeeListItem(
            e.Id, e.Code, e.FullName, e.Email, e.Phone,
            e.DepartmentId, e.DepartmentId is { } d ? deps.GetValueOrDefault(d) : null,
            e.PositionId, e.PositionId is { } p && poss.TryGetValue(p, out var pos) ? pos.Name : null, e.PositionId is { } p2 && poss.TryGetValue(p2, out var pl) ? pl.Level : null,
            e.JobTitle,
            e.ManagerId, e.ManagerId is { } m ? managers.GetValueOrDefault(m) : null,
            hrFields(e) ? e.Status.ToString() : null, hrFields(e) ? e.JoinedAt : null, hrFields(e) ? e.LeftAt : null, e.UserId,
            e.UserId is { } u && accs.TryGetValue(u, out var a) ? AccountSummary.From(a) : null, Profile.ProfileEndpoints.AvatarUrl(e))).ToList();
    }

    internal static async Task<EmployeeDetail> ToDetailAsync(Employee e, bool includeAccount, OrgDbContext db, IAccountService accounts, CancellationToken ct,
        bool hrFields = true)
    {
        var item = (await ToItemsAsync([e], includeAccount, db, accounts, ct, _ => hrFields))[0];
        var subs = await db.Employees.CountAsync(x => x.ManagerId == e.Id && x.Status != EmployeeStatus.Resigned, ct);
        return new EmployeeDetail(item, includeAccount ? e.DateOfBirth : null, includeAccount ? e.Note : null, subs);
    }
}
