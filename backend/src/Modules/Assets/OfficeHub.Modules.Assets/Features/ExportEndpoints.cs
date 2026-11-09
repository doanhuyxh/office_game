using Microsoft.AspNetCore.Builder;
using ClosedXML.Excel;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.Modules.Assets.Domain;
using OfficeHub.Modules.Assets.Infrastructure;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Assets.Features;

/// <summary>Xuất Excel danh sách thiết bị và dịch vụ + ghế (HR).</summary>
internal static class ExportEndpoints
{
    private const string ContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    private const string Money = "#,##0";

    public static void Map(RouteGroupBuilder g)
    {
        var hr = g.MapGroup("/export").RequireAuthorization(AuthPolicies.Hr);
        hr.MapGet("/devices", DevicesAsync);
        hr.MapGet("/services", ServicesAsync);
    }

    internal static readonly Dictionary<DeviceStatus, string> StatusLabel = new()
    {
        [DeviceStatus.InStock] = "Trong kho", [DeviceStatus.InUse] = "Đang dùng", [DeviceStatus.Repair] = "Bảo trì",
        [DeviceStatus.Retired] = "Thanh lý", [DeviceStatus.Lost] = "Mất",
    };
    private static readonly Dictionary<BillingCycle, string> CycleLabel = new()
    {
        [BillingCycle.None] = "Không định kỳ", [BillingCycle.Monthly] = "Hàng tháng", [BillingCycle.Yearly] = "Hàng năm",
    };

    private static void Header(IXLWorksheet s, int row, string[] head)
    {
        for (var i = 0; i < head.Length; i++) s.Cell(row, i + 1).Value = head[i];
        var r = s.Range(row, 1, row, head.Length);
        r.Style.Font.SetBold().Fill.SetBackgroundColor(XLColor.LightGray);
    }

    private static void Row(IXLWorksheet s, int row, object?[] values)
    {
        for (var i = 0; i < values.Length; i++)
        {
            var c = s.Cell(row, i + 1);
            switch (values[i])
            {
                case null: break;
                case DateOnly d: c.Value = d.ToDateTime(TimeOnly.MinValue); c.Style.DateFormat.Format = "dd/MM/yyyy"; break;
                case decimal m: c.Value = m; c.Style.NumberFormat.Format = Money; break;
                case int n: c.Value = n; break;
                default: c.Value = values[i]!.ToString(); break;
            }
        }
    }

    private static byte[] Save(XLWorkbook wb)
    {
        foreach (var s in wb.Worksheets) { s.SheetView.FreezeRows(1); s.Columns().AdjustToContents(60); }
        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }

    private static async Task<FileContentHttpResult> DevicesAsync(AssetsDbContext db, AssetAccess access, AssetClock clock, CancellationToken ct)
    {
        var emps = await access.EmployeesAsync(ct);
        var cats = await db.Categories.AsNoTracking().ToDictionaryAsync(c => c.Id, ct);
        var rows = await db.Devices.AsNoTracking().OrderBy(d => d.Code).ToListAsync(ct);
        var today = clock.Today;
        using var wb = new XLWorkbook();
        var s = wb.AddWorksheet("Thiết bị");
        Header(s, 1, ["Mã", "Loại", "Tên", "Hãng", "Model", "Số serial", "Ngày mua", "Giá mua (VND)", "Số tháng khấu hao", "Đã khấu hao (VND)",
            $"Giá trị còn lại {today:dd/MM/yyyy} (VND)", "Hết bảo hành", "Trạng thái", "Mã NV giữ", "Người giữ", "Ghi chú"]);
        var r = 2;
        foreach (var d in rows)
        {
            var h = d.HolderEmployeeId is { } hid ? emps.GetValueOrDefault(hid) : null;
            var cat = cats.GetValueOrDefault(d.CategoryId);
            var months = AssetRules.EffectiveMonths(d.DepreciationMonths, cat?.DepreciationMonths);
            var dep = AssetRules.Depreciate(d.PurchasePrice, d.PurchaseDate, months, today, d.Status);
            Row(s, r++, [d.Code, cat?.Name, d.Name, d.Brand, d.Model, d.SerialNumber, d.PurchaseDate, d.PurchasePrice, months is > 0 ? months : null,
                dep?.Accumulated, dep?.BookValue, d.WarrantyUntil, StatusLabel[d.Status], h?.Code, h?.FullName, d.Note]);
        }
        return TypedResults.File(Save(wb), ContentType, $"thiet-bi-{clock.Today:yyyy-MM-dd}.xlsx");
    }

    private static async Task<FileContentHttpResult> ServicesAsync(AssetsDbContext db, AssetAccess access, IEmployeeDirectory dir, AssetClock clock, CancellationToken ct)
    {
        var emps = await access.EmployeesAsync(ct);
        var depts = (await dir.ListDepartmentsAsync(ct)).ToDictionary(d => d.Id);
        var services = await db.Services.AsNoTracking().OrderBy(s => s.Name).ToListAsync(ct);
        var seats = await db.Seats.AsNoTracking().Where(s => s.RevokedAt == null).ToListAsync(ct);
        using var wb = new XLWorkbook();
        var s1 = wb.AddWorksheet("Dịch vụ");
        Header(s1, 1, ["Tên", "Nhà cung cấp", "Gói", "Số ghế tối đa", "Ghế đang dùng", "Chu kỳ", "Chi phí/kỳ (VND)", "Ngày gia hạn", "Phòng sở hữu", "Người quản trị", "Trạng thái", "Ghi chú"]);
        var r = 2;
        foreach (var sv in services)
            Row(s1, r++, [sv.Name, sv.Vendor, sv.Plan, sv.SeatLimit, seats.Count(x => x.ServiceId == sv.Id), CycleLabel[sv.BillingCycle], sv.Cost, sv.RenewalDate,
                sv.OwnerDepartmentId is { } d ? depts.GetValueOrDefault(d)?.Name : null, sv.AdminEmployeeId is { } a ? emps.GetValueOrDefault(a)?.FullName : null,
                sv.Status == ServiceStatus.Active ? "Đang dùng" : "Đã huỷ", sv.Note]);
        var s2 = wb.AddWorksheet("Ghế đang dùng");
        Header(s2, 1, ["Dịch vụ", "Tài khoản", "Vai trò", "Mã NV", "Nhân viên", "Phòng ban", "Ngày cấp"]);
        r = 2;
        var names = services.ToDictionary(x => x.Id, x => x.Name);
        foreach (var seat in seats.OrderBy(x => names.GetValueOrDefault(x.ServiceId)).ThenBy(x => x.AccountLogin))
        {
            var e = emps.GetValueOrDefault(seat.EmployeeId);
            Row(s2, r++, [names.GetValueOrDefault(seat.ServiceId), seat.AccountLogin, seat.Role, e?.Code, e?.FullName, e?.DepartmentName, DateOnly.FromDateTime(seat.GrantedAt.UtcDateTime)]);
        }
        return TypedResults.File(Save(wb), ContentType, $"dich-vu-{clock.Today:yyyy-MM-dd}.xlsx");
    }
}
