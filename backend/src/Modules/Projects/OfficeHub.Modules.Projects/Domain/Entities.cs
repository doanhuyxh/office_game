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
    /// <summary>"Đi lần lượt": việc chỉ tiến từng cột một, lùi phải ghi lý do (<see cref="TaskWorkflow"/>). Dự án mới: bật; dự án có trước 2026-11-10: tắt.</summary>
    public bool Sequential { get; set; }
    /// <summary>Hướng dẫn làm việc (Markdown) — quản lý dự án soạn; người và BOT đọc (MCP get_project) trước khi làm.</summary>
    public string? WorkGuide { get; set; }
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
/// <summary>
/// Giới hạn đội agent do quản trị viên đặt ở trang Hệ thống (TEST-36). Bảng một dòng (<see cref="SingletonId"/>); chưa có dòng → <see cref="AgentLimits.Default"/>.
/// </summary>
[Audited]
public sealed class AgentSettings
{
    public const int SingletonId = 1;
    public int Id { get; set; } = SingletonId;
    /// <summary>Số việc một tài khoản được tạo / ngày qua token AI.</summary>
    public int MaxBotTasksPerDay { get; set; }
    /// <summary>Số lần một việc qua tay bot liên tiếp (chưa có người thật xem) trước khi bot bị chặn trên việc đó.</summary>
    public int MaxBotStreak { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public string? UpdatedByName { get; set; }
}

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
    /// <summary>Cột trạng thái (<see cref="TaskColumn"/>) — "xong" = cột hoàn thành, ghi ở <see cref="CompletedAt"/>.</summary>
    public Guid ColumnId { get; set; }
    /// <summary>Thứ tự trong cột (số thực để chèn giữa không phải đánh lại).</summary>
    public double Rank { get; set; }
    public Guid? AssigneeEmployeeId { get; set; }
    public Guid? MilestoneId { get; set; }
    public DateOnly? DueOn { get; set; }
    public decimal? EstimateDays { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public string CreatedByName { get; set; } = "";
    /// <summary>Tạo qua token AI / MCP (nhãn BOT).</summary>
    public bool CreatedByBot { get; set; }
    /// <summary>Có giá trị ⇔ việc đang ở cột hoàn thành (<see cref="TaskColumn.IsDone"/>) — dùng cho đếm xong / quá hạn / nhắc hạn.</summary>
    public DateTimeOffset? CompletedAt { get; set; }
    public DateTimeOffset? DueRemindedAt { get; set; }
}

/// <summary>
/// Cột trạng thái công việc của một dự án (chủ dự án chốt 2026-11-11): tên / màu / thứ tự tự do. Dự án mới có 4 cột mặc định (<see cref="TaskColumnRules.Defaults"/>).
/// Người giữ chức vụ có cờ "Quản lý trạng thái công việc" sửa được ở mọi dự án họ xem được. Luật: <see cref="TaskColumnRules"/>, quy trình: <see cref="TaskWorkflow"/>.
/// </summary>
public sealed class TaskColumn
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid ProjectId { get; set; }
    public required string Name { get; set; }
    /// <summary>Thứ tự trái → phải, 0-based, liên tục.</summary>
    public int Position { get; set; }
    /// <summary>Màu dạng #rrggbb.</summary>
    public string Color { get; set; } = TaskColumnRules.DefaultColor;
    /// <summary>Cột hoàn thành: việc ở đây tính là xong (không quá hạn, không nhắc, vào % tiến độ). Dự án luôn có ≥ 1 cột hoàn thành.</summary>
    public bool IsDone { get; set; }
    /// <summary>Cần người duyệt: chỉ quản lý dự án / HR chuyển việc vào cột này, hoặc kéo lùi việc ra khỏi cột (mở lại).</summary>
    public bool ApproverOnly { get; set; }
}

[JsonConverter(typeof(JsonStringEnumConverter<TaskActivityKind>))]
public enum TaskActivityKind { Created = 0, Moved = 1, Assigned = 2, DueChanged = 3, Edited = 4, Depends = 5 }

/// <summary>Lịch sử một việc: tạo, chuyển trạng thái (kèm lý do khi lùi), đổi người, đổi hạn, sửa nội dung. Chỉ thêm. <see cref="ByBot"/> = làm qua token AI / MCP.</summary>
public sealed class TaskActivity
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TaskId { get; set; }
    public TaskActivityKind Kind { get; set; }
    /// <summary>Giá trị trước / sau (trạng thái: tên enum; người: họ tên; hạn: yyyy-MM-dd).</summary>
    public string? From { get; set; }
    public string? To { get; set; }
    public string? Note { get; set; }
    public Guid? ActorEmployeeId { get; set; }
    public string ActorName { get; set; } = "";
    public bool ByBot { get; set; }
    public DateTimeOffset At { get; set; }
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
    /// <summary>Viết qua token AI / MCP (nhãn BOT).</summary>
    public bool ByBot { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>
/// Việc <see cref="TaskId"/> chờ việc <see cref="DependsOnId"/> xong (cùng dự án, không vòng). Việc chờ xong hết → báo người làm
/// (chuông + webhook — đội agent tự chuyền việc). Bot không bắt đầu việc còn chờ (<see cref="DependencyRules"/>).
/// </summary>
public sealed class TaskDependency
{
    public Guid TaskId { get; set; }
    public Guid DependsOnId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
