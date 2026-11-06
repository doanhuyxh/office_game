using OfficeHub.BuildingBlocks.Auditing;
namespace OfficeHub.Modules.Leave.Domain;

[Audited]
public sealed class LeaveType
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    /// <summary>annual | sick | personal_paid | unpaid</summary>
    public required string Code { get; set; }
    public required string Name { get; set; }
    public bool IsPaid { get; set; }
    /// <summary>true = trừ vào quỹ phép năm (chỉ "Phép năm").</summary>
    public bool UsesAnnualBalance { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
}

/// <summary>FullDay: cả các ngày trong khoảng. Morning/Afternoon: nửa ngày, chỉ khi StartDate == EndDate.</summary>
public enum LeavePeriod { FullDay = 0, Morning = 1, Afternoon = 2 }

public enum LeaveStatus { Pending = 0, Approved = 1, Rejected = 2, Cancelled = 3 }

public sealed class LeaveRequest
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid EmployeeId { get; set; }
    public Guid LeaveTypeId { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }
    public LeavePeriod Period { get; set; }
    /// <summary>Số ngày làm việc bị nghỉ (theo lịch ca, bỏ ngày nghỉ / ngày lễ). Nửa ngày = 0.5.</summary>
    public decimal Days { get; set; }
    public string? Reason { get; set; }
    public LeaveStatus Status { get; set; }
    public Guid? ApprovalRequestId { get; set; }
    public string? RejectReason { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? DecidedAt { get; set; }
}

/// <summary>HR điều chỉnh tay quỹ phép năm (± ngày), vd nhập số dư ban đầu khi chuyển từ Excel.</summary>
[Audited]
public sealed class LeaveAdjustment
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid EmployeeId { get; set; }
    public decimal Days { get; set; }
    public required string Reason { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public string? CreatedByName { get; set; }
}
