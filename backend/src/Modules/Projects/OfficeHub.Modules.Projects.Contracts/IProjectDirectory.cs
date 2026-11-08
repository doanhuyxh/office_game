using System.Text.Json.Serialization;

namespace OfficeHub.Modules.Projects.Contracts;

/// <summary>Vai trò trong dự án (giá trị số trùng với ProjectRole cũ của module Documents — dữ liệu chép sang giữ nguyên).</summary>
[JsonConverter(typeof(JsonStringEnumConverter<ProjectMemberRole>))]
public enum ProjectMemberRole { Member = 0, Manager = 1 }

public sealed record ProjectRef(Guid Id, string Code, string Name, bool IsActive, Guid? DepartmentId);

/// <summary>Phần công khai của module Projects: module khác (Documents — kho tài liệu dự án) tra dự án + thành viên.</summary>
public interface IProjectDirectory
{
    /// <summary>Dự án mà nhân viên là thành viên → vai trò.</summary>
    Task<IReadOnlyDictionary<Guid, ProjectMemberRole>> RolesOfAsync(Guid employeeId, CancellationToken ct = default);
    /// <summary>Mọi dự án (cả đã đóng), sắp: đang chạy trước, rồi theo tên.</summary>
    Task<IReadOnlyList<ProjectRef>> ListAsync(CancellationToken ct = default);
    Task<ProjectRef?> GetAsync(Guid projectId, CancellationToken ct = default);
    /// <summary>Bàn giao khi nghỉ việc: thêm người nhận vào mọi dự án người giao tham gia (giữ vai trò, bỏ qua nơi đã là thành viên). Trả số dự án.</summary>
    Task<int> TransferMembershipsAsync(Guid fromEmployeeId, Guid toEmployeeId, CancellationToken ct = default);
    /// <summary>Mọi yêu cầu thay đổi (CR) của dự án sở hữu hợp đồng bán này (module Sales lập phụ lục từ CR). Hợp đồng chưa gắn dự án → rỗng.</summary>
    Task<IReadOnlyList<ChangeRequestRef>> ChangeRequestsForContractAsync(Guid salesContractId, CancellationToken ct = default);
}

/// <param name="Status">"Draft" | "Sent" | "Approved" | "Rejected" | "Cancelled".</param>
/// <param name="Code">{Mã dự án}-CR{n}.</param>
public sealed record ChangeRequestRef(Guid Id, Guid ProjectId, string Code, string Title, string Status, bool Billable, decimal? EstimateManDays);
