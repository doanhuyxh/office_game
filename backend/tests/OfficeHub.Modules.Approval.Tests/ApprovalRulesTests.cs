using OfficeHub.Modules.Approval.Contracts;
using OfficeHub.Modules.Approval.Domain;

namespace OfficeHub.Modules.Approval.Tests;

public class ApprovalRulesTests
{
    private static readonly Guid Requester = Guid.NewGuid(), Manager = Guid.NewGuid(), Delegate = Guid.NewGuid(), Other = Guid.NewGuid();
    private static readonly HashSet<Guid> None = [];

    /// <summary>Đơn [Manager, Hr]; managerStepDone = bước quản lý đã duyệt → đang ở bước HR.</summary>
    private static ApprovalRequest Request(bool managerStepDone = false, RequestStatus status = RequestStatus.Pending) => new()
    {
        Type = ApprovalTypes.Leave, Title = "t", Summary = "s", RequesterEmployeeId = Requester, Status = status,
        Steps =
        [
            new() { Order = 0, Kind = ApprovalStepKind.Manager, ApproverEmployeeId = Manager, Status = managerStepDone ? StepStatus.Approved : StepStatus.Pending },
            new() { Order = 1, Kind = ApprovalStepKind.Hr, Status = managerStepDone ? StepStatus.Pending : StepStatus.Waiting },
        ],
    };

    private static DeciderContext Ctx(Guid? emp, bool hr = false, bool admin = false, params Guid[] delegatedBy) => new(emp, hr, admin, delegatedBy.ToHashSet());

    [Fact]
    public void Manager_step_approver_admin_and_active_delegate()
    {
        var r = Request();
        Assert.Equal(DecisionRight.Approver, ApprovalRules.Right(r, Ctx(Manager)));
        Assert.Equal(DecisionRight.Delegate, ApprovalRules.Right(r, Ctx(Delegate, delegatedBy: Manager)));
        Assert.Equal(DecisionRight.Admin, ApprovalRules.Right(r, Ctx(null, hr: true, admin: true)));
        Assert.Equal(DecisionRight.None, ApprovalRules.Right(r, Ctx(Delegate)));             // hết hạn / bị thu hồi = không còn trong DelegatedBy
        Assert.Equal(DecisionRight.None, ApprovalRules.Right(r, Ctx(Other, hr: true)));      // HR không duyệt thay bước quản lý
    }

    [Fact]
    public void Delegation_is_not_transitive()
    {
        // Manager → Delegate, Delegate → Other: Other chỉ có DelegatedBy = {Delegate}, không phải {Manager}.
        Assert.False(ApprovalRules.CanDecide(Request(), Ctx(Other, delegatedBy: Delegate)));
    }

    [Fact]
    public void No_self_approval_even_as_delegate_or_hr()
    {
        var r = Request();
        Assert.False(ApprovalRules.CanDecide(r, Ctx(Requester, delegatedBy: Manager)));
        Assert.False(ApprovalRules.CanDecide(r, Ctx(Requester, hr: true, admin: true)));
        var atHr = Request(managerStepDone: true);
        Assert.False(ApprovalRules.CanDecide(atHr, Ctx(Requester, hr: true)));
        Assert.True(ApprovalRules.CanDecide(atHr, Ctx(Other, hr: true)));
    }

    [Fact]
    public void Finance_step_needs_finance_approve_permission_not_hr_or_admin()
    {
        var r = new ApprovalRequest
        {
            Type = ApprovalTypes.ExpenseRequest, Title = "t", Summary = "s", RequesterEmployeeId = Requester, Status = RequestStatus.Pending,
            Steps = [new() { Order = 0, Kind = ApprovalStepKind.Finance, Status = StepStatus.Pending }],
        };
        Assert.Equal(DecisionRight.Finance, ApprovalRules.Right(r, new DeciderContext(Other, false, false, None, IsFinanceApprover: true)));
        Assert.Equal(DecisionRight.None, ApprovalRules.Right(r, Ctx(Other, hr: true, admin: true)));   // HR / admin không tự duyệt tiền
        Assert.Equal(DecisionRight.None, ApprovalRules.Right(r, new DeciderContext(Manager, false, false, None)));
        // Kế toán trưởng vừa có Ghi sổ vừa có Duyệt chi vẫn không tự duyệt khoản chi của chính mình.
        Assert.Equal(DecisionRight.None, ApprovalRules.Right(r, new DeciderContext(Requester, false, false, None, IsFinanceApprover: true)));
    }

    [Fact]
    public void Hr_step_unaffected_by_delegation()
    {
        var r = Request(managerStepDone: true);
        Assert.Equal(DecisionRight.None, ApprovalRules.Right(r, Ctx(Delegate, delegatedBy: Manager)));
        Assert.Equal(DecisionRight.None, ApprovalRules.Right(r, Ctx(Manager)));
        Assert.Equal(DecisionRight.Hr, ApprovalRules.Right(r, Ctx(Other, hr: true)));
    }

    [Fact]
    public void Decided_requests_have_no_decider()
    {
        Assert.False(ApprovalRules.CanDecide(Request(status: RequestStatus.Approved), Ctx(Manager)));
        Assert.False(ApprovalRules.CanDecide(Request(status: RequestStatus.Cancelled), Ctx(null, hr: true, admin: true)));
        Assert.False(ApprovalRules.CanDecide(Request(), new DeciderContext(Other, false, false, None)));
    }
}

public class DelegationRulesTests
{
    private static readonly Guid Me = Guid.NewGuid(), Delegate = Guid.NewGuid();
    private static readonly DateOnly Today = new(2026, 11, 7);
    private static DateOnly D(int days) => Today.AddDays(days);

    private static ApprovalDelegation Existing(int from, int to, bool revoked = false) => new()
    {
        DelegatorEmployeeId = Me, DelegateEmployeeId = Guid.NewGuid(), FromDate = D(from), ToDate = D(to), CreatedByName = "x",
        RevokedAt = revoked ? DateTimeOffset.UnixEpoch : null,
    };

    private static List<(string Field, string Message)> Validate(int from, int to, Guid? delegateId = null, bool active = true, bool account = true,
        params ApprovalDelegation[] existing) =>
        DelegationRules.Validate(Me, delegateId ?? Delegate, D(from), D(to), Today, active, account, existing);

    [Fact]
    public void Valid_range_passes() => Assert.Empty(Validate(0, 13));

    [Fact]
    public void Self_inactive_or_no_account_rejected()
    {
        Assert.Contains(Validate(0, 1, delegateId: Me), e => e.Message == "Không thể uỷ quyền cho chính mình");
        Assert.Contains(Validate(0, 1, active: false), e => e.Message.Contains("đang làm việc"));
        Assert.Contains(Validate(0, 1, account: false), e => e.Message.Contains("tài khoản"));
        Assert.Contains(Validate(0, 1, delegateId: Guid.Empty), e => e.Field == "delegateEmployeeId");
    }

    [Fact]
    public void Dates_order_past_and_max_90_days()
    {
        Assert.Contains(Validate(3, 2), e => e.Message.Contains("từ ngày bắt đầu"));
        Assert.Contains(Validate(-5, -1), e => e.Message.Contains("đã qua"));
        Assert.Empty(Validate(-5, 0));                       // còn hiệu lực hôm nay
        Assert.Empty(Validate(0, 89));                       // đúng 90 ngày tính cả hai đầu
        Assert.Contains(Validate(0, 90), e => e.Message.Contains("90 ngày"));
    }

    [Fact]
    public void Overlap_with_current_or_upcoming_delegation_rejected()
    {
        Assert.Contains(Validate(5, 10, existing: Existing(0, 5)), e => e.Field == "fromDate");      // chạm ngày cuối
        Assert.Contains(Validate(0, 30, existing: Existing(10, 12)), e => e.Field == "fromDate");     // bao trọn
        Assert.Empty(Validate(6, 10, existing: Existing(0, 5)));                                      // nối tiếp
        Assert.Empty(Validate(0, 10, existing: Existing(0, 5, revoked: true)));                       // đã thu hồi
        Assert.Empty(Validate(-3, 2, existing: Existing(-10, -1)));                                   // đã hết hạn
    }

    [Theory]
    [InlineData(1, 5, false, DelegationStatus.Upcoming)]
    [InlineData(0, 0, false, DelegationStatus.Active)]
    [InlineData(-5, 0, false, DelegationStatus.Active)]
    [InlineData(-5, -1, false, DelegationStatus.Expired)]
    [InlineData(0, 5, true, DelegationStatus.Revoked)]
    public void Status_by_today(int from, int to, bool revoked, DelegationStatus expected)
    {
        var d = Existing(from, to, revoked);
        Assert.Equal(expected, DelegationRules.Status(d, Today));
        Assert.Equal(expected == DelegationStatus.Active, DelegationRules.IsActiveOn(d, Today));
    }
}
