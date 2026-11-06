using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.Modules.Identity.Domain;
using OfficeHub.Modules.Identity.Infrastructure;

namespace OfficeHub.Modules.Identity.Features.Auth;

/// <summary>
/// Nhân vật trong văn phòng 3D: mỗi người chỉ sửa của chính mình (đọc qua <c>GET /api/auth/me</c> → <c>avatar</c>).
/// Token AI không dùng được (không có trong allowlist AccessTokenAuth). Không khoá theo vai trò (chủ dự án: HR không khoá trang phục).
/// </summary>
internal static class AvatarEndpoints
{
    public static void Map(IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/auth/avatar").WithTags("Auth").RequireAuthorization();
        g.MapPut("/", SaveAsync);
        g.MapDelete("/", ResetAsync);
    }

    /// <summary>Body = đối tượng ngoại hình (xem AvatarRules). Trả về bản đã chuẩn hoá.</summary>
    private static async Task<Results<Ok<JsonElement>, ValidationProblem>> SaveAsync(JsonElement look, ClaimsPrincipal user,
        OfficeIdentityDbContext db, TimeProvider clock, CancellationToken ct)
    {
        var json = AvatarRules.Normalize(look, AvatarCatalog.Embedded, out var errors);
        if (json is null) return TypedResults.ValidationProblem(errors.ToDictionary(e => e.Key, e => new[] { e.Value }));

        var uid = user.GetUserId()!.Value;
        var row = await db.UserAvatars.FirstOrDefaultAsync(a => a.UserId == uid, ct);
        if (row is null) db.UserAvatars.Add(row = new UserAvatar { UserId = uid });
        row.Look = json;
        row.UpdatedAt = clock.GetUtcNow();
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(JsonDocument.Parse(json).RootElement.Clone());
    }

    /// <summary>Về nhân vật mặc định chung.</summary>
    private static async Task<NoContent> ResetAsync(ClaimsPrincipal user, OfficeIdentityDbContext db, CancellationToken ct)
    {
        var uid = user.GetUserId()!.Value;
        await db.UserAvatars.Where(a => a.UserId == uid).ExecuteDeleteAsync(ct);
        return TypedResults.NoContent();
    }
}
