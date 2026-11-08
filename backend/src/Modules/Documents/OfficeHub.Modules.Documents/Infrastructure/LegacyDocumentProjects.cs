using Microsoft.EntityFrameworkCore;
using OfficeHub.Modules.Documents.Contracts;

namespace OfficeHub.Modules.Documents.Infrastructure;

/// <summary>Đọc bảng dự án cũ (documents.projects / project_members) cho module Projects chép sang. Gồm cả dự án đã xoá mềm? Không — bỏ qua.</summary>
internal sealed class LegacyDocumentProjects(DocumentsDbContext db) : ILegacyDocumentProjects
{
    public async Task<IReadOnlyList<LegacyProject>> ListAsync(CancellationToken ct = default) =>
        (await db.Projects.AsNoTracking().Include(p => p.Members).ToListAsync(ct))
        .Select(p => new LegacyProject(p.Id, p.Code, p.Name, p.Description, p.Status == Domain.ProjectStatus.Closed, p.DepartmentId, p.CreatedAt, p.CreatedByName,
            [.. p.Members.Select(m => new LegacyProjectMember(m.EmployeeId, (int)m.Role, m.AddedAt))])).ToList();
}
