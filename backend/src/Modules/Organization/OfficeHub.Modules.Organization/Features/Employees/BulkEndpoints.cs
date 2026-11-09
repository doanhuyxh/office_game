using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Identity.Contracts;
using OfficeHub.Modules.Organization.Domain;
using OfficeHub.Modules.Organization.Infrastructure;

namespace OfficeHub.Modules.Organization.Features.Employees;

/// <summary>
/// Đổi hàng loạt. Mỗi cặp Set* = true mới đổi trường đó (giá trị null = bỏ trống, ví dụ gỡ quản lý); Set* = false giữ nguyên.
/// </summary>
public sealed record BulkUpdateRequest(Guid[] Ids, bool SetDepartment, Guid? DepartmentId, bool SetPosition, Guid? PositionId,
    bool SetManager, Guid? ManagerId);

public sealed record BulkResignRequest(Guid[] Ids, DateOnly LeftAt);

/// <param name="Affected">Số nhân viên thực sự bị đổi (bỏ qua người đã nghỉ khi cho nghỉ việc).</param>
public sealed record BulkResult(int Affected);

/// <summary>
/// Thao tác hàng loạt trên danh sách nhân viên (HR): đổi phòng ban / chức vụ / quản lý, cho nghỉ việc, xuất Excel.
/// Ghi qua entity được theo dõi để lịch sử sửa dữ liệu ([Audited]) ghi từng người; cả nhóm trong một transaction — lỗi một người thì không đổi ai.
/// </summary>
internal static class BulkEndpoints
{
    private const string XlsxType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    public static void Map(RouteGroupBuilder org)
    {
        var g = org.MapGroup("/employees").WithTags("Organization").RequireAuthorization(AuthPolicies.Hr);
        g.MapPost("/bulk/update", UpdateAsync);
        g.MapPost("/bulk/resign", ResignAsync);
        g.MapGet("/export", ExportAsync);
    }

    private static Validation CheckIds(Guid[]? ids) => new Validation()
        .When(ids is null || ids.Length == 0, "ids", "Chưa chọn nhân viên nào")
        .When(ids is { Length: > EmployeeBulk.MaxIds }, "ids", $"Tối đa {EmployeeBulk.MaxIds} nhân viên mỗi lần");

    private static async Task<Results<Ok<BulkResult>, ValidationProblem>> UpdateAsync(BulkUpdateRequest req, OrgDbContext db, CancellationToken ct)
    {
        var v = CheckIds(req.Ids).When(!req.SetDepartment && !req.SetPosition && !req.SetManager, "fields", "Chưa chọn thông tin cần đổi");
        if (v.Failed) return v.Problem();
        var ids = req.Ids.ToHashSet();
        var rows = await db.Employees.Where(e => ids.Contains(e.Id)).ToListAsync(ct);
        if (rows.Count != ids.Count) return v.Add("ids", "Có nhân viên không tồn tại — tải lại trang rồi thử lại").Problem();

        if (req.SetDepartment && req.DepartmentId is { } did && !await db.Departments.AnyAsync(d => d.Id == did, ct))
            v.Add("departmentId", "Phòng ban không tồn tại");
        if (req.SetPosition && req.PositionId is { } pid && !await db.Positions.AnyAsync(p => p.Id == pid, ct))
            v.Add("positionId", "Chức vụ không tồn tại");
        if (req.SetManager && req.ManagerId is { } mid)
        {
            if (!await db.Employees.AnyAsync(e => e.Id == mid && e.Status != EmployeeStatus.Resigned, ct))
                v.Add("managerId", "Quản lý không tồn tại hoặc đã nghỉ việc");
            else
            {
                var managerOf = await db.Employees.AsNoTracking().ToDictionaryAsync(e => e.Id, e => e.ManagerId, ct);
                if (EmployeeBulk.CreatesCycle(mid, ids, managerOf))
                    v.Add("managerId", "Quản lý được chọn nằm trong nhóm hoặc đang là cấp dưới của người trong nhóm (vòng lặp)");
            }
        }
        if (v.Failed) return v.Problem();

        foreach (var e in rows)
        {
            if (req.SetDepartment) e.DepartmentId = req.DepartmentId;
            if (req.SetPosition) e.PositionId = req.PositionId;
            if (req.SetManager) e.ManagerId = req.ManagerId;
        }
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(new BulkResult(rows.Count));
    }

    /// <summary>Như "Nghỉ việc" từng người: đổi trạng thái, gỡ khỏi vai trò quản lý / trưởng phòng, khoá tài khoản. Người đã nghỉ được bỏ qua.</summary>
    private static async Task<Results<Ok<BulkResult>, ValidationProblem>> ResignAsync(BulkResignRequest req, OrgDbContext db,
        IAccountService accounts, CancellationToken ct)
    {
        var v = CheckIds(req.Ids).When(req.LeftAt == default, "leftAt", "Chưa chọn ngày nghỉ việc");
        if (v.Failed) return v.Problem();
        var ids = req.Ids.ToHashSet();
        var rows = await db.Employees.Where(e => ids.Contains(e.Id) && e.Status != EmployeeStatus.Resigned).ToListAsync(ct);
        var early = rows.Where(e => req.LeftAt < e.JoinedAt).Select(e => e.Code).Order().ToList();
        if (early.Count > 0) return v.Add("leftAt", $"Ngày nghỉ việc phải sau ngày vào làm: {string.Join(", ", early)}").Problem();
        if (rows.Count == 0) return TypedResults.Ok(new BulkResult(0));

        var resigning = rows.Select(e => e.Id).ToList();
        await using (var tx = await db.Database.BeginTransactionAsync(ct))
        {
            foreach (var e in rows) { e.Status = EmployeeStatus.Resigned; e.LeftAt = req.LeftAt; }
            await db.Employees.Where(x => x.ManagerId != null && resigning.Contains(x.ManagerId.Value))
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.ManagerId, (Guid?)null), ct);
            await db.Departments.Where(x => x.HeadEmployeeId != null && resigning.Contains(x.HeadEmployeeId.Value))
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.HeadEmployeeId, (Guid?)null), ct);
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }
        foreach (var uid in rows.Where(e => e.UserId != null).Select(e => e.UserId!.Value))
            await accounts.SetActiveAsync(uid, false, ct);
        return TypedResults.Ok(new BulkResult(rows.Count));
    }

    /// <summary>
    /// Excel danh sách nhân viên. <c>ids</c> (phân cách bằng dấu phẩy) → chỉ những người đó; không có → mọi người khớp bộ lọc
    /// (cùng tham số với danh bạ: search, departmentId, includeResigned, status — vd status=Resigned cho tab Đã nghỉ việc).
    /// </summary>
    private static async Task<Results<FileContentHttpResult, ValidationProblem>> ExportAsync(string? ids, string? search, Guid? departmentId,
        bool? includeResigned, string? status, OrgDbContext db, IAccountService accounts, CancellationToken ct)
    {
        var q = db.Employees.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(ids))
        {
            var parts = ids.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            var list = new List<Guid>();
            foreach (var p in parts)
                if (Guid.TryParse(p, out var g)) list.Add(g);
                else return new Validation().Add("ids", "Danh sách nhân viên không hợp lệ").Problem();
            if (CheckIds([.. list]) is { Failed: true } bad) return bad.Problem();
            q = q.Where(e => list.Contains(e.Id));
        }
        else
        {
            if (includeResigned != true && status is null) q = q.Where(e => e.Status != EmployeeStatus.Resigned);
            if (Enum.TryParse<EmployeeStatus>(status, true, out var st)) q = q.Where(e => e.Status == st);
            if (departmentId is { } did) q = q.Where(e => e.DepartmentId == did);
            if (!string.IsNullOrWhiteSpace(search))
            {
                var s = $"%{search.Trim()}%";
                q = q.Where(e => EF.Functions.ILike(e.FullName, s) || EF.Functions.ILike(e.Code, s) || (e.Email != null && EF.Functions.ILike(e.Email, s)));
            }
        }
        var rows = await q.OrderBy(e => e.Code).ToListAsync(ct);
        var deps = await db.Departments.AsNoTracking().ToDictionaryAsync(d => d.Id, d => d.Name, ct);
        var poss = await db.Positions.IgnoreQueryFilters().AsNoTracking().ToDictionaryAsync(p => p.Id, p => p.Name, ct);
        var managerIds = rows.Where(r => r.ManagerId != null).Select(r => r.ManagerId!.Value).Distinct().ToList();
        var managers = await db.Employees.AsNoTracking().Where(e => managerIds.Contains(e.Id))
            .ToDictionaryAsync(e => e.Id, e => new { e.Code, e.FullName }, ct);
        var accs = await accounts.GetManyAsync([.. rows.Where(r => r.UserId != null).Select(r => r.UserId!.Value)], ct);

        var data = rows.Select(e =>
        {
            var m = e.ManagerId is { } mid ? managers.GetValueOrDefault(mid) : null;
            return new EmployeeExportRow(e.Code, e.FullName, e.Email, e.Phone, e.DateOfBirth,
                e.DepartmentId is { } d ? deps.GetValueOrDefault(d) : null, e.PositionId is { } p ? poss.GetValueOrDefault(p) : null, e.JobTitle,
                m?.Code, m?.FullName, e.Status, e.JoinedAt, e.LeftAt, e.UserId is { } u && accs.TryGetValue(u, out var a) ? a.UserName : null);
        });
        return TypedResults.File(EmployeeBulk.ExportSheet(data), XlsxType, "danh-sach-nhan-vien.xlsx");
    }
}
