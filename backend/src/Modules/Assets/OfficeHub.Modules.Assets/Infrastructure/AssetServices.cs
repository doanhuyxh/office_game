using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.Modules.Assets.Domain;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Assets.Infrastructure;

/// <summary>Giờ / ngày hôm nay theo múi giờ văn phòng.</summary>
internal sealed class AssetClock(TimeProvider clock, IOptions<OfficeSettings> office)
{
    private readonly TimeZoneInfo _tz = TimeZoneInfo.FindSystemTimeZoneById(office.Value.TimeZone);
    public DateTimeOffset Now => clock.GetUtcNow();
    public TimeZoneInfo TimeZone => _tz;
    public DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), _tz).DateTime);
}

/// <summary>Người đang thao tác. <see cref="Employee"/> null = tài khoản không có hồ sơ (admin seed) hoặc đã nghỉ.</summary>
internal sealed record Viewer(Guid UserId, string Name, bool IsHr, EmployeeRef? Employee);

/// <summary>Phân quyền xem tài sản: HR toàn bộ; quản lý bản thân + cấp dưới; nhân viên chính mình. MỌI kiểm tra đi qua đây.</summary>
internal sealed class AssetAccess(IEmployeeDirectory dir)
{
    private Viewer? _viewer;

    public async Task<Viewer> ViewerAsync(ClaimsPrincipal user, CancellationToken ct)
    {
        if (_viewer is not null) return _viewer;
        var uid = user.GetUserId()!.Value;
        var emp = await dir.GetByUserIdAsync(uid, ct);
        if (emp is { IsActive: false }) emp = null;
        return _viewer = new Viewer(uid, user.FindFirstValue(ClaimNames.FullName) ?? user.Identity?.Name ?? "", user.IsHr(), emp);
    }

    private IReadOnlyDictionary<Guid, EmployeeRef>? _employees;

    /// <summary>Mọi nhân viên (cả đã nghỉ) theo Id — một lần mỗi request, để gắn tên vào danh sách.</summary>
    public async Task<IReadOnlyDictionary<Guid, EmployeeRef>> EmployeesAsync(CancellationToken ct) =>
        _employees ??= (await dir.ListEmployedAsync(new DateOnly(2000, 1, 1), new DateOnly(2200, 1, 1), ct)).DistinctBy(e => e.Id).ToDictionary(e => e.Id);

    /// <summary>Có được xem tài sản đang giữ của nhân viên này không (HR, chính chủ, quản lý trực tiếp / gián tiếp).</summary>
    public async Task<bool> CanSeeAsync(Viewer v, Guid employeeId, CancellationToken ct)
    {
        if (v.IsHr) return true;
        if (v.Employee is null) return false;
        if (v.Employee.Id == employeeId) return true;
        return (await dir.GetSubordinateIdsAsync(v.Employee.Id, ct)).Contains(employeeId);
    }
}

/// <summary>Thao tác nghiệp vụ dùng chung (cấp / thu hồi / ghế / thông báo) — endpoint, rà soát, kiểm kê và job cùng gọi.</summary>
internal sealed class AssetOps(AssetsDbContext db, AssetClock clock, IEmployeeDirectory dir, INotifier notifier)
{
    // ---------------- Thiết bị ----------------

    /// <summary>Đã kiểm tra quyền + điều kiện ở caller (<see cref="AssetRules.CannotAssign"/>). Chưa SaveChanges.</summary>
    public DeviceAssignment Assign(Device d, EmployeeRef emp, string? note, string byName)
    {
        var a = new DeviceAssignment { DeviceId = d.Id, EmployeeId = emp.Id, AssignedAt = clock.Now, AssignedByName = byName, AssignNote = note };
        db.Assignments.Add(a);
        d.Status = DeviceStatus.InUse;
        d.HolderEmployeeId = emp.Id;
        d.UpdatedAt = clock.Now;
        return a;
    }

    /// <summary>Đóng bản ghi giao nhận đang mở của thiết bị, đặt trạng thái mới. Chưa SaveChanges.</summary>
    public async Task<List<DeviceAssignment>> CloseAssignmentAsync(Device d, DeviceStatus newStatus, string? note, string byName, CancellationToken ct)
    {
        var open = await db.Assignments.Where(a => a.DeviceId == d.Id && a.ReturnedAt == null).ToListAsync(ct);
        foreach (var a in open) { a.ReturnedAt = clock.Now; a.ReturnedByName = byName; a.ReturnNote = note; }
        d.Status = newStatus;
        d.HolderEmployeeId = null;
        d.UpdatedAt = clock.Now;
        return open;
    }

    /// <summary>
    /// Lập biên bản giao nhận (cấp / thu hồi) — chụp thông tin thiết bị + nhân viên lúc lập. Chờ xác nhận khi nhân viên còn làm và có tài khoản.
    /// Chưa SaveChanges.
    /// </summary>
    public async Task<HandoverRecord> CreateHandoverAsync(HandoverKind kind, Device d, DeviceAssignment a, EmployeeRef emp, string? note, string byName,
        CancellationToken ct)
    {
        var now = clock.Now;
        var year = TimeZoneInfo.ConvertTime(now, clock.TimeZone).Year;
        var seq = await db.NextAsync($"handover:{year}", ct);
        var cat = await db.Categories.AsNoTracking().Where(c => c.Id == d.CategoryId).Select(c => c.Name).FirstOrDefaultAsync(ct);
        var h = new HandoverRecord
        {
            Number = AssetRules.HandoverNumber(year, seq), Kind = kind, DeviceId = d.Id, AssignmentId = a.Id, EmployeeId = emp.Id,
            EmployeeCode = emp.Code, EmployeeName = emp.FullName, DepartmentName = emp.DepartmentName, DeviceCode = d.Code, DeviceName = d.Name,
            CategoryName = cat, Brand = d.Brand, Model = d.Model, SerialNumber = d.SerialNumber, Note = note, CreatedAt = now, CreatedByName = byName,
            RequiresConfirmation = emp is { IsActive: true, UserId: not null },
        };
        db.Handovers.Add(h);
        return h;
    }

    // ---------------- Ghế dịch vụ ----------------

    public Task<int> SeatsUsedAsync(Guid serviceId, CancellationToken ct) =>
        db.Seats.CountAsync(s => s.ServiceId == serviceId && s.RevokedAt == null, ct);

    public void Revoke(ServiceSeat seat, string byName)
    {
        seat.RevokedAt = clock.Now;
        seat.RevokedByName = byName;
    }

    // ---------------- Thông báo (không bao giờ ném lỗi) ----------------

    public async Task NotifyEmployeeAsync(Guid employeeId, string category, string title, string body, bool email, string link = "/assets")
    {
        try
        {
            if (await dir.GetAsync(employeeId) is { UserId: { } uid })
                await notifier.NotifyAsync(new NotificationRequest([uid], category, title, body, link, email));
        }
        catch { /* thông báo là phụ: lỗi không làm hỏng thao tác chính */ }
    }

    public async Task NotifyUsersAsync(IReadOnlyCollection<Guid> userIds, string category, string title, string body, bool email = true, string link = "/assets")
    {
        if (userIds.Count == 0) return;
        try { await notifier.NotifyAsync(new NotificationRequest(userIds, category, title, body, link, email)); }
        catch { }
    }
}
