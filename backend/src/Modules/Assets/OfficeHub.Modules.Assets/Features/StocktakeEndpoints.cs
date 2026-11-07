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

/// <summary>Kiểm kê thiết bị (HR): chụp danh sách → đánh dấu Thấy / Không thấy → đóng đợt (tuỳ chọn chuyển thiết bị không thấy sang Mất).</summary>
internal static class StocktakeEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        var hr = g.MapGroup("/stocktakes").RequireAuthorization(AuthPolicies.Hr);
        hr.MapGet("", ListAsync);
        hr.MapPost("", StartAsync);
        hr.MapGet("/{id:guid}", GetAsync);
        hr.MapPost("/items/{itemId:guid}/check", CheckAsync);
        hr.MapPost("/{id:guid}/close", CloseAsync);
    }

    private static StocktakeDto ToDto(Stocktake s, int total, int done, int missing) =>
        new(s.Id, s.Title, s.Status, s.StartedAt, s.StartedByName, s.ClosedAt, total, done, missing);

    private static StocktakeItemDto ToDto(StocktakeItem i, IReadOnlyDictionary<Guid, EmployeeRef> emps) =>
        new(i.Id, i.DeviceId, i.DeviceCode, i.DeviceName, i.SerialNumber,
            i.ExpectedHolderEmployeeId is { } h ? emps.GetValueOrDefault(h)?.FullName : null, i.Result, i.Note, i.CheckedAt, i.CheckedByName);

    private static async Task<Ok<List<StocktakeDto>>> ListAsync(AssetsDbContext db, CancellationToken ct)
    {
        var rows = await db.Stocktakes.AsNoTracking().OrderByDescending(s => s.StartedAt).ToListAsync(ct);
        var stats = await db.StocktakeItems.AsNoTracking().GroupBy(i => i.StocktakeId).Select(g => new
        {
            g.Key, Total = g.Count(), Done = g.Count(i => i.Result != StocktakeResult.Pending), Missing = g.Count(i => i.Result == StocktakeResult.Missing),
        }).ToDictionaryAsync(x => x.Key, ct);
        return TypedResults.Ok(rows.Select(r => stats.TryGetValue(r.Id, out var s) ? ToDto(r, s.Total, s.Done, s.Missing) : ToDto(r, 0, 0, 0)).ToList());
    }

    private static async Task<Results<Ok<StocktakeDetailDto>, ProblemHttpResult>> GetAsync(Guid id, AssetsDbContext db, AssetAccess access, CancellationToken ct)
    {
        var s = await db.Stocktakes.AsNoTracking().Include(x => x.Items).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (s is null) return Problems.NotFound("đợt kiểm kê");
        var emps = await access.EmployeesAsync(ct);
        var items = s.Items.OrderBy(i => i.DeviceCode).Select(i => ToDto(i, emps)).ToList();
        return TypedResults.Ok(new StocktakeDetailDto(ToDto(s, items.Count, items.Count(i => i.Result != StocktakeResult.Pending),
            items.Count(i => i.Result == StocktakeResult.Missing)), items));
    }

    private static async Task<Results<Ok<StocktakeDto>, ValidationProblem, ProblemHttpResult>> StartAsync(StocktakeStartRequest req, ClaimsPrincipal user,
        AssetsDbContext db, AssetAccess access, AssetClock clock, CancellationToken ct)
    {
        var title = string.IsNullOrWhiteSpace(req.Title) ? $"Kiểm kê thiết bị {clock.Today:dd/MM/yyyy}" : req.Title.Trim();
        var v = new Validation().MaxLength(title, 200, "title", "Tiêu đề");
        if (v.Failed) return v.Problem();
        if (await db.Stocktakes.AnyAsync(s => s.Status == ReviewStatus.Open, ct)) return Problems.Conflict("Đang có một đợt kiểm kê chưa đóng");
        var devices = await db.Devices.AsNoTracking().Where(d => d.Status == DeviceStatus.InStock || d.Status == DeviceStatus.InUse || d.Status == DeviceStatus.Repair)
            .OrderBy(d => d.Code).ToListAsync(ct);
        if (devices.Count == 0) return Problems.Conflict("Chưa có thiết bị nào để kiểm kê");
        var me = await access.ViewerAsync(user, ct);
        var st = new Stocktake { Title = title, Status = ReviewStatus.Open, StartedAt = clock.Now, StartedByName = me.Name };
        foreach (var d in devices)
            st.Items.Add(new StocktakeItem { DeviceId = d.Id, DeviceCode = d.Code, DeviceName = d.Name, SerialNumber = d.SerialNumber, ExpectedHolderEmployeeId = d.HolderEmployeeId });
        db.Stocktakes.Add(st);
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(ToDto(st, devices.Count, 0, 0));
    }

    private static async Task<Results<Ok<StocktakeItemDto>, ValidationProblem, ProblemHttpResult>> CheckAsync(Guid itemId, StocktakeCheckRequest req,
        ClaimsPrincipal user, AssetsDbContext db, AssetAccess access, AssetClock clock, CancellationToken ct)
    {
        var item = await db.StocktakeItems.FirstOrDefaultAsync(i => i.Id == itemId, ct);
        var st = item is null ? null : await db.Stocktakes.AsNoTracking().FirstOrDefaultAsync(s => s.Id == item.StocktakeId, ct);
        if (item is null || st is null) return Problems.NotFound("mục kiểm kê");
        if (st.Status != ReviewStatus.Open) return Problems.Conflict("Đợt kiểm kê đã đóng");
        var v = new Validation().When(req.Result == StocktakeResult.Pending, "result", "Chọn Thấy hoặc Không thấy").MaxLength(req.Note?.Trim(), 1000, "note", "Ghi chú");
        if (v.Failed) return v.Problem();
        var me = await access.ViewerAsync(user, ct);
        item.Result = req.Result;
        item.Note = string.IsNullOrWhiteSpace(req.Note) ? null : req.Note.Trim();
        item.CheckedAt = clock.Now;
        item.CheckedByName = me.Name;
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(ToDto(item, await access.EmployeesAsync(ct)));
    }

    /// <summary>
    /// Đóng đợt. Mục chưa kiểm được ghi nhận là "Không thấy". <c>MarkMissingAsLost</c> chỉ cho phép khi đã kiểm hết (tránh chuyển nhầm
    /// thiết bị chưa kiểm sang Mất).
    /// </summary>
    private static async Task<Results<Ok<StocktakeDto>, ProblemHttpResult>> CloseAsync(Guid id, StocktakeCloseRequest req, ClaimsPrincipal user,
        AssetsDbContext db, AssetAccess access, AssetOps ops, AssetClock clock, CancellationToken ct)
    {
        var st = await db.Stocktakes.Include(x => x.Items).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (st is null) return Problems.NotFound("đợt kiểm kê");
        if (st.Status == ReviewStatus.Closed) return Problems.Conflict("Đợt kiểm kê đã đóng");
        var pending = st.Items.Count(i => i.Result == StocktakeResult.Pending);
        if (req.MarkMissingAsLost && pending > 0) return Problems.Conflict($"Còn {pending} thiết bị chưa kiểm, hãy kiểm hết trước khi chuyển thiết bị không thấy sang Mất");
        var me = await access.ViewerAsync(user, ct);
        foreach (var i in st.Items.Where(i => i.Result == StocktakeResult.Pending)) { i.Result = StocktakeResult.Missing; i.CheckedAt = clock.Now; i.CheckedByName = me.Name; i.Note ??= "Không kiểm khi đóng đợt"; }
        var lostHolders = new List<(Guid Employee, Device Device)>();
        if (req.MarkMissingAsLost)
        {
            var ids = st.Items.Where(i => i.Result == StocktakeResult.Missing).Select(i => i.DeviceId).ToList();
            var devices = await db.Devices.Where(d => ids.Contains(d.Id) && (d.Status == DeviceStatus.InStock || d.Status == DeviceStatus.InUse || d.Status == DeviceStatus.Repair)).ToListAsync(ct);
            foreach (var d in devices)
            {
                var holder = d.HolderEmployeeId;
                await ops.CloseAssignmentAsync(d, DeviceStatus.Lost, $"Kiểm kê không thấy ({st.Title})", me.Name, ct);
                d.StatusReason = $"Kiểm kê không thấy ({st.Title})";
                if (holder is { } h) lostHolders.Add((h, d));
            }
        }
        st.Status = ReviewStatus.Closed;
        st.ClosedAt = clock.Now;
        st.ClosedByName = me.Name;
        await db.SaveChangesAsync(ct);
        foreach (var (emp, d) in lostHolders)
            await ops.NotifyEmployeeAsync(emp, NotificationCategories.AssetReturned, $"Thiết bị {d.Code} không còn ghi nhận ở bạn", $"{d.Name}: {d.StatusReason}", email: false);
        return TypedResults.Ok(ToDto(st, st.Items.Count, st.Items.Count, st.Items.Count(i => i.Result == StocktakeResult.Missing)));
    }
}
