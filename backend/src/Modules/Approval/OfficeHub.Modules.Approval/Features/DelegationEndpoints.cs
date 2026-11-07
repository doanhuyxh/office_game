using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.Builder;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Approval.Contracts;
using OfficeHub.Modules.Approval.Domain;
using OfficeHub.Modules.Approval.Infrastructure;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Approval.Features;

public sealed record DelegationDto(Guid Id, PersonBrief Delegator, PersonBrief Delegate, DateOnly FromDate, DateOnly ToDate, string? Note,
    string Status, DateTimeOffset CreatedAt, string CreatedByName, DateTimeOffset? RevokedAt, string? RevokedByName, bool CanRevoke);
/// <param name="EmployeeId">Hồ sơ nhân viên của tôi (null = tài khoản không có hồ sơ, vd admin hệ thống).</param>
public sealed record MyDelegationsDto(Guid? EmployeeId, bool CanDelegate, IReadOnlyList<DelegationDto> Given, IReadOnlyList<DelegationDto> Received);
/// <param name="DelegatorEmployeeId">Trống = chính tôi. Khác tôi → chỉ HR / admin.</param>
public sealed record CreateDelegationRequest(Guid? DelegatorEmployeeId, Guid DelegateEmployeeId, DateOnly FromDate, DateOnly ToDate, string? Note);

/// <summary>
/// Uỷ quyền duyệt (/api/approval/delegations): người quản lý cho một nhân viên đang làm duyệt thay bước Manager trong khoảng ngày.
/// HR / admin tạo / thu hồi thay bất kỳ người quản lý nào và xem toàn bộ. Quy tắc: <see cref="DelegationRules"/>.
/// </summary>
internal static class DelegationEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/", MineAsync);
        g.MapGet("/all", AllAsync).RequireAuthorization(AuthPolicies.Hr);
        g.MapPost("/", CreateAsync);
        g.MapPost("/{id:guid}/revoke", RevokeAsync);
    }

    private static async Task<Ok<MyDelegationsDto>> MineAsync(ClaimsPrincipal user, ApprovalDbContext db, IEmployeeDirectory dir,
        DelegationLookup lookup, CancellationToken ct)
    {
        var me = await dir.GetByUserIdAsync(user.GetUserId()!.Value, ct);
        if (me is null) return TypedResults.Ok(new MyDelegationsDto(null, false, [], []));
        var rows = await db.Delegations.AsNoTracking()
            .Where(d => d.DelegatorEmployeeId == me.Id || d.DelegateEmployeeId == me.Id)
            .OrderByDescending(d => d.FromDate).ThenByDescending(d => d.CreatedAt).Take(200).ToListAsync(ct);
        var dtos = await ToDtosAsync(rows, user, me.Id, lookup.Today(), dir, ct);
        var canDelegate = (await dir.GetSubordinateIdsAsync(me.Id, ct)).Count > 0;
        return TypedResults.Ok(new MyDelegationsDto(me.Id, canDelegate,
            [.. dtos.Where(d => d.Delegator.Id == me.Id)], [.. dtos.Where(d => d.Delegate.Id == me.Id)]));
    }

    /// <summary>HR: mọi uỷ quyền. <c>status</c> = current (đang / sắp hiệu lực, mặc định) | all.</summary>
    private static async Task<Results<Ok<List<DelegationDto>>, Ok<PagedResult<DelegationDto>>>> AllAsync(ClaimsPrincipal user, ApprovalDbContext db,
        IEmployeeDirectory dir, DelegationLookup lookup, string? status, int? page, int? pageSize, CancellationToken ct)
    {
        var today = lookup.Today();
        var q = db.Delegations.AsNoTracking();
        if (status != "all") q = q.Where(d => d.RevokedAt == null && d.ToDate >= today);
        q = q.OrderByDescending(d => d.FromDate).ThenByDescending(d => d.Id);
        var me = (await dir.GetByUserIdAsync(user.GetUserId()!.Value, ct))?.Id;
        if (page is { } p)
        {
            var paged = await q.ToPagedAsync(p, pageSize, ct);
            return TypedResults.Ok(paged.With(await ToDtosAsync([.. paged.Items], user, me, today, dir, ct)));
        }
        return TypedResults.Ok(await ToDtosAsync(await q.Take(500).ToListAsync(ct), user, me, today, dir, ct));
    }

    private static async Task<Results<Ok<DelegationDto>, ValidationProblem, ProblemHttpResult>> CreateAsync(CreateDelegationRequest req,
        ClaimsPrincipal user, ApprovalDbContext db, IEmployeeDirectory dir, DelegationLookup lookup, ApprovalNotifications notify,
        TimeProvider clock, CancellationToken ct)
    {
        var uid = user.GetUserId()!.Value;
        var me = await dir.GetByUserIdAsync(uid, ct);
        Guid delegatorId;
        if (req.DelegatorEmployeeId is { } given && given != me?.Id)
        {
            if (!user.IsHr()) return TypedResults.Problem("Chỉ HR được tạo uỷ quyền thay người khác", statusCode: StatusCodes.Status403Forbidden);
            delegatorId = given;
        }
        else if (me is null) return Problems.Conflict("Tài khoản chưa gắn hồ sơ nhân viên");
        else delegatorId = me.Id;

        var delegator = await dir.GetAsync(delegatorId, ct);
        if (delegator is not { IsActive: true })
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["delegatorEmployeeId"] = ["Người uỷ quyền phải là nhân viên đang làm việc"] });
        if ((await dir.GetSubordinateIdsAsync(delegatorId, ct)).Count == 0)
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["delegatorEmployeeId"] = [$"{delegator.FullName} không có nhân viên cấp dưới — không có đơn nào để uỷ quyền duyệt"],
            });
        var target = req.DelegateEmployeeId == Guid.Empty ? null : await dir.GetAsync(req.DelegateEmployeeId, ct);
        var today = lookup.Today();
        var note = string.IsNullOrWhiteSpace(req.Note) ? null : req.Note.Trim();

        // Khoá theo người uỷ quyền trong transaction: hai lần bấm cùng lúc không cùng lọt qua bước chặn trùng thời gian.
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtext({"approval-delegation:" + delegatorId}))", ct);
        var existing = await db.Delegations.AsNoTracking().Where(d => d.DelegatorEmployeeId == delegatorId && d.RevokedAt == null && d.ToDate >= today)
            .ToListAsync(ct);
        var errors = DelegationRules.Validate(delegatorId, req.DelegateEmployeeId, req.FromDate, req.ToDate, today,
            target is { IsActive: true }, target?.UserId is not null, existing, note);
        if (errors.Count > 0)
            return TypedResults.ValidationProblem(errors.GroupBy(e => e.Field).ToDictionary(x => x.Key, x => x.Select(e => e.Message).ToArray()));

        var d = new ApprovalDelegation
        {
            DelegatorEmployeeId = delegatorId, DelegateEmployeeId = req.DelegateEmployeeId, FromDate = req.FromDate, ToDate = req.ToDate, Note = note,
            CreatedAt = clock.GetUtcNow(), CreatedByUserId = uid, CreatedByName = ActorName(user),
        };
        db.Delegations.Add(d);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);

        var pending = DelegationRules.IsActiveOn(d, today)
            ? await db.Steps.CountAsync(s => s.Status == StepStatus.Pending && s.Kind == ApprovalStepKind.Manager && s.ApproverEmployeeId == delegatorId, ct)
            : 0;
        await notify.DelegationCreatedAsync(d, uid, pending, ct); // không ném lỗi
        return TypedResults.Ok((await ToDtosAsync([d], user, me?.Id, today, dir, ct))[0]);
    }

    /// <summary>Thu hồi (người uỷ quyền hoặc HR / admin) khi còn hiệu lực hoặc chưa tới ngày bắt đầu.</summary>
    private static async Task<Results<Ok<DelegationDto>, NotFound, ProblemHttpResult>> RevokeAsync(Guid id, ClaimsPrincipal user, ApprovalDbContext db,
        IEmployeeDirectory dir, DelegationLookup lookup, ApprovalNotifications notify, TimeProvider clock, CancellationToken ct)
    {
        var uid = user.GetUserId()!.Value;
        var me = (await dir.GetByUserIdAsync(uid, ct))?.Id;
        var d = await db.Delegations.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (d is null) return TypedResults.NotFound();
        if (d.DelegatorEmployeeId != me && !user.IsHr())
            return TypedResults.Problem("Chỉ người uỷ quyền hoặc HR được thu hồi", statusCode: StatusCodes.Status403Forbidden);
        var today = lookup.Today();
        switch (DelegationRules.Status(d, today))
        {
            case DelegationStatus.Revoked: return Problems.Conflict("Uỷ quyền đã được thu hồi");
            case DelegationStatus.Expired: return Problems.Conflict("Uỷ quyền đã hết hạn");
        }
        d.RevokedAt = clock.GetUtcNow();
        d.RevokedByUserId = uid;
        d.RevokedByName = ActorName(user);
        await db.SaveChangesAsync(ct);
        await notify.DelegationRevokedAsync(d, uid, ct); // không ném lỗi
        return TypedResults.Ok((await ToDtosAsync([d], user, me, today, dir, ct))[0]);
    }

    private static string ActorName(ClaimsPrincipal user) => user.FindFirstValue(ClaimNames.FullName) ?? user.Identity?.Name ?? "?";

    private static async Task<List<DelegationDto>> ToDtosAsync(List<ApprovalDelegation> rows, ClaimsPrincipal user, Guid? me, DateOnly today,
        IEmployeeDirectory dir, CancellationToken ct)
    {
        var people = new Dictionary<Guid, EmployeeRef>();
        foreach (var id in rows.SelectMany(r => new[] { r.DelegatorEmployeeId, r.DelegateEmployeeId }).Distinct())
            if (await dir.GetAsync(id, ct) is { } e) people[id] = e;
        PersonBrief Brief(Guid id) => people.TryGetValue(id, out var e) ? new(e.Id, e.Code, e.FullName, e.DepartmentName) : new(id, "?", "(không rõ)", null);
        var isHr = user.IsHr();
        return rows.Select(d =>
        {
            var status = DelegationRules.Status(d, today);
            var canRevoke = status is DelegationStatus.Active or DelegationStatus.Upcoming && (isHr || d.DelegatorEmployeeId == me);
            return new DelegationDto(d.Id, Brief(d.DelegatorEmployeeId), Brief(d.DelegateEmployeeId), d.FromDate, d.ToDate, d.Note, status.ToString(),
                d.CreatedAt, d.CreatedByName, d.RevokedAt, d.RevokedByName, canRevoke);
        }).ToList();
    }
}
