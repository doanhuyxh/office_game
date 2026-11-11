using System.Security.Claims;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.Modules.Audit.Domain;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Audit.Infrastructure;

/// <summary>
/// Người được xem nhật ký / thống kê AI của ai. <see cref="UserIds"/> null = mọi người (HR, không lọc phòng ban).
/// <see cref="Employees"/>: hồ sơ nhân viên theo UserId (tên phòng ban, mã) — tài khoản không gắn hồ sơ (admin hệ thống) không có.
/// </summary>
internal sealed record AiUsageScope(IReadOnlySet<Guid>? UserIds, IReadOnlyDictionary<Guid, EmployeeRef> Employees)
{
    public bool Contains(Guid userId) => UserIds is null || UserIds.Contains(userId);

    /// <summary>
    /// HR: mọi người (lọc <paramref name="departmentId"/> gồm phòng ban con). Quản lý: bản thân + cấp dưới trực tiếp / gián tiếp.
    /// Vai trò khác → null (không có quyền). Nhân viên lấy theo kỳ [from, to] nên gồm cả người đã nghỉ trong kỳ.
    /// </summary>
    public static async Task<AiUsageScope?> ResolveAsync(ClaimsPrincipal user, IEmployeeDirectory dir, DateOnly from, DateOnly to,
        Guid? departmentId, CancellationToken ct)
    {
        if (user.GetUserId() is not { } me) return null;
        var isHr = user.IsHr();
        if (!isHr && !user.IsInRole(Roles.Manager)) return null;

        var employees = await dir.ListEmployedAsync(from, to, ct);
        var byUser = employees.Where(e => e.UserId is not null).GroupBy(e => e.UserId!.Value).ToDictionary(g => g.Key, g => g.First());

        IEnumerable<EmployeeRef>? pool = null; // null = không giới hạn
        if (!isHr)
        {
            var visible = new HashSet<Guid>();
            if (await dir.GetByUserIdAsync(me, ct) is { } meEmp)
            {
                visible.UnionWith(await dir.GetSubordinateIdsAsync(meEmp.Id, ct));
                visible.Add(meEmp.Id);
            }
            pool = employees.Where(e => visible.Contains(e.Id));
        }
        if (departmentId is { } dep)
        {
            var deps = AiUsageRules.WithDescendants(dep, (await dir.ListDepartmentsAsync(ct)).Select(d => (d.Id, d.ParentId)));
            pool = (pool ?? employees).Where(e => e.DepartmentId is { } d && deps.Contains(d));
        }
        if (pool is null) return new AiUsageScope(null, byUser);

        var ids = pool.Where(e => e.UserId is not null).Select(e => e.UserId!.Value).ToHashSet();
        if (!isHr && departmentId is null) ids.Add(me); // quản lý luôn thấy của mình (kể cả chưa gắn hồ sơ)
        return new AiUsageScope(ids, byUser);
    }
}
