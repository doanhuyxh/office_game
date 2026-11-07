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
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Assets.Features;

/// <summary>Tài sản đang giữ theo nhân viên (mọi vai trò, theo quyền xem) + tổng quan cho HR.</summary>
internal static class HoldingEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/my", MyAsync).RequireAuthorization();
        g.MapGet("/employees/{id:guid}/holdings", HoldingsAsync).RequireAuthorization();
        g.MapGet("/overview", OverviewAsync).RequireAuthorization(AuthPolicies.Hr);
    }

    internal static async Task<HoldingsDto> LoadAsync(AssetsDbContext db, Guid employeeId, CancellationToken ct)
    {
        var devices = await db.Devices.AsNoTracking().Where(d => d.HolderEmployeeId == employeeId && d.Status == DeviceStatus.InUse).OrderBy(d => d.Code).ToListAsync(ct);
        var ids = devices.Select(d => d.Id).ToList();
        var since = await db.Assignments.AsNoTracking().Where(a => ids.Contains(a.DeviceId) && a.ReturnedAt == null)
            .GroupBy(a => a.DeviceId).Select(g => new { g.Key, At = g.Max(a => a.AssignedAt) }).ToDictionaryAsync(x => x.Key, x => x.At, ct);
        var cats = await db.Categories.AsNoTracking().ToDictionaryAsync(c => c.Id, c => c.Name, ct);
        var seats = await (from s in db.Seats.AsNoTracking()
                           join sv in db.Services.AsNoTracking() on s.ServiceId equals sv.Id
                           where s.EmployeeId == employeeId && s.RevokedAt == null
                           orderby sv.Name, s.AccountLogin
                           select new HeldSeatDto(s.Id, sv.Id, sv.Name, s.AccountLogin, s.Role, sv.Url, s.GrantedAt)).ToListAsync(ct);
        return new([.. devices.Select(d => new HeldDeviceDto(d.Id, d.Code, d.Name, cats.GetValueOrDefault(d.CategoryId, ""), d.SerialNumber,
            since.GetValueOrDefault(d.Id)))], seats);
    }

    private static async Task<Ok<HoldingsDto>> MyAsync(ClaimsPrincipal user, AssetsDbContext db, AssetAccess access, CancellationToken ct)
    {
        var me = await access.ViewerAsync(user, ct);
        return TypedResults.Ok(me.Employee is null ? new HoldingsDto([], []) : await LoadAsync(db, me.Employee.Id, ct));
    }

    private static async Task<Results<Ok<HoldingsDto>, ProblemHttpResult>> HoldingsAsync(Guid id, ClaimsPrincipal user, AssetsDbContext db,
        AssetAccess access, CancellationToken ct)
    {
        var me = await access.ViewerAsync(user, ct);
        // Không có quyền → 404 (không lộ nhân viên có tồn tại / có tài sản hay không)
        if (!await access.CanSeeAsync(me, id, ct)) return Problems.NotFound("nhân viên");
        return TypedResults.Ok(await LoadAsync(db, id, ct));
    }

    /// <summary>Nhân viên đã nghỉ mà còn giữ thiết bị / ghế (dùng cho tổng quan và job nhắc).</summary>
    internal static async Task<List<ResignedHoldingDto>> ResignedHoldingAsync(AssetsDbContext db, IReadOnlyDictionary<Guid, EmployeeRef> emps, CancellationToken ct)
    {
        var dev = await db.Devices.AsNoTracking().Where(d => d.Status == DeviceStatus.InUse && d.HolderEmployeeId != null)
            .GroupBy(d => d.HolderEmployeeId!.Value).Select(g => new { g.Key, N = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.N, ct);
        var seats = await db.Seats.AsNoTracking().Where(s => s.RevokedAt == null)
            .GroupBy(s => s.EmployeeId).Select(g => new { g.Key, N = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.N, ct);
        return [.. dev.Keys.Union(seats.Keys)
            .Select(id => emps.GetValueOrDefault(id))
            .Where(e => e is { IsActive: false })
            .Select(e => new ResignedHoldingDto(e!.Id, e.Code, e.FullName, e.LeftAt, dev.GetValueOrDefault(e.Id), seats.GetValueOrDefault(e.Id)))
            .OrderBy(r => r.Code)];
    }

    private static async Task<Ok<OverviewDto>> OverviewAsync(AssetsDbContext db, AssetAccess access, AssetClock clock, CancellationToken ct)
    {
        var emps = await access.EmployeesAsync(ct);
        var today = clock.Today;
        var horizon = today.AddDays(AssetRules.ReminderDays);
        var devices = await db.Devices.AsNoTracking().ToListAsync(ct);
        var counts = Enum.GetValues<DeviceStatus>().ToDictionary(s => s.ToString(), s => devices.Count(d => d.Status == s));
        var value = devices.Where(d => d.Status is not (DeviceStatus.Retired or DeviceStatus.Lost)).Sum(d => d.PurchasePrice ?? 0);
        var warranties = devices.Where(d => d.Status is not (DeviceStatus.Retired or DeviceStatus.Lost) && d.WarrantyUntil is { } w && w >= today && w <= horizon)
            .OrderBy(d => d.WarrantyUntil).Select(d => new WarrantyDueDto(d.Id, d.Code, d.Name, d.WarrantyUntil!.Value,
                d.HolderEmployeeId is { } h ? emps.GetValueOrDefault(h)?.FullName : null)).ToList();
        var services = await db.Services.AsNoTracking().Where(s => s.Status == ServiceStatus.Active).ToListAsync(ct);
        var renewals = services.Where(s => s.RenewalDate is { } r && r >= today && r <= horizon).OrderBy(s => s.RenewalDate)
            .Select(s => new RenewalDueDto(s.Id, s.Name, s.RenewalDate!.Value)).ToList();
        var seatsInUse = await db.Seats.CountAsync(s => s.RevokedAt == null, ct);
        return TypedResults.Ok(new OverviewDto(counts, devices.Count, value, services.Count,
            services.Sum(s => AssetRules.MonthlyCost(s.BillingCycle, s.Cost)), seatsInUse, warranties, renewals, await ResignedHoldingAsync(db, emps, ct)));
    }
}
