using Microsoft.AspNetCore.Builder;
using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Assets.Domain;
using OfficeHub.Modules.Assets.Infrastructure;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Assets.Features;

/// <summary>Dịch vụ / tài khoản phần mềm và ghế (HR quản lý). Không lưu mật khẩu.</summary>
internal static class ServiceEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        var hr = g.MapGroup("").RequireAuthorization(AuthPolicies.Hr);
        hr.MapGet("/services", ListAsync);
        hr.MapPost("/services", CreateAsync);
        hr.MapPut("/services/{id:guid}", UpdateAsync);
        hr.MapPost("/services/{id:guid}/cancel", CancelAsync);
        hr.MapGet("/services/{id:guid}/seats", SeatsAsync);
        hr.MapPost("/services/{id:guid}/seats", GrantAsync);
        hr.MapPost("/seats/{id:guid}/revoke", RevokeAsync);
    }

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    private static ServiceDto ToDto(Service s, int used, IReadOnlyDictionary<Guid, EmployeeRef> emps, IReadOnlyDictionary<Guid, DepartmentRef> depts) =>
        new(s.Id, s.Name, s.Vendor, s.Plan, s.Url, s.SeatLimit, used, s.BillingCycle, s.Cost, s.RenewalDate, s.OwnerDepartmentId,
            s.OwnerDepartmentId is { } d ? depts.GetValueOrDefault(d)?.Name : null, s.AdminEmployeeId,
            s.AdminEmployeeId is { } a ? emps.GetValueOrDefault(a)?.FullName : null, s.Status, s.Note);

    private static async Task<Dictionary<Guid, DepartmentRef>> DeptsAsync(IEmployeeDirectory dir, CancellationToken ct) =>
        (await dir.ListDepartmentsAsync(ct)).ToDictionary(d => d.Id);

    private static async Task<Ok<List<ServiceDto>>> ListAsync(AssetsDbContext db, AssetAccess access, IEmployeeDirectory dir, CancellationToken ct)
    {
        var emps = await access.EmployeesAsync(ct);
        var depts = await DeptsAsync(dir, ct);
        var used = await db.Seats.AsNoTracking().Where(s => s.RevokedAt == null).GroupBy(s => s.ServiceId)
            .Select(g => new { g.Key, N = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.N, ct);
        var rows = await db.Services.AsNoTracking().OrderBy(s => s.Status).ThenBy(s => s.Name).ToListAsync(ct);
        return TypedResults.Ok(rows.Select(s => ToDto(s, used.GetValueOrDefault(s.Id), emps, depts)).ToList());
    }

    private static async Task<Validation> ValidateAsync(ServiceRequest r, IEmployeeDirectory dir, CancellationToken ct)
    {
        var v = new Validation()
            .Required(r.Name, "name", "Tên dịch vụ").MaxLength(r.Name?.Trim(), 200, "name", "Tên dịch vụ")
            .MaxLength(r.Vendor?.Trim(), 200, "vendor", "Nhà cung cấp").MaxLength(r.Plan?.Trim(), 100, "plan", "Gói")
            .MaxLength(r.Url?.Trim(), 500, "url", "Địa chỉ").MaxLength(r.Note?.Trim(), 2000, "note", "Ghi chú")
            // TEST-22: link hiện thành <a href> trên giao diện → chỉ http(s) (chặn javascript: / data:)
            .When(!string.IsNullOrWhiteSpace(r.Url) && !(Uri.TryCreate(r.Url.Trim(), UriKind.Absolute, out var u) && (u.Scheme == Uri.UriSchemeHttps || u.Scheme == Uri.UriSchemeHttp)),
                "url", "Địa chỉ phải bắt đầu bằng https:// hoặc http://")
            .When(r.SeatLimit is < 1 or > 100000, "seatLimit", "Số ghế từ 1 đến 100000 (bỏ trống = không giới hạn)")
            .When(r.Cost is < 0 or > 1_000_000_000_000m, "cost", "Chi phí không hợp lệ");
        if (r.AdminEmployeeId is { } a && await dir.GetAsync(a, ct) is not { IsActive: true }) v.Add("adminEmployeeId", "Người quản trị không tồn tại hoặc đã nghỉ việc");
        if (r.OwnerDepartmentId is { } d && (await dir.ListDepartmentsAsync(ct)).All(x => x.Id != d)) v.Add("ownerDepartmentId", "Phòng ban không tồn tại");
        return v;
    }

    private static async Task<Results<Ok<ServiceDto>, ValidationProblem>> CreateAsync(ServiceRequest req, AssetsDbContext db, AssetAccess access,
        IEmployeeDirectory dir, AssetClock clock, CancellationToken ct)
    {
        var v = await ValidateAsync(req, dir, ct);
        if (v.Failed) return v.Problem();
        var s = new Service
        {
            Name = req.Name!.Trim(), Vendor = Clean(req.Vendor), Plan = Clean(req.Plan), Url = Clean(req.Url), SeatLimit = req.SeatLimit,
            BillingCycle = req.BillingCycle, Cost = req.Cost, RenewalDate = req.RenewalDate, OwnerDepartmentId = req.OwnerDepartmentId,
            AdminEmployeeId = req.AdminEmployeeId, Note = Clean(req.Note), Status = ServiceStatus.Active, CreatedAt = clock.Now,
        };
        db.Services.Add(s);
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(ToDto(s, 0, await access.EmployeesAsync(ct), await DeptsAsync(dir, ct)));
    }

    private static async Task<Results<Ok<ServiceDto>, ValidationProblem, ProblemHttpResult>> UpdateAsync(Guid id, ServiceRequest req, AssetsDbContext db,
        AssetAccess access, AssetOps ops, IEmployeeDirectory dir, AssetClock clock, CancellationToken ct)
    {
        var s = await db.Services.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (s is null) return Problems.NotFound("dịch vụ");
        var v = await ValidateAsync(req, dir, ct);
        var used = await ops.SeatsUsedAsync(id, ct);
        if (req.SeatLimit is { } lim && lim < used) v.Add("seatLimit", $"Đang có {used} ghế được dùng, không đặt thấp hơn");
        if (v.Failed) return v.Problem();
        s.Name = req.Name!.Trim();
        s.Vendor = Clean(req.Vendor);
        s.Plan = Clean(req.Plan);
        s.Url = Clean(req.Url);
        s.SeatLimit = req.SeatLimit;
        s.BillingCycle = req.BillingCycle;
        s.Cost = req.Cost;
        if (s.RenewalDate != req.RenewalDate) { s.RenewalReminded30At = null; s.RenewalReminded7At = null; }
        s.RenewalDate = req.RenewalDate;
        s.OwnerDepartmentId = req.OwnerDepartmentId;
        s.AdminEmployeeId = req.AdminEmployeeId;
        s.Note = Clean(req.Note);
        s.UpdatedAt = clock.Now;
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(ToDto(s, used, await access.EmployeesAsync(ct), await DeptsAsync(dir, ct)));
    }

    /// <summary>Huỷ dịch vụ → tự thu hồi mọi ghế đang dùng.</summary>
    private static async Task<Results<Ok<ServiceDto>, ProblemHttpResult>> CancelAsync(Guid id, ClaimsPrincipal user, AssetsDbContext db, AssetAccess access,
        AssetOps ops, IEmployeeDirectory dir, AssetClock clock, CancellationToken ct)
    {
        var s = await db.Services.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (s is null) return Problems.NotFound("dịch vụ");
        if (s.Status == ServiceStatus.Cancelled) return Problems.Conflict("Dịch vụ đã huỷ");
        var me = await access.ViewerAsync(user, ct);
        var seats = await db.Seats.Where(x => x.ServiceId == id && x.RevokedAt == null).ToListAsync(ct);
        foreach (var seat in seats) ops.Revoke(seat, me.Name);
        s.Status = ServiceStatus.Cancelled;
        s.UpdatedAt = clock.Now;
        await db.SaveChangesAsync(ct);
        foreach (var seat in seats)
            await ops.NotifyEmployeeAsync(seat.EmployeeId, NotificationCategories.AssetReturned, $"Tài khoản {s.Name} đã bị thu hồi",
                $"Dịch vụ {s.Name} đã ngừng sử dụng ({seat.AccountLogin}).", email: false);
        return TypedResults.Ok(ToDto(s, 0, await access.EmployeesAsync(ct), await DeptsAsync(dir, ct)));
    }

    internal static SeatDto ToDto(ServiceSeat s, string serviceName, IReadOnlyDictionary<Guid, EmployeeRef> emps)
    {
        var e = emps.GetValueOrDefault(s.EmployeeId);
        return new(s.Id, s.ServiceId, serviceName, s.EmployeeId, e?.FullName ?? "(không rõ)", e?.Code ?? "", s.AccountLogin, s.Role, s.Note,
            s.GrantedAt, s.GrantedByName, s.RevokedAt, s.RevokedByName);
    }

    private static async Task<Results<Ok<List<SeatDto>>, ProblemHttpResult>> SeatsAsync(Guid id, bool? includeRevoked, AssetsDbContext db, AssetAccess access,
        CancellationToken ct)
    {
        var svc = await db.Services.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (svc is null) return Problems.NotFound("dịch vụ");
        var q = db.Seats.AsNoTracking().Where(s => s.ServiceId == id);
        if (includeRevoked != true) q = q.Where(s => s.RevokedAt == null);
        var rows = await q.OrderBy(s => s.RevokedAt != null).ThenBy(s => s.AccountLogin).ToListAsync(ct);
        var emps = await access.EmployeesAsync(ct);
        return TypedResults.Ok(rows.Select(s => ToDto(s, svc.Name, emps)).ToList());
    }

    private static async Task<Results<Ok<SeatDto>, ValidationProblem, ProblemHttpResult>> GrantAsync(Guid id, GrantSeatRequest req, ClaimsPrincipal user,
        AssetsDbContext db, AssetAccess access, AssetOps ops, IEmployeeDirectory dir, AssetClock clock, CancellationToken ct)
    {
        var svc = await db.Services.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (svc is null) return Problems.NotFound("dịch vụ");
        var login = Clean(req.AccountLogin);
        var v = new Validation().Required(req.EmployeeId?.ToString(), "employeeId", "Nhân viên").Required(login, "accountLogin", "Tên đăng nhập / email tài khoản")
            .MaxLength(login, 200, "accountLogin", "Tên đăng nhập / email tài khoản").MaxLength(req.Role?.Trim(), 100, "role", "Vai trò")
            .MaxLength(req.Note?.Trim(), 1000, "note", "Ghi chú");
        if (v.Failed) return v.Problem();
        var emp = await dir.GetAsync(req.EmployeeId!.Value, ct);
        if (emp is not { IsActive: true }) return new Validation().Add("employeeId", "Nhân viên không tồn tại hoặc đã nghỉ việc").Problem();
        if (await db.Seats.AnyAsync(s => s.ServiceId == id && s.RevokedAt == null && s.AccountLogin.ToLower() == login!.ToLower(), ct))
            return new Validation().Add("accountLogin", "Tài khoản này đã được cấp trên dịch vụ").Problem();
        if (AssetRules.CannotGrantSeat(svc.Status, svc.SeatLimit, await ops.SeatsUsedAsync(id, ct)) is { } err) return Problems.Conflict(err);
        var me = await access.ViewerAsync(user, ct);
        var seat = new ServiceSeat
        {
            ServiceId = id, EmployeeId = emp.Id, AccountLogin = login!, Role = Clean(req.Role), Note = Clean(req.Note), GrantedAt = clock.Now, GrantedByName = me.Name,
        };
        db.Seats.Add(seat);
        await db.SaveChangesAsync(ct);
        await ops.NotifyEmployeeAsync(emp.Id, NotificationCategories.AssetAssigned, $"Bạn được cấp tài khoản {svc.Name}",
            $"Tài khoản: {seat.AccountLogin}{(seat.Role is { } r ? $" · vai trò {r}" : "")}. Xem tại Tài sản → Của tôi.", email: true);
        return TypedResults.Ok(ToDto(seat, svc.Name, await access.EmployeesAsync(ct)));
    }

    private static async Task<Results<Ok<SeatDto>, ProblemHttpResult>> RevokeAsync(Guid id, ClaimsPrincipal user, AssetsDbContext db, AssetAccess access,
        AssetOps ops, CancellationToken ct)
    {
        var seat = await db.Seats.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (seat is null) return Problems.NotFound("tài khoản dịch vụ");
        if (seat.RevokedAt is not null) return Problems.Conflict("Tài khoản đã được thu hồi");
        var svc = await db.Services.AsNoTracking().FirstAsync(x => x.Id == seat.ServiceId, ct);
        var me = await access.ViewerAsync(user, ct);
        ops.Revoke(seat, me.Name);
        await db.SaveChangesAsync(ct);
        await ops.NotifyEmployeeAsync(seat.EmployeeId, NotificationCategories.AssetReturned, $"Tài khoản {svc.Name} đã bị thu hồi",
            $"Tài khoản {seat.AccountLogin} không còn được cấp cho bạn.", email: false);
        return TypedResults.Ok(ToDto(seat, svc.Name, await access.EmployeesAsync(ct)));
    }
}
