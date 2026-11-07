using OfficeHub.Modules.Approval.Contracts;

namespace OfficeHub.Modules.Approval.Domain;

public enum RequestStatus { Pending = 0, Approved = 1, Rejected = 2, Cancelled = 3 }

/// <summary>Waiting = chưa tới lượt; Pending = đang chờ người duyệt bước này.</summary>
public enum StepStatus { Waiting = 0, Pending = 1, Approved = 2, Rejected = 3 }

public sealed class ApprovalRequest
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public required string Type { get; set; }
    public Guid SubjectId { get; set; }
    public Guid RequesterEmployeeId { get; set; }
    public required string Title { get; set; }
    public required string Summary { get; set; }
    public RequestStatus Status { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? DecidedAt { get; set; }
    public List<ApprovalStep> Steps { get; set; } = [];
}

public sealed class ApprovalStep
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid RequestId { get; set; }
    public int Order { get; set; }
    public ApprovalStepKind Kind { get; set; }
    /// <summary>Bước Manager: Id nhân viên quản lý. Bước Hr: null (ai có vai trò hr/admin cũng duyệt được).</summary>
    public Guid? ApproverEmployeeId { get; set; }
    public StepStatus Status { get; set; }
    public Guid? DecidedByUserId { get; set; }
    public string? DecidedByName { get; set; }
    public DateTimeOffset? DecidedAt { get; set; }
    public string? Comment { get; set; }
    /// <summary>Quyết định do người được uỷ quyền thực hiện thay người quản lý này (Id nhân viên + tên lúc quyết định). Null = tự quyết.</summary>
    public Guid? OnBehalfOfEmployeeId { get; set; }
    public string? OnBehalfOfName { get; set; }
}

/// <summary>
/// Uỷ quyền duyệt: người quản lý (Delegator) cho một nhân viên khác (Delegate) duyệt thay bước Manager của mình trong [FromDate, ToDate]
/// (ngày địa phương, tính cả hai đầu). Không bắc cầu. Thu hồi = đặt RevokedAt (không xoá dòng). Quy tắc: <see cref="DelegationRules"/>.
/// </summary>
public sealed class ApprovalDelegation
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid DelegatorEmployeeId { get; set; }
    public Guid DelegateEmployeeId { get; set; }
    public DateOnly FromDate { get; set; }
    public DateOnly ToDate { get; set; }
    public string? Note { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public Guid CreatedByUserId { get; set; }
    public required string CreatedByName { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
    public Guid? RevokedByUserId { get; set; }
    public string? RevokedByName { get; set; }
}
