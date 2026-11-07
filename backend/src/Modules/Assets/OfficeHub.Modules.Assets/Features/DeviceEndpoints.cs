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

/// <summary>Loại và thiết bị (HR quản lý): đăng ký, sửa, cấp phát, thu hồi, đổi trạng thái.</summary>
internal static class DeviceEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/categories", CategoriesAsync).RequireAuthorization();
        var hr = g.MapGroup("").RequireAuthorization(AuthPolicies.Hr);
        hr.MapPost("/categories", CreateCategoryAsync);
        hr.MapPut("/categories/{id:guid}", UpdateCategoryAsync);
        hr.MapGet("/devices", ListAsync);
        hr.MapPost("/devices", CreateAsync);
        hr.MapGet("/devices/{id:guid}", GetAsync);
        hr.MapPut("/devices/{id:guid}", UpdateAsync);
        hr.MapDelete("/devices/{id:guid}", DeleteAsync);
        hr.MapPost("/devices/{id:guid}/assign", AssignAsync);
        hr.MapPost("/devices/{id:guid}/return", ReturnAsync);
        hr.MapPost("/devices/{id:guid}/status", StatusAsync);
    }

    // ---------------- Loại ----------------

    private static CategoryDto ToDto(Category c) => new(c.Id, c.Code, c.Name, c.SortOrder, c.IsActive);

    private static async Task<Ok<List<CategoryDto>>> CategoriesAsync(AssetsDbContext db, CancellationToken ct) =>
        TypedResults.Ok(await db.Categories.AsNoTracking().OrderBy(c => c.SortOrder).ThenBy(c => c.Name).Select(c => ToDto(c)).ToListAsync(ct));

    private static Validation ValidateCategory(CategoryRequest r) => new Validation()
        .Required(r.Code, "code", "Mã loại").MaxLength(r.Code?.Trim(), 10, "code", "Mã loại")
        .Required(r.Name, "name", "Tên loại").MaxLength(r.Name?.Trim(), 100, "name", "Tên loại");

    private static async Task<Results<Ok<CategoryDto>, ValidationProblem>> CreateCategoryAsync(CategoryRequest req, AssetsDbContext db, CancellationToken ct)
    {
        var v = ValidateCategory(req);
        var code = req.Code?.Trim().ToUpperInvariant();
        if (!v.Has("code") && await db.Categories.AnyAsync(c => c.Code == code, ct)) v.Add("code", "Mã loại đã tồn tại");
        if (v.Failed) return v.Problem();
        var c = new Category { Code = code!, Name = req.Name!.Trim(), SortOrder = req.SortOrder, IsActive = req.IsActive };
        db.Categories.Add(c);
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(ToDto(c));
    }

    /// <summary>Đổi mã loại chỉ ảnh hưởng thiết bị tạo sau (mã thiết bị đã cấp giữ nguyên).</summary>
    private static async Task<Results<Ok<CategoryDto>, ValidationProblem, ProblemHttpResult>> UpdateCategoryAsync(Guid id, CategoryRequest req,
        AssetsDbContext db, CancellationToken ct)
    {
        var c = await db.Categories.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (c is null) return Problems.NotFound("loại thiết bị");
        var v = ValidateCategory(req);
        var code = req.Code?.Trim().ToUpperInvariant();
        if (!v.Has("code") && await db.Categories.AnyAsync(x => x.Id != id && x.Code == code, ct)) v.Add("code", "Mã loại đã tồn tại");
        if (v.Failed) return v.Problem();
        c.Code = code!;
        c.Name = req.Name!.Trim();
        c.SortOrder = req.SortOrder;
        c.IsActive = req.IsActive;
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(ToDto(c));
    }

    // ---------------- Thiết bị ----------------

    internal static DeviceDto ToDto(Device d, string categoryName, IReadOnlyDictionary<Guid, EmployeeRef> emps)
    {
        var h = d.HolderEmployeeId is { } hid ? emps.GetValueOrDefault(hid) : null;
        return new(d.Id, d.Code, d.CategoryId, categoryName, d.Name, d.Brand, d.Model, d.SerialNumber, d.PurchaseDate, d.PurchasePrice, d.WarrantyUntil,
            d.Status, d.StatusReason, d.HolderEmployeeId, h?.FullName, h?.Code, d.Note, d.CreatedAt);
    }

    private static async Task<Results<Ok<List<DeviceDto>>, Ok<PagedResult<DeviceDto>>>> ListAsync(AssetsDbContext db, AssetAccess access,
        string? search, Guid? categoryId, DeviceStatus? status, Guid? holderId, int? page, int? pageSize, CancellationToken ct)
    {
        var emps = await access.EmployeesAsync(ct);
        var q = db.Devices.AsNoTracking().AsQueryable();
        if (categoryId is { } cid) q = q.Where(d => d.CategoryId == cid);
        if (status is { } st) q = q.Where(d => d.Status == st);
        if (holderId is { } hid) q = q.Where(d => d.HolderEmployeeId == hid);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim();
            var like = $"%{s.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_")}%";
            var holderIds = emps.Values.Where(e => e.FullName.Contains(s, StringComparison.OrdinalIgnoreCase) || e.Code.Contains(s, StringComparison.OrdinalIgnoreCase))
                .Select(e => e.Id).ToList();
            q = q.Where(d => EF.Functions.ILike(d.Code, like) || EF.Functions.ILike(d.Name, like) || EF.Functions.ILike(d.SerialNumber ?? "", like)
                             || EF.Functions.ILike(d.Brand ?? "", like) || EF.Functions.ILike(d.Model ?? "", like)
                             || (d.HolderEmployeeId != null && holderIds.Contains(d.HolderEmployeeId.Value)));
        }
        q = q.OrderBy(d => d.Code);
        var cats = await db.Categories.AsNoTracking().ToDictionaryAsync(c => c.Id, c => c.Name, ct);
        if (page is null)
            return TypedResults.Ok((await q.ToListAsync(ct)).Select(d => ToDto(d, cats.GetValueOrDefault(d.CategoryId, ""), emps)).ToList());
        var p = await q.ToPagedAsync(page.Value, pageSize, ct);
        return TypedResults.Ok(p.Map(d => ToDto(d, cats.GetValueOrDefault(d.CategoryId, ""), emps)));
    }

    private static async Task<DeviceDetailDto> DetailAsync(Device d, AssetsDbContext db, AssetAccess access, CancellationToken ct)
    {
        var emps = await access.EmployeesAsync(ct);
        var cat = await db.Categories.AsNoTracking().Where(c => c.Id == d.CategoryId).Select(c => c.Name).FirstOrDefaultAsync(ct) ?? "";
        var rows = await db.Assignments.AsNoTracking().Where(a => a.DeviceId == d.Id).OrderByDescending(a => a.AssignedAt).ToListAsync(ct);
        var history = rows.Select(a =>
        {
            var e = emps.GetValueOrDefault(a.EmployeeId);
            return new AssignmentDto(a.Id, a.EmployeeId, e?.FullName ?? "(không rõ)", e?.Code ?? "", a.AssignedAt, a.AssignedByName, a.AssignNote,
                a.ReturnedAt, a.ReturnedByName, a.ReturnNote);
        }).ToList();
        return new(ToDto(d, cat, emps), history);
    }

    private static async Task<Results<Ok<DeviceDetailDto>, ProblemHttpResult>> GetAsync(Guid id, AssetsDbContext db, AssetAccess access, CancellationToken ct)
    {
        var d = await db.Devices.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        return d is null ? Problems.NotFound("thiết bị") : TypedResults.Ok(await DetailAsync(d, db, access, ct));
    }

    private static Validation ValidateDevice(DeviceRequest r) => new Validation()
        .Required(r.Name, "name", "Tên thiết bị").MaxLength(r.Name?.Trim(), 200, "name", "Tên thiết bị")
        .MaxLength(r.Brand?.Trim(), 100, "brand", "Hãng").MaxLength(r.Model?.Trim(), 100, "model", "Model")
        .MaxLength(r.SerialNumber?.Trim(), 100, "serialNumber", "Số serial").MaxLength(r.Note?.Trim(), 2000, "note", "Ghi chú")
        .When(r.PurchasePrice is < 0, "purchasePrice", "Giá mua không được âm")
        .When(r.PurchasePrice is > 1_000_000_000_000m, "purchasePrice", "Giá mua quá lớn")
        .When(r.PurchaseDate is { } pd && r.WarrantyUntil is { } wu && wu < pd, "warrantyUntil", "Hạn bảo hành phải sau ngày mua");

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    private static async Task<Results<Ok<DeviceDto>, ValidationProblem>> CreateAsync(DeviceRequest req, AssetsDbContext db, AssetAccess access,
        AssetClock clock, CancellationToken ct)
    {
        var v = ValidateDevice(req);
        var cat = req.CategoryId is { } cid ? await db.Categories.FirstOrDefaultAsync(c => c.Id == cid && c.IsActive, ct) : null;
        if (cat is null) v.Add("categoryId", "Chọn loại thiết bị");
        var serial = Clean(req.SerialNumber);
        if (serial is not null && !v.Has("serialNumber") && await db.Devices.AnyAsync(d => d.SerialNumber != null && d.SerialNumber.ToLower() == serial.ToLower(), ct))
            v.Add("serialNumber", "Số serial đã tồn tại");
        if (v.Failed) return v.Problem();
        var seq = await db.NextAsync($"device:{cat!.Code}", ct);
        var d = new Device
        {
            Code = AssetRules.DeviceCode(cat.Code, seq), CategoryId = cat.Id, Name = req.Name!.Trim(), Brand = Clean(req.Brand), Model = Clean(req.Model),
            SerialNumber = serial, PurchaseDate = req.PurchaseDate, PurchasePrice = req.PurchasePrice, WarrantyUntil = req.WarrantyUntil,
            Note = Clean(req.Note), Status = DeviceStatus.InStock, CreatedAt = clock.Now,
        };
        db.Devices.Add(d);
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(ToDto(d, cat.Name, await access.EmployeesAsync(ct)));
    }

    private static async Task<Results<Ok<DeviceDto>, ValidationProblem, ProblemHttpResult>> UpdateAsync(Guid id, DeviceRequest req, AssetsDbContext db,
        AssetAccess access, AssetClock clock, CancellationToken ct)
    {
        var d = await db.Devices.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (d is null) return Problems.NotFound("thiết bị");
        var v = ValidateDevice(req);
        if (req.CategoryId is { } c && c != d.CategoryId) v.Add("categoryId", "Không đổi loại sau khi tạo (mã thiết bị gắn với loại)");
        var serial = Clean(req.SerialNumber);
        if (serial is not null && !v.Has("serialNumber")
            && await db.Devices.AnyAsync(x => x.Id != id && x.SerialNumber != null && x.SerialNumber.ToLower() == serial.ToLower(), ct))
            v.Add("serialNumber", "Số serial đã tồn tại");
        if (v.Failed) return v.Problem();
        d.Name = req.Name!.Trim();
        d.Brand = Clean(req.Brand);
        d.Model = Clean(req.Model);
        d.SerialNumber = serial;
        d.PurchaseDate = req.PurchaseDate;
        d.PurchasePrice = req.PurchasePrice;
        // đổi hạn bảo hành → nhắc lại theo hạn mới
        if (d.WarrantyUntil != req.WarrantyUntil) { d.WarrantyReminded30At = null; d.WarrantyReminded7At = null; }
        d.WarrantyUntil = req.WarrantyUntil;
        d.Note = Clean(req.Note);
        d.UpdatedAt = clock.Now;
        await db.SaveChangesAsync(ct);
        var cat = await db.Categories.AsNoTracking().Where(x => x.Id == d.CategoryId).Select(x => x.Name).FirstOrDefaultAsync(ct) ?? "";
        return TypedResults.Ok(ToDto(d, cat, await access.EmployeesAsync(ct)));
    }

    /// <summary>Xoá mềm — chỉ khi chưa từng cấp phát (còn lại dùng "Thanh lý" để giữ lịch sử).</summary>
    private static async Task<Results<NoContent, ProblemHttpResult>> DeleteAsync(Guid id, AssetsDbContext db, AssetClock clock, CancellationToken ct)
    {
        var d = await db.Devices.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (d is null) return Problems.NotFound("thiết bị");
        if (await db.Assignments.AnyAsync(a => a.DeviceId == id, ct)) return Problems.Conflict("Thiết bị đã từng được cấp phát, hãy chuyển sang Thanh lý để giữ lịch sử");
        d.DeletedAt = clock.Now;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private static async Task<Results<Ok<DeviceDetailDto>, ValidationProblem, ProblemHttpResult>> AssignAsync(Guid id, AssignRequest req, ClaimsPrincipal user,
        AssetsDbContext db, AssetAccess access, AssetOps ops, IEmployeeDirectory dir, CancellationToken ct)
    {
        var d = await db.Devices.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (d is null) return Problems.NotFound("thiết bị");
        var v = new Validation().Required(req.EmployeeId?.ToString(), "employeeId", "Nhân viên").MaxLength(req.Note?.Trim(), 1000, "note", "Ghi chú");
        if (v.Failed) return v.Problem();
        var emp = await dir.GetAsync(req.EmployeeId!.Value, ct);
        if (AssetRules.CannotAssign(d.Status, emp is { IsActive: true }) is { } err)
            return Problems.Conflict(err);
        var me = await access.ViewerAsync(user, ct);
        ops.Assign(d, emp!, Clean(req.Note), me.Name);
        await db.SaveChangesAsync(ct);
        await ops.NotifyEmployeeAsync(emp!.Id, NotificationCategories.AssetAssigned, $"Bạn được cấp thiết bị {d.Code}",
            $"{d.Name}{(d.SerialNumber is { } s ? $" · serial {s}" : "")}. Xem tại Tài sản → Của tôi.", email: true);
        return TypedResults.Ok(await DetailAsync(d, db, access, ct));
    }

    private static async Task<Results<Ok<DeviceDetailDto>, ProblemHttpResult>> ReturnAsync(Guid id, ReturnRequest req, ClaimsPrincipal user,
        AssetsDbContext db, AssetAccess access, AssetOps ops, CancellationToken ct)
    {
        var d = await db.Devices.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (d is null) return Problems.NotFound("thiết bị");
        if (d.Status != DeviceStatus.InUse || d.HolderEmployeeId is not { } holder) return Problems.Conflict("Thiết bị không có người đang dùng");
        var me = await access.ViewerAsync(user, ct);
        await ops.CloseAssignmentAsync(d, DeviceStatus.InStock, Clean(req.Note), me.Name, ct);
        await db.SaveChangesAsync(ct);
        await ops.NotifyEmployeeAsync(holder, NotificationCategories.AssetReturned, $"Đã thu hồi thiết bị {d.Code}", $"{d.Name} đã được thu hồi về kho.", email: false);
        return TypedResults.Ok(await DetailAsync(d, db, access, ct));
    }

    private static async Task<Results<Ok<DeviceDetailDto>, ValidationProblem, ProblemHttpResult>> StatusAsync(Guid id, StatusRequest req, ClaimsPrincipal user,
        AssetsDbContext db, AssetAccess access, AssetOps ops, AssetClock clock, CancellationToken ct)
    {
        var d = await db.Devices.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (d is null) return Problems.NotFound("thiết bị");
        var reason = Clean(req.Reason);
        if (reason is { Length: > 1000 }) return new Validation().Add("reason", "Lý do tối đa 1000 ký tự").Problem();
        if (AssetRules.CannotChangeStatus(d.Status, req.Status, reason) is { } err)
            return err == "Cần nhập lý do" ? new Validation().Add("reason", err).Problem() : Problems.Conflict(err);
        var me = await access.ViewerAsync(user, ct);
        var holder = d.HolderEmployeeId;
        if (d.Status == DeviceStatus.InUse) // chỉ còn Lost (các trạng thái khác bị chặn ở trên)
            await ops.CloseAssignmentAsync(d, req.Status, reason, me.Name, ct);
        else d.Status = req.Status;
        d.StatusReason = req.Status is DeviceStatus.Retired or DeviceStatus.Lost ? reason : null;
        d.UpdatedAt = clock.Now;
        await db.SaveChangesAsync(ct);
        if (holder is { } h)
            await ops.NotifyEmployeeAsync(h, NotificationCategories.AssetReturned, $"Thiết bị {d.Code} không còn ghi nhận ở bạn", $"{d.Name}: {reason}", email: false);
        return TypedResults.Ok(await DetailAsync(d, db, access, ct));
    }
}
