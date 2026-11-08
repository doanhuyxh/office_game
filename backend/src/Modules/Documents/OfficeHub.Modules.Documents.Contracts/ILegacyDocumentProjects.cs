namespace OfficeHub.Modules.Documents.Contracts;

/// <summary>
/// Dự án + thành viên từng lưu ở module Documents (trước khi có module Projects, 2026-11-08). Chỉ để module Projects chép sang một lần
/// (giữ nguyên Id → kho tài liệu dự án không đổi). Documents không còn ghi vào các bảng này.
/// </summary>
public interface ILegacyDocumentProjects
{
    Task<IReadOnlyList<LegacyProject>> ListAsync(CancellationToken ct = default);
}

public sealed record LegacyProjectMember(Guid EmployeeId, int Role, DateTimeOffset AddedAt);

public sealed record LegacyProject(Guid Id, string Code, string Name, string? Description, bool Closed, Guid? DepartmentId, DateTimeOffset CreatedAt,
    string? CreatedByName, IReadOnlyList<LegacyProjectMember> Members);
