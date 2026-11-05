using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Approval.Contracts;
using OfficeHub.Modules.Approval.Domain;
using OfficeHub.Modules.Approval.Infrastructure;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Approval.Features;

public sealed record PersonBrief(Guid Id, string Code, string FullName, string? DepartmentName);
public sealed record StepDto(int Order, string Kind, string? ApproverName, string Status, string? DecidedByName, DateTimeOffset? DecidedAt, string? Comment);
public sealed record ApprovalDto(Guid Id, string Type, Guid SubjectId, string Title, string Summary, string Status, PersonBrief Requester,
    DateTimeOffset CreatedAt, DateTimeOffset? DecidedAt, IReadOnlyList<StepDto> Steps, bool CanDecide, bool CanCancel);
public sealed record DecisionRequest(string? Comment);
public sealed record CountDto(int Count);

/// <summary>Luồng duyệt dùng chung: đơn chờ tôi duyệt, đơn của tôi, duyệt / từ chối / huỷ.</summary>
internal static class ApprovalEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/inbox", InboxAsync);
        g.MapGet("/inbox/count", InboxCountAsync);
        g.MapGet("/mine", MineAsync);
        g.MapGet("/{id:guid}", GetAsync);
        g.MapPost("/{id:guid}/approve", ApproveAsync);
        g.MapPost("/{id:guid}/reject", RejectAsync);
        g.MapPost("/{id:guid}/cancel", CancelAsync);
    }

    /// <summary>Người đang thao tác: tài khoản + hồ sơ nhân viên (có thể null với admin hệ thống).</summary>
    private sealed record Actor(Guid UserId, string Name, Guid? EmployeeId, bool IsHr, bool IsAdmin);

    private static async Task<Actor> ActorAsync(ClaimsPrincipal user, IEmployeeDirectory dir, CancellationToken ct)
    {
        var uid = user.GetUserId()!.Value;
        var emp = await dir.GetByUserIdAsync(uid, ct);
        return new Actor(uid, user.FindFirstValue(ClaimNames.FullName) ?? user.Identity?.Name ?? "?", emp?.Id, user.IsHr(), user.IsInRole(Roles.Admin));
    }

    private static ApprovalStep? CurrentStep(ApprovalRequest r) =>
        r.Status == RequestStatus.Pending ? r.Steps.OrderBy(s => s.Order).FirstOrDefault(s => s.Status == StepStatus.Pending) : null;

    /// <summary>Không ai tự duyệt đơn của mình. Bước quản lý: đúng người quản lý (hoặc admin). Bước HR: hr/admin.</summary>
    private static bool CanDecide(ApprovalRequest r, Actor a)
    {
        if (CurrentStep(r) is not { } step) return false;
        if (a.EmployeeId == r.RequesterEmployeeId) return false;
        return step.Kind == ApprovalStepKind.Manager ? a.EmployeeId == step.ApproverEmployeeId || a.IsAdmin : a.IsHr;
    }

    private static IQueryable<ApprovalRequest> WithSteps(ApprovalDbContext db) => db.Requests.Include(r => r.Steps);

    private static async Task<Ok<List<ApprovalDto>>> InboxAsync(ClaimsPrincipal user, ApprovalDbContext db, IEmployeeDirectory dir, CancellationToken ct)
    {
        var a = await ActorAsync(user, dir, ct);
        var pending = await WithSteps(db).AsNoTracking().Where(r => r.Status == RequestStatus.Pending).OrderBy(r => r.CreatedAt).ToListAsync(ct);
        return TypedResults.Ok(await ToDtosAsync([.. pending.Where(r => CanDecide(r, a))], a, dir, ct));
    }

    private static async Task<Ok<CountDto>> InboxCountAsync(ClaimsPrincipal user, ApprovalDbContext db, IEmployeeDirectory dir, CancellationToken ct)
    {
        var a = await ActorAsync(user, dir, ct);
        var pending = await WithSteps(db).AsNoTracking().Where(r => r.Status == RequestStatus.Pending).ToListAsync(ct);
        return TypedResults.Ok(new CountDto(pending.Count(r => CanDecide(r, a))));
    }

    private static async Task<Ok<List<ApprovalDto>>> MineAsync(ClaimsPrincipal user, ApprovalDbContext db, IEmployeeDirectory dir, CancellationToken ct)
    {
        var a = await ActorAsync(user, dir, ct);
        if (a.EmployeeId is null) return TypedResults.Ok(new List<ApprovalDto>());
        var mine = await WithSteps(db).AsNoTracking().Where(r => r.RequesterEmployeeId == a.EmployeeId)
            .OrderByDescending(r => r.CreatedAt).Take(200).ToListAsync(ct);
        return TypedResults.Ok(await ToDtosAsync(mine, a, dir, ct));
    }

    private static async Task<Results<Ok<ApprovalDto>, NotFound, ProblemHttpResult>> GetAsync(Guid id, ClaimsPrincipal user, ApprovalDbContext db,
        IEmployeeDirectory dir, CancellationToken ct)
    {
        var a = await ActorAsync(user, dir, ct);
        var r = await WithSteps(db).AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (r is null) return TypedResults.NotFound();
        var related = a.EmployeeId == r.RequesterEmployeeId || a.IsHr || r.Steps.Any(s => s.ApproverEmployeeId == a.EmployeeId);
        if (!related) return TypedResults.Problem("Bạn không có quyền xem đơn này", statusCode: StatusCodes.Status403Forbidden);
        return TypedResults.Ok((await ToDtosAsync([r], a, dir, ct))[0]);
    }

    private static async Task<Results<Ok<ApprovalDto>, NotFound, ProblemHttpResult>> ApproveAsync(Guid id, DecisionRequest req, ClaimsPrincipal user,
        ApprovalDbContext db, IEmployeeDirectory dir, IEnumerable<IApprovalHandler> handlers, TimeProvider clock, CancellationToken ct)
        => await DecideAsync(id, approve: true, req.Comment, user, db, dir, handlers, clock, ct);

    private static async Task<Results<Ok<ApprovalDto>, NotFound, ProblemHttpResult>> RejectAsync(Guid id, DecisionRequest req, ClaimsPrincipal user,
        ApprovalDbContext db, IEmployeeDirectory dir, IEnumerable<IApprovalHandler> handlers, TimeProvider clock, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Comment))
            return TypedResults.Problem("Nhập lý do từ chối", statusCode: StatusCodes.Status400BadRequest);
        return await DecideAsync(id, approve: false, req.Comment, user, db, dir, handlers, clock, ct);
    }

    /// <summary>
    /// Thứ tự (giữ nguyên khi sửa): cập nhật bước → nếu là quyết định cuối thì gọi handler của module sở hữu → lưu.
    /// Handler idempotent nên nếu lưu lỗi, duyệt lại sẽ không áp dụng hai lần.
    /// </summary>
    private static async Task<Results<Ok<ApprovalDto>, NotFound, ProblemHttpResult>> DecideAsync(Guid id, bool approve, string? comment,
        ClaimsPrincipal user, ApprovalDbContext db, IEmployeeDirectory dir, IEnumerable<IApprovalHandler> handlers, TimeProvider clock, CancellationToken ct)
    {
        var a = await ActorAsync(user, dir, ct);
        var r = await WithSteps(db).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (r is null) return TypedResults.NotFound();
        if (r.Status != RequestStatus.Pending) return Problems.Conflict("Đơn đã được xử lý");
        if (!CanDecide(r, a)) return TypedResults.Problem("Bạn không phải người duyệt bước hiện tại của đơn này", statusCode: StatusCodes.Status403Forbidden);

        var now = clock.GetUtcNow();
        var step = CurrentStep(r)!;
        step.Status = approve ? StepStatus.Approved : StepStatus.Rejected;
        step.DecidedByUserId = a.UserId;
        step.DecidedByName = a.Name;
        step.DecidedAt = now;
        step.Comment = string.IsNullOrWhiteSpace(comment) ? null : comment.Trim();

        var handler = handlers.FirstOrDefault(h => h.Type == r.Type)
                      ?? throw new InvalidOperationException($"Chưa đăng ký IApprovalHandler cho loại đơn '{r.Type}'");
        if (!approve)
        {
            await handler.OnRejectedAsync(r.SubjectId, step.Comment, ct);
            r.Status = RequestStatus.Rejected;
            r.DecidedAt = now;
        }
        else if (r.Steps.OrderBy(s => s.Order).FirstOrDefault(s => s.Status == StepStatus.Waiting) is { } next)
        {
            next.Status = StepStatus.Pending; // chuyển sang người duyệt kế tiếp
        }
        else
        {
            await handler.OnApprovedAsync(r.SubjectId, ct);
            r.Status = RequestStatus.Approved;
            r.DecidedAt = now;
        }
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok((await ToDtosAsync([r], a, dir, ct))[0]);
    }

    /// <summary>Người gửi huỷ đơn khi còn chờ duyệt.</summary>
    private static async Task<Results<Ok<ApprovalDto>, NotFound, ProblemHttpResult>> CancelAsync(Guid id, ClaimsPrincipal user, ApprovalDbContext db,
        IEmployeeDirectory dir, IEnumerable<IApprovalHandler> handlers, TimeProvider clock, CancellationToken ct)
    {
        var a = await ActorAsync(user, dir, ct);
        var r = await WithSteps(db).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (r is null) return TypedResults.NotFound();
        if (r.RequesterEmployeeId != a.EmployeeId) return TypedResults.Problem("Chỉ người gửi được huỷ đơn", statusCode: StatusCodes.Status403Forbidden);
        if (r.Status != RequestStatus.Pending) return Problems.Conflict("Chỉ huỷ được đơn đang chờ duyệt");
        var handler = handlers.First(h => h.Type == r.Type);
        await handler.OnCancelledAsync(r.SubjectId, ct);
        r.Status = RequestStatus.Cancelled;
        r.DecidedAt = clock.GetUtcNow();
        foreach (var s in r.Steps.Where(s => s.Status is StepStatus.Pending or StepStatus.Waiting)) s.Status = StepStatus.Waiting;
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok((await ToDtosAsync([r], a, dir, ct))[0]);
    }

    private static async Task<List<ApprovalDto>> ToDtosAsync(List<ApprovalRequest> rows, Actor a, IEmployeeDirectory dir, CancellationToken ct)
    {
        var ids = rows.Select(r => r.RequesterEmployeeId).Concat(rows.SelectMany(r => r.Steps).Where(s => s.ApproverEmployeeId != null)
            .Select(s => s.ApproverEmployeeId!.Value)).Distinct().ToList();
        var people = new Dictionary<Guid, EmployeeRef>();
        foreach (var id in ids) if (await dir.GetAsync(id, ct) is { } e) people[id] = e;
        PersonBrief Brief(Guid id) => people.TryGetValue(id, out var e) ? new(e.Id, e.Code, e.FullName, e.DepartmentName) : new(id, "?", "(không rõ)", null);
        return rows.Select(r => new ApprovalDto(r.Id, r.Type, r.SubjectId, r.Title, r.Summary, r.Status.ToString(), Brief(r.RequesterEmployeeId),
            r.CreatedAt, r.DecidedAt,
            [.. r.Steps.OrderBy(s => s.Order).Select(s => new StepDto(s.Order, s.Kind.ToString(),
                s.Kind == ApprovalStepKind.Manager && s.ApproverEmployeeId is { } m ? Brief(m).FullName : "HR",
                s.Status.ToString(), s.DecidedByName, s.DecidedAt, s.Comment))],
            CanDecide(r, a), r.Status == RequestStatus.Pending && r.RequesterEmployeeId == a.EmployeeId)).ToList();
    }
}
