using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.Modules.Approval.Domain;

namespace OfficeHub.Modules.Approval.Infrastructure;

/// <summary>Tra uỷ quyền duyệt đang hiệu lực HÔM NAY (ngày theo Office__TimeZone).</summary>
internal sealed class DelegationLookup(ApprovalDbContext db, TimeProvider clock, IOptions<OfficeSettings> office)
{
    private readonly TimeZoneInfo _tz = TimeZoneInfo.FindSystemTimeZoneById(office.Value.TimeZone);

    public DateOnly Today() => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), _tz).DateTime);

    /// <summary>Id các người quản lý đang uỷ quyền cho nhân viên này hôm nay (không bắc cầu: chỉ uỷ quyền trực tiếp).</summary>
    public async Task<IReadOnlySet<Guid>> DelegatorsOfAsync(Guid? delegateEmployeeId, CancellationToken ct)
    {
        if (delegateEmployeeId is not { } id) return new HashSet<Guid>();
        var today = Today();
        var list = await db.Delegations.AsNoTracking()
            .Where(d => d.DelegateEmployeeId == id && d.RevokedAt == null && d.FromDate <= today && d.ToDate >= today)
            .Select(d => d.DelegatorEmployeeId).ToListAsync(ct);
        return list.ToHashSet();
    }

    /// <summary>Người đang được người quản lý này uỷ quyền hôm nay (tối đa một do chặn trùng thời gian).</summary>
    public async Task<ApprovalDelegation?> ActiveOfAsync(Guid delegatorEmployeeId, CancellationToken ct)
    {
        var today = Today();
        return await db.Delegations.AsNoTracking()
            .Where(d => d.DelegatorEmployeeId == delegatorEmployeeId && d.RevokedAt == null && d.FromDate <= today && d.ToDate >= today)
            .OrderByDescending(d => d.CreatedAt).FirstOrDefaultAsync(ct);
    }
}
