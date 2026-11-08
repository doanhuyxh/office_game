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
/// <param name="OnBehalfOfName">Có = người quyết định đã duyệt thay người quản lý này (uỷ quyền).</param>
public sealed record StepDto(int Order, string Kind, string? ApproverName, string Status, string? DecidedByName, DateTimeOffset? DecidedAt, string? Comment,
    string? OnBehalfOfName = null);
/// <param name="DecideOnBehalfOfName">Có = người gọi chỉ được quyết định với tư cách người được uỷ quyền của người quản lý này ("duyệt thay").</param>
public sealed record ApprovalDto(Guid Id, string Type, Guid SubjectId, string Title, string Summary, string Status, PersonBrief Requester,
    DateTimeOffset CreatedAt, DateTimeOffset? DecidedAt, IReadOnlyList<StepDto> Steps, bool CanDecide, bool CanCancel, string? DecideOnBehalfOfName = null);
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
        DelegationEndpoints.Map(g.MapGroup("/delegations"));
    }

    /// <summary>Người đang thao tác: tài khoản + hồ sơ nhân viên (có thể null với admin hệ thống) + người quản lý đang uỷ quyền cho họ hôm nay.</summary>
    internal sealed record Actor(Guid UserId, string Name, Guid? EmployeeId, bool IsHr, bool IsAdmin, IReadOnlySet<Guid> DelegatedBy, bool IsFinanceApprover = false)
    {
        public DeciderContext Decider => new(EmployeeId, IsHr, IsAdmin, DelegatedBy, IsFinanceApprover);
    }

    internal static async Task<Actor> ActorAsync(ClaimsPrincipal user, IEmployeeDirectory dir, DelegationLookup delegations, IFinanceAccess finance, CancellationToken ct)
    {
        var uid = user.GetUserId()!.Value;
        var emp = await dir.GetByUserIdAsync(uid, ct);
        return new Actor(uid, user.FindFirstValue(ClaimNames.FullName) ?? user.Identity?.Name ?? "?", emp?.Id, user.IsHr(), user.IsInRole(Roles.Admin),
            await delegations.DelegatorsOfAsync(emp?.Id, ct), (await finance.GetAsync(uid, ct)).Has(FinancePermission.Approve));
    }

    private static bool CanDecide(ApprovalRequest r, Actor a) => ApprovalRules.CanDecide(r, a.Decider);

    /// <summary>
    /// Đơn có bước Tài chính (đề nghị chi…) KHÔNG mở cho token AI (chủ dự án: không mở tiền cho AI): ẩn khỏi danh sách / chi tiết,
    /// không duyệt / từ chối / huỷ qua MCP. Phải thao tác trên web.
    /// </summary>
    private static bool HiddenFromAi(ApprovalRequest r, ClaimsPrincipal user) => user.IsAccessToken() && r.Steps.Any(s => s.Kind == ApprovalStepKind.Finance);
    private static ProblemHttpResult AiForbidden() =>
        TypedResults.Problem("Đơn liên quan đến tiền (đề nghị chi) chỉ xem / duyệt trên web, không qua trợ lý AI", statusCode: StatusCodes.Status403Forbidden);

    private static IQueryable<ApprovalRequest> WithSteps(ApprovalDbContext db) => db.Requests.Include(r => r.Steps);

    private static async Task<Ok<List<ApprovalDto>>> InboxAsync(ClaimsPrincipal user, ApprovalDbContext db, IEmployeeDirectory dir, DelegationLookup delegations, IFinanceAccess finance, CancellationToken ct)
    {
        var a = await ActorAsync(user, dir, delegations, finance, ct);
        var pending = await WithSteps(db).AsNoTracking().Where(r => r.Status == RequestStatus.Pending).OrderBy(r => r.CreatedAt).ToListAsync(ct);
        return TypedResults.Ok(await ToDtosAsync([.. pending.Where(r => CanDecide(r, a) && !HiddenFromAi(r, user))], a, dir, ct));
    }

    private static async Task<Ok<CountDto>> InboxCountAsync(ClaimsPrincipal user, ApprovalDbContext db, IEmployeeDirectory dir, DelegationLookup delegations, IFinanceAccess finance, CancellationToken ct)
    {
        var a = await ActorAsync(user, dir, delegations, finance, ct);
        var pending = await WithSteps(db).AsNoTracking().Where(r => r.Status == RequestStatus.Pending).ToListAsync(ct);
        return TypedResults.Ok(new CountDto(pending.Count(r => CanDecide(r, a) && !HiddenFromAi(r, user))));
    }

    private static async Task<Ok<List<ApprovalDto>>> MineAsync(ClaimsPrincipal user, ApprovalDbContext db, IEmployeeDirectory dir, DelegationLookup delegations, IFinanceAccess finance, CancellationToken ct)
    {
        var a = await ActorAsync(user, dir, delegations, finance, ct);
        if (a.EmployeeId is null) return TypedResults.Ok(new List<ApprovalDto>());
        var mine = await WithSteps(db).AsNoTracking().Where(r => r.RequesterEmployeeId == a.EmployeeId)
            .OrderByDescending(r => r.CreatedAt).Take(200).ToListAsync(ct);
        return TypedResults.Ok(await ToDtosAsync([.. mine.Where(r => !HiddenFromAi(r, user))], a, dir, ct));
    }

    private static async Task<Results<Ok<ApprovalDto>, NotFound, ProblemHttpResult>> GetAsync(Guid id, ClaimsPrincipal user, ApprovalDbContext db,
        IEmployeeDirectory dir, DelegationLookup delegations, IFinanceAccess finance, CancellationToken ct)
    {
        var a = await ActorAsync(user, dir, delegations, finance, ct);
        var r = await WithSteps(db).AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (r is null || HiddenFromAi(r, user)) return TypedResults.NotFound();
        // Người gửi, HR, người duyệt của một bước, người đã quyết định một bước (vd duyệt thay), người đang được uỷ quyền của người duyệt.
        var related = a.EmployeeId == r.RequesterEmployeeId || a.IsHr || a.IsFinanceApprover && r.Steps.Any(s => s.Kind == ApprovalStepKind.Finance) || r.Steps.Any(s => s.ApproverEmployeeId == a.EmployeeId
            || s.DecidedByUserId == a.UserId || s.ApproverEmployeeId is { } m && a.DelegatedBy.Contains(m));
        if (!related) return TypedResults.Problem("Bạn không có quyền xem đơn này", statusCode: StatusCodes.Status403Forbidden);
        return TypedResults.Ok((await ToDtosAsync([r], a, dir, ct))[0]);
    }

    private static async Task<Results<Ok<ApprovalDto>, NotFound, ProblemHttpResult>> ApproveAsync(Guid id, DecisionRequest req, ClaimsPrincipal user,
        ApprovalDbContext db, IEmployeeDirectory dir, DelegationLookup delegations, IFinanceAccess finance, IEnumerable<IApprovalHandler> handlers, TimeProvider clock, ApprovalNotifications notify,
        CancellationToken ct)
        => await DecideAsync(id, approve: true, req.Comment, user, db, dir, delegations, finance, handlers, clock, notify, ct);

    private static async Task<Results<Ok<ApprovalDto>, NotFound, ProblemHttpResult>> RejectAsync(Guid id, DecisionRequest req, ClaimsPrincipal user,
        ApprovalDbContext db, IEmployeeDirectory dir, DelegationLookup delegations, IFinanceAccess finance, IEnumerable<IApprovalHandler> handlers, TimeProvider clock, ApprovalNotifications notify,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Comment))
            return TypedResults.Problem("Nhập lý do từ chối", statusCode: StatusCodes.Status400BadRequest);
        return await DecideAsync(id, approve: false, req.Comment, user, db, dir, delegations, finance, handlers, clock, notify, ct);
    }

    /// <summary>
    /// Thứ tự (giữ nguyên khi sửa): cập nhật bước → nếu là quyết định cuối thì gọi handler của module sở hữu → lưu.
    /// Handler idempotent nên nếu lưu lỗi, duyệt lại sẽ không áp dụng hai lần. Thông báo gửi SAU khi lưu (không ném lỗi).
    /// </summary>
    private static async Task<Results<Ok<ApprovalDto>, NotFound, ProblemHttpResult>> DecideAsync(Guid id, bool approve, string? comment,
        ClaimsPrincipal user, ApprovalDbContext db, IEmployeeDirectory dir, DelegationLookup delegations, IFinanceAccess finance, IEnumerable<IApprovalHandler> handlers, TimeProvider clock,
        ApprovalNotifications notify, CancellationToken ct)
    {
        var a = await ActorAsync(user, dir, delegations, finance, ct);
        var r = await WithSteps(db).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (r is null) return TypedResults.NotFound();
        if (HiddenFromAi(r, user)) return AiForbidden();
        if (r.Status != RequestStatus.Pending) return Problems.Conflict("Đơn đã được xử lý");
        var right = ApprovalRules.Right(r, a.Decider);
        if (right == DecisionRight.None) return TypedResults.Problem("Bạn không phải người duyệt bước hiện tại của đơn này", statusCode: StatusCodes.Status403Forbidden);

        var now = clock.GetUtcNow();
        var step = ApprovalRules.CurrentStep(r)!;
        step.Status = approve ? StepStatus.Approved : StepStatus.Rejected;
        step.DecidedByUserId = a.UserId;
        step.DecidedByName = a.Name;
        step.DecidedAt = now;
        step.Comment = string.IsNullOrWhiteSpace(comment) ? null : comment.Trim();
        var decidedBy = a.Name;
        if (right == DecisionRight.Delegate)
        {
            // Duyệt thay theo uỷ quyền: lưu người quản lý được thay để hiện "duyệt thay X" (UI + thông báo).
            step.OnBehalfOfEmployeeId = step.ApproverEmployeeId;
            step.OnBehalfOfName = (await dir.GetAsync(step.ApproverEmployeeId!.Value, ct))?.FullName ?? "?";
            decidedBy = $"{a.Name} (duyệt thay {step.OnBehalfOfName})";
        }

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
        if (r.Status == RequestStatus.Pending) await notify.AdvancedAsync(r, decidedBy, ct);
        else await notify.DecidedAsync(r, approve, decidedBy, step.Comment, ct);
        return TypedResults.Ok((await ToDtosAsync([r], a, dir, ct))[0]);
    }

    /// <summary>Người gửi huỷ đơn khi còn chờ duyệt.</summary>
    private static async Task<Results<Ok<ApprovalDto>, NotFound, ProblemHttpResult>> CancelAsync(Guid id, ClaimsPrincipal user, ApprovalDbContext db,
        IEmployeeDirectory dir, DelegationLookup delegations, IFinanceAccess finance, IEnumerable<IApprovalHandler> handlers, TimeProvider clock, ApprovalNotifications notify, CancellationToken ct)
    {
        var a = await ActorAsync(user, dir, delegations, finance, ct);
        var r = await WithSteps(db).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (r is null) return TypedResults.NotFound();
        if (HiddenFromAi(r, user)) return AiForbidden();
        if (r.RequesterEmployeeId != a.EmployeeId) return TypedResults.Problem("Chỉ người gửi được huỷ đơn", statusCode: StatusCodes.Status403Forbidden);
        if (r.Status != RequestStatus.Pending) return Problems.Conflict("Chỉ huỷ được đơn đang chờ duyệt");
        var approvers = await notify.CurrentApproversAsync(r, ct); // lấy trước khi huỷ (sau đó không còn bước hiện tại)
        var handler = handlers.First(h => h.Type == r.Type);
        await handler.OnCancelledAsync(r.SubjectId, ct);
        r.Status = RequestStatus.Cancelled;
        r.DecidedAt = clock.GetUtcNow();
        foreach (var s in r.Steps.Where(s => s.Status is StepStatus.Pending or StepStatus.Waiting)) s.Status = StepStatus.Waiting;
        await db.SaveChangesAsync(ct);
        await notify.CancelledAsync(r, approvers, ct);
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
                s.Kind == ApprovalStepKind.Manager && s.ApproverEmployeeId is { } m ? Brief(m).FullName : s.Kind == ApprovalStepKind.Finance ? "Tài chính" : "HR",
                s.Status.ToString(), s.DecidedByName, s.DecidedAt, s.Comment, s.OnBehalfOfName))],
            CanDecide(r, a), r.Status == RequestStatus.Pending && r.RequesterEmployeeId == a.EmployeeId,
            ApprovalRules.Right(r, a.Decider) == DecisionRight.Delegate && ApprovalRules.CurrentStep(r)?.ApproverEmployeeId is { } m ? Brief(m).FullName : null)).ToList();
    }
}
