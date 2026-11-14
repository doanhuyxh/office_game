using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.Modules.Documents.Domain;
using OfficeHub.Modules.Documents.Infrastructure;

namespace OfficeHub.Modules.Documents.Features;

/// <summary>
/// Cấu hình kho tài liệu (TEST-111): "Duyệt trước khi ban hành tài liệu". GET — ai đăng nhập cũng đọc (FE hiện đúng nút / ghi chú);
/// PUT — chỉ admin (<see cref="AuthPolicies.Admin"/>, HR → 403). Bảng một dòng <c>documents.settings</c>, <c>[Audited]</c> → Lịch sử thay đổi.
/// Đổi cấu hình không đụng tài liệu đã có và đơn đang chờ duyệt (handler duyệt không đọc cấu hình).
/// </summary>
internal static class SettingsEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/settings", GetAsync);
        g.MapPut("/settings", UpdateAsync).RequireAuthorization(AuthPolicies.Admin);
    }

    private static DocumentSettingsDto Dto(DocumentSettings? row) =>
        new(row?.RequirePublishApproval ?? false, row is null, row?.UpdatedAt, row?.UpdatedByName);

    private static async Task<Ok<DocumentSettingsDto>> GetAsync(DocumentsDbContext db, CancellationToken ct) =>
        TypedResults.Ok(Dto(await db.Settings.AsNoTracking().FirstOrDefaultAsync(x => x.Id == DocumentSettings.SingletonId, ct)));

    private static async Task<Ok<DocumentSettingsDto>> UpdateAsync(UpdateDocumentSettingsRequest r, ClaimsPrincipal user, DocumentsDbContext db,
        DocClock clock, CancellationToken ct)
    {
        var row = await db.Settings.FirstOrDefaultAsync(x => x.Id == DocumentSettings.SingletonId, ct);
        if (row is null) db.Settings.Add(row = new DocumentSettings());
        if (row.RequirePublishApproval != r.RequirePublishApproval || db.Entry(row).State == EntityState.Added)
        {
            row.RequirePublishApproval = r.RequirePublishApproval;
            row.UpdatedAt = clock.Now;
            row.UpdatedByName = user.FindFirstValue(ClaimNames.FullName) ?? user.Identity?.Name;
            await db.SaveChangesAsync(ct);
        }
        return TypedResults.Ok(Dto(row));
    }
}
