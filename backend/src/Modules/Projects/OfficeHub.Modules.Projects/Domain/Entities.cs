using System.Text.Json.Serialization;
using OfficeHub.BuildingBlocks.Auditing;
using OfficeHub.Modules.Projects.Contracts;

namespace OfficeHub.Modules.Projects.Domain;

[JsonConverter(typeof(JsonStringEnumConverter<ProjectStatus>))]
public enum ProjectStatus { Active = 0, Closed = 1 }

/// <summary>Nội bộ (không có khách) / làm cho khách (gắn hợp đồng bán).</summary>
[JsonConverter(typeof(JsonStringEnumConverter<ProjectKind>))]
public enum ProjectKind { Internal = 0, Client = 1 }

[JsonConverter(typeof(JsonStringEnumConverter<MilestoneStatus>))]
public enum MilestoneStatus { Open = 0, Accepted = 1 }

[JsonConverter(typeof(JsonStringEnumConverter<TaskState>))]
public enum TaskState { Todo = 0, Doing = 1, Review = 2, Done = 3 }

/// <summary>Nháp → Đã gửi khách → Khách đồng ý / Từ chối; huỷ khi chưa quyết. Xem <see cref="ChangeRequestRules.CanMove"/>.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<ChangeRequestStatus>))]
public enum ChangeRequestStatus { Draft = 0, Sent = 1, Approved = 2, Rejected = 3, Cancelled = 4 }

/// <summary>
/// Dự án (module Projects sở hữu từ 2026-11-08; trước đó nằm ở module Documents — Id giữ nguyên nên kho tài liệu dự án không đổi).
/// Không xoá — chỉ đóng. Không lưu số tiền (quản lý dự án chỉ xem ngày công).
/// </summary>
[Audited]
public sealed class Project
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public required string Code { get; set; }
    public required string Name { get; set; }
    public string? Description { get; set; }
    public ProjectKind Kind { get; set; }
    public ProjectStatus Status { get; set; }
    public Guid? DepartmentId { get; set; }
    /// <summary>Mảng kinh doanh (module Finance) — để báo cáo lãi / lỗ theo mảng.</summary>
    public Guid? BusinessLineId { get; set; }
    public DateOnly? StartOn { get; set; }
    public DateOnly? EndOn { get; set; }
    public DateOnly? ClosedOn { get; set; }
    /// <summary>Ngân sách ngày công (người × ngày).</summary>
    public decimal? BudgetManDays { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public string? CreatedByName { get; set; }
    public DateTimeOffset? UpdatedAt { get; set; }
    public List<ProjectMember> Members { get; set; } = [];
}

public sealed class ProjectMember
{
    public Guid ProjectId { get; set; }
    public Guid EmployeeId { get; set; }
    public ProjectMemberRole Role { get; set; }
    public DateTimeOffset AddedAt { get; set; }
}

/// <summary>
/// Hợp đồng bán (module Sales) của dự án. Chủ dự án chốt 2026-11-08: một dự án có nhiều hợp đồng, một hợp đồng chỉ thuộc một dự án (unique ContractId).
/// Mốc nghiệm thu chỉ gắn được đợt thu của các hợp đồng này.
/// </summary>
public sealed class ProjectContract
{
    public Guid ProjectId { get; set; }
    public Guid ContractId { get; set; }
    public DateTimeOffset LinkedAt { get; set; }
}

/// <summary>
/// % thời gian một thành viên dành cho dự án trong một tháng (quản lý dự án đặt). Không có → mặc định (<see cref="EffortRules.DefaultPercent"/>).
/// Tháng đã chốt (<see cref="AllocationFreeze"/>) → chỉ dòng ở đây được tính (job ghi % mặc định thành dòng thật khi chốt).
/// </summary>
public sealed class Allocation
{
    public Guid ProjectId { get; set; }
    public Guid EmployeeId { get; set; }
    /// <summary>Ngày 1 của tháng.</summary>
    public DateOnly Month { get; set; }
    /// <summary>0–100, 2 chữ số thập phân (mặc định chia đều có thể lẻ, vd 33,33).</summary>
    public decimal Percent { get; set; }
}

/// <summary>
/// Tháng đã chốt phân bổ (<c>AllocationFreezeJob</c>, đầu tháng sau): % mặc định đã ghi thành dòng <see cref="Allocation"/> → thêm / bỏ thành viên về sau
/// không làm đổi ngày công / chi phí của tháng này. Sửa % tháng đã chốt: chỉ HR hoặc quyền Quản trị tài chính.
/// </summary>
public sealed class AllocationFreeze
{
    /// <summary>Ngày 1 của tháng.</summary>
    public DateOnly Month { get; set; }
    public DateTimeOffset FrozenAt { get; set; }
}

/// <summary>Mốc nghiệm thu. Gắn đợt thu (module Sales) → nghiệm thu xong thì đợt thu đến hạn.</summary>
public sealed class Milestone
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid ProjectId { get; set; }
    public int Order { get; set; }
    public required string Title { get; set; }
    public DateOnly? DueOn { get; set; }
    public MilestoneStatus Status { get; set; }
    public Guid? InstallmentId { get; set; }
    public DateOnly? AcceptedOn { get; set; }
    public string? AcceptedByName { get; set; }
    public string? Note { get; set; }
}

public sealed class TaskItem
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid ProjectId { get; set; }
    /// <summary>Số thứ tự trong dự án → mã {Mã dự án}-{n}.</summary>
    public int Number { get; set; }
    public required string Title { get; set; }
    /// <summary>Nội dung Markdown (hiển thị ở FE bằng react-markdown, không render HTML thô).</summary>
    public string? Description { get; set; }
    /// <summary>Link ảnh / video minh hoạ (http/https, tối đa <see cref="TaskRules.MaxMediaLinks"/>) — FE tự nhận dạng ảnh, video, YouTube.</summary>
    public List<string> MediaLinks { get; set; } = [];
    public TaskState State { get; set; }
    /// <summary>Thứ tự trong cột (số thực để chèn giữa không phải đánh lại).</summary>
    public double Rank { get; set; }
    public Guid? AssigneeEmployeeId { get; set; }
    public Guid? MilestoneId { get; set; }
    public DateOnly? DueOn { get; set; }
    public decimal? EstimateDays { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public string CreatedByName { get; set; } = "";
    public DateTimeOffset? CompletedAt { get; set; }
    public DateTimeOffset? DueRemindedAt { get; set; }
}

/// <summary>
/// Yêu cầu thay đổi (CR, giai đoạn 2b-2): phát sinh ngoài phạm vi. Quản lý dự án ghi ngày công ước tính (không nhập tiền).
/// Khách đồng ý → cộng ngày công vào ngân sách (nếu dự án có ngân sách); có tính tiền → báo người phụ trách hợp đồng + kế toán lập phụ lục (module Sales).
/// </summary>
[Audited]
public sealed class ChangeRequest
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid ProjectId { get; set; }
    /// <summary>Số thứ tự trong dự án → mã {Mã dự án}-CR{n}.</summary>
    public int Number { get; set; }
    public required string Title { get; set; }
    public string? Description { get; set; }
    public decimal? EstimateManDays { get; set; }
    public bool Billable { get; set; }
    public ChangeRequestStatus Status { get; set; }
    public DateOnly? SentOn { get; set; }
    public DateOnly? DecidedOn { get; set; }
    public string? DecidedByName { get; set; }
    public string? DecisionNote { get; set; }
    /// <summary>Số ngày công đã cộng vào ngân sách khi khách đồng ý (null = không cộng — dự án không có ngân sách / CR không ước tính).</summary>
    public decimal? BudgetAddedManDays { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public string CreatedByName { get; set; } = "";
    public DateTimeOffset? UpdatedAt { get; set; }
}

public sealed class TaskComment
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TaskId { get; set; }
    public required string Content { get; set; }
    public Guid? AuthorEmployeeId { get; set; }
    public string AuthorName { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
}
