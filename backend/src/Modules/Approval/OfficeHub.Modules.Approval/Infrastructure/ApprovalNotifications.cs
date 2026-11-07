using Microsoft.Extensions.Logging;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.Modules.Approval.Contracts;
using OfficeHub.Modules.Approval.Domain;
using OfficeHub.Modules.Identity.Contracts;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Approval.Infrastructure;

/// <summary>
/// Thông báo theo vòng đời đơn (gọi SAU khi đã lưu đơn). Không bao giờ ném lỗi: thông báo hỏng chỉ ghi log, không làm hỏng thao tác duyệt.
/// <list type="bullet">
/// <item>Gửi đơn / chuyển bước → người duyệt bước hiện tại (email + app).</item>
/// <item>Duyệt bước trung gian → người gửi (chỉ app).</item>
/// <item>Duyệt cuối / từ chối → người gửi (email + app).</item>
/// <item>Huỷ → người đang phải duyệt (chỉ app).</item>
/// <item>Tạo / thu hồi uỷ quyền duyệt → người được uỷ quyền (email + app), người uỷ quyền nếu HR làm thay (chỉ app).</item>
/// </list>
/// </summary>
internal sealed class ApprovalNotifications(INotifier notifier, IEmployeeDirectory dir, IAccountService accounts, DelegationLookup delegations,
    ILogger<ApprovalNotifications> log)
{
    private const string Link = "/approvals";

    /// <summary>
    /// Tài khoản đang phải duyệt: bước Manager → tài khoản của quản lý + người được quản lý đó uỷ quyền hôm nay;
    /// bước Hr → mọi tài khoản vai trò hr (không có HR → admin).
    /// Luôn bỏ người gửi (không tự duyệt). Gọi TRƯỚC khi huỷ đơn (sau khi huỷ không còn bước hiện tại).
    /// </summary>
    public async Task<List<Guid>> CurrentApproversAsync(ApprovalRequest r, CancellationToken ct)
    {
        try
        {
            if (ApprovalRules.CurrentStep(r) is not { } step) return [];
            var requesterUser = (await dir.GetAsync(r.RequesterEmployeeId, ct))?.UserId;
            List<Guid> ids;
            if (step.Kind == ApprovalStepKind.Manager)
            {
                ids = step.ApproverEmployeeId is { } m && (await dir.GetAsync(m, ct))?.UserId is { } uid ? [uid] : [];
                if (step.ApproverEmployeeId is { } mgr && await delegations.ActiveOfAsync(mgr, ct) is { } d
                    && await dir.GetAsync(d.DelegateEmployeeId, ct) is { IsActive: true, UserId: { } delegateUser })
                    ids.Add(delegateUser);
            }
            else
            {
                var hr = await accounts.ListByRoleAsync(Roles.Hr, ct);
                if (!hr.Any(a => a.Id != requesterUser)) hr = await accounts.ListByRoleAsync(Roles.Admin, ct);
                ids = [.. hr.Select(a => a.Id)];
            }
            return [.. ids.Where(id => id != requesterUser).Distinct()];
        }
        catch (Exception ex)
        {
            log.LogWarning(ex, "Không xác định được người duyệt để thông báo cho đơn {Id}", r.Id);
            return [];
        }
    }

    public Task SubmittedAsync(ApprovalRequest r, CancellationToken ct) => SafeAsync(r, async () =>
    {
        var who = await RequesterAsync(r, ct);
        await notifier.NotifyAsync(new NotificationRequest(await CurrentApproversAsync(r, ct), NotificationCategories.ApprovalRequested,
            $"Đơn chờ bạn duyệt: {r.Title}", $"{who} gửi đơn.\n{r.Summary}", Link), ct);
    });

    /// <summary>Bước trung gian được duyệt: báo người duyệt kế tiếp + báo người gửi đơn đang đi tiếp.</summary>
    public Task AdvancedAsync(ApprovalRequest r, string decidedBy, CancellationToken ct) => SafeAsync(r, async () =>
    {
        var who = await RequesterAsync(r, ct);
        await notifier.NotifyAsync(new NotificationRequest(await CurrentApproversAsync(r, ct), NotificationCategories.ApprovalRequested,
            $"Đơn chờ bạn duyệt: {r.Title}", $"{who} gửi đơn, {decidedBy} đã duyệt bước trước.\n{r.Summary}", Link), ct);
        if (await RequesterUserAsync(r, ct) is { } requester)
            await notifier.NotifyAsync(new NotificationRequest([requester], NotificationCategories.ApprovalApproved,
                $"{r.Title}: {decidedBy} đã duyệt", "Đơn đang chờ bước duyệt tiếp theo.", Link, SendEmail: false), ct);
    });

    public Task DecidedAsync(ApprovalRequest r, bool approved, string decidedBy, string? comment, CancellationToken ct) => SafeAsync(r, async () =>
    {
        if (await RequesterUserAsync(r, ct) is not { } requester) return;
        var (category, title, body) = approved
            ? (NotificationCategories.ApprovalApproved, $"Đơn đã được duyệt: {r.Title}", $"{decidedBy} đã duyệt đơn của bạn.")
            : (NotificationCategories.ApprovalRejected, $"Đơn bị từ chối: {r.Title}", $"{decidedBy} đã từ chối đơn của bạn.\nLý do: {comment}");
        if (approved && !string.IsNullOrWhiteSpace(comment)) body += $"\nGhi chú: {comment}";
        await notifier.NotifyAsync(new NotificationRequest([requester], category, title, body, Link), ct);
    });

    public Task CancelledAsync(ApprovalRequest r, List<Guid> approversBeforeCancel, CancellationToken ct) => SafeAsync(r, async () =>
    {
        var who = await RequesterAsync(r, ct);
        await notifier.NotifyAsync(new NotificationRequest(approversBeforeCancel, NotificationCategories.ApprovalCancelled,
            $"Đơn đã bị huỷ: {r.Title}", $"{who} đã huỷ đơn, bạn không cần duyệt nữa.", Link, SendEmail: false), ct);
    });

    /// <summary>Uỷ quyền mới: báo người được uỷ quyền (email + app); HR tạo thay → báo cả người uỷ quyền (chỉ app).</summary>
    public async Task DelegationCreatedAsync(ApprovalDelegation d, Guid actorUserId, int pendingNow, CancellationToken ct)
    {
        try
        {
            var (from, to) = (await dir.GetAsync(d.DelegatorEmployeeId, ct), await dir.GetAsync(d.DelegateEmployeeId, ct));
            var range = $"{d.FromDate:dd/MM/yyyy} – {d.ToDate:dd/MM/yyyy}";
            if (to?.UserId is { } delegateUser && delegateUser != actorUserId)
            {
                var body = $"Bạn được duyệt thay bước quản lý cho các đơn gửi tới {from?.FullName} trong {range}." +
                           (d.Note is { Length: > 0 } n ? $"\nGhi chú: {n}" : "") +
                           (pendingNow > 0 ? $"\nHiện có {pendingNow} đơn đang chờ." : "");
                await notifier.NotifyAsync(new NotificationRequest([delegateUser], NotificationCategories.ApprovalDelegation,
                    $"{from?.FullName} uỷ quyền duyệt cho bạn ({range})", body, Link), ct);
            }
            if (from?.UserId is { } delegatorUser && delegatorUser != actorUserId)
                await notifier.NotifyAsync(new NotificationRequest([delegatorUser], NotificationCategories.ApprovalDelegation,
                    $"HR đã đặt uỷ quyền duyệt của bạn cho {to?.FullName} ({range})", $"{d.CreatedByName} tạo uỷ quyền.", Link, SendEmail: false), ct);
        }
        catch (Exception ex) { log.LogWarning(ex, "Gửi thông báo uỷ quyền {Id} lỗi", d.Id); }
    }

    /// <summary>Thu hồi: báo người được uỷ quyền (email + app); người khác người uỷ quyền thu hồi → báo cả người uỷ quyền (chỉ app).</summary>
    public async Task DelegationRevokedAsync(ApprovalDelegation d, Guid actorUserId, CancellationToken ct)
    {
        try
        {
            var (from, to) = (await dir.GetAsync(d.DelegatorEmployeeId, ct), await dir.GetAsync(d.DelegateEmployeeId, ct));
            var range = $"{d.FromDate:dd/MM/yyyy} – {d.ToDate:dd/MM/yyyy}";
            if (to?.UserId is { } delegateUser && delegateUser != actorUserId)
                await notifier.NotifyAsync(new NotificationRequest([delegateUser], NotificationCategories.ApprovalDelegation,
                    $"Đã thu hồi uỷ quyền duyệt của {from?.FullName} ({range})", $"{d.RevokedByName} đã thu hồi. Bạn không còn duyệt thay {from?.FullName}.", Link), ct);
            if (from?.UserId is { } delegatorUser && delegatorUser != actorUserId)
                await notifier.NotifyAsync(new NotificationRequest([delegatorUser], NotificationCategories.ApprovalDelegation,
                    $"Đã thu hồi uỷ quyền duyệt cho {to?.FullName} ({range})", $"{d.RevokedByName} đã thu hồi.", Link, SendEmail: false), ct);
        }
        catch (Exception ex) { log.LogWarning(ex, "Gửi thông báo thu hồi uỷ quyền {Id} lỗi", d.Id); }
    }

    private async Task<string> RequesterAsync(ApprovalRequest r, CancellationToken ct) =>
        await dir.GetAsync(r.RequesterEmployeeId, ct) is { } e ? (e.DepartmentName is { } d ? $"{e.FullName} ({d})" : e.FullName) : "Nhân viên";

    private async Task<Guid?> RequesterUserAsync(ApprovalRequest r, CancellationToken ct) => (await dir.GetAsync(r.RequesterEmployeeId, ct))?.UserId;

    private async Task SafeAsync(ApprovalRequest r, Func<Task> send)
    {
        try { await send(); }
        catch (Exception ex) { log.LogWarning(ex, "Gửi thông báo cho đơn {Id} ({Type}) lỗi", r.Id, r.Type); }
    }
}
