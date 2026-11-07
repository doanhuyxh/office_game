using OfficeHub.Modules.Approval.Contracts;

namespace OfficeHub.Modules.Approval.Domain;

/// <summary>Tư cách quyết định bước hiện tại. Delegate = duyệt thay người quản lý (uỷ quyền đang hiệu lực hôm nay).</summary>
public enum DecisionRight { None, Approver, Delegate, Admin, Hr }

/// <summary>Người đang thao tác. <paramref name="DelegatedBy"/> = Id người quản lý đang uỷ quyền cho người này hôm nay (không bắc cầu).</summary>
public sealed record DeciderContext(Guid? EmployeeId, bool IsHr, bool IsAdmin, IReadOnlySet<Guid> DelegatedBy);

/// <summary>Ai được quyết định đơn — hàm thuần (test: tests/OfficeHub.Modules.Approval.Tests).</summary>
public static class ApprovalRules
{
    public static ApprovalStep? CurrentStep(ApprovalRequest r) =>
        r.Status == RequestStatus.Pending ? r.Steps.OrderBy(s => s.Order).FirstOrDefault(s => s.Status == StepStatus.Pending) : null;

    /// <summary>
    /// Không ai tự duyệt đơn của mình (kể cả HR / admin / người được uỷ quyền). Bước Manager: đúng người quản lý → Approver;
    /// người được người quản lý đó uỷ quyền hôm nay → Delegate; admin → Admin. Bước Hr: hr / admin (HR không duyệt thay bước quản lý).
    /// </summary>
    public static DecisionRight Right(ApprovalRequest r, DeciderContext a)
    {
        if (CurrentStep(r) is not { } step) return DecisionRight.None;
        if (a.EmployeeId is { } me && me == r.RequesterEmployeeId) return DecisionRight.None;
        if (step.Kind == ApprovalStepKind.Hr) return a.IsHr ? DecisionRight.Hr : DecisionRight.None;
        if (step.ApproverEmployeeId is { } approver)
        {
            if (a.EmployeeId == approver) return DecisionRight.Approver;
            if (a.DelegatedBy.Contains(approver)) return DecisionRight.Delegate;
        }
        return a.IsAdmin ? DecisionRight.Admin : DecisionRight.None;
    }

    public static bool CanDecide(ApprovalRequest r, DeciderContext a) => Right(r, a) != DecisionRight.None;
}

public enum DelegationStatus { Upcoming, Active, Expired, Revoked }

/// <summary>Quy tắc uỷ quyền duyệt — hàm thuần (test: tests/OfficeHub.Modules.Approval.Tests).</summary>
public static class DelegationRules
{
    /// <summary>Một lần uỷ quyền tối đa 90 ngày (tính cả hai đầu) — đủ cho nghỉ thai sản / công tác dài; lâu hơn thì đổi quản lý trực tiếp.</summary>
    public const int MaxDays = 90;
    public const int NoteMaxLength = 500;

    public static DelegationStatus Status(ApprovalDelegation d, DateOnly today) =>
        d.RevokedAt is not null ? DelegationStatus.Revoked
        : today < d.FromDate ? DelegationStatus.Upcoming
        : today > d.ToDate ? DelegationStatus.Expired
        : DelegationStatus.Active;

    public static bool IsActiveOn(ApprovalDelegation d, DateOnly day) => d.RevokedAt is null && d.FromDate <= day && day <= d.ToDate;

    /// <summary>Còn chặn trùng: chưa thu hồi và chưa hết hạn.</summary>
    public static bool Blocks(ApprovalDelegation d, DateOnly today) => d.RevokedAt is null && d.ToDate >= today;

    /// <summary>
    /// Lỗi theo field khi tạo uỷ quyền. <paramref name="existing"/> = các uỷ quyền khác của cùng người uỷ quyền.
    /// Không tự uỷ quyền; người nhận đang làm việc + có tài khoản; ngày kết thúc ≥ hôm nay và ≥ ngày bắt đầu; ≤ 90 ngày;
    /// không trùng thời gian với uỷ quyền còn hiệu lực / sắp tới của cùng người (mỗi lúc chỉ một người được duyệt thay).
    /// </summary>
    public static List<(string Field, string Message)> Validate(Guid delegatorId, Guid delegateId, DateOnly from, DateOnly to, DateOnly today,
        bool delegateActive, bool delegateHasAccount, IEnumerable<ApprovalDelegation> existing, string? note = null)
    {
        var e = new List<(string, string)>();
        if (delegateId == Guid.Empty) e.Add(("delegateEmployeeId", "Chọn người được uỷ quyền"));
        else if (delegateId == delegatorId) e.Add(("delegateEmployeeId", "Không thể uỷ quyền cho chính mình"));
        else if (!delegateActive) e.Add(("delegateEmployeeId", "Người được uỷ quyền phải là nhân viên đang làm việc"));
        else if (!delegateHasAccount) e.Add(("delegateEmployeeId", "Người được uỷ quyền chưa có tài khoản đăng nhập"));

        if (to < from) e.Add(("toDate", "Ngày kết thúc phải từ ngày bắt đầu trở đi"));
        else if (to < today) e.Add(("toDate", "Không tạo uỷ quyền cho khoảng ngày đã qua"));
        else if (to.DayNumber - from.DayNumber + 1 > MaxDays) e.Add(("toDate", $"Uỷ quyền tối đa {MaxDays} ngày"));
        else if (existing.Where(d => Blocks(d, today)).FirstOrDefault(d => d.FromDate <= to && from <= d.ToDate) is { } clash)
            e.Add(("fromDate", $"Trùng thời gian với uỷ quyền {clash.FromDate:dd/MM/yyyy}–{clash.ToDate:dd/MM/yyyy} đang có"));

        if (note is { Length: > NoteMaxLength }) e.Add(("note", $"Ghi chú tối đa {NoteMaxLength} ký tự"));
        return e;
    }
}
