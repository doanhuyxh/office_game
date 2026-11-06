using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Identity.Domain;
using OfficeHub.Modules.Identity.Infrastructure;

namespace OfficeHub.Modules.Identity.Features.Auth;

/// <summary>expiresInDays ∈ {30, 90, 180, 365}; mặc định 90.</summary>
public sealed record CreateAccessTokenRequest(string Name, int? ExpiresInDays);
public sealed record AccessTokenDto(Guid Id, string Name, string Prefix, DateTimeOffset CreatedAt, DateTimeOffset ExpiresAt,
    DateTimeOffset? LastUsedAt, DateTimeOffset? RevokedAt, string Status);
/// <summary><c>Token</c> chỉ trả về MỘT lần lúc tạo.</summary>
public sealed record AccessTokenCreatedDto(AccessTokenDto AccessToken, string Token);

/// <summary>Token truy cập cá nhân cho trợ lý AI (MCP). Chỉ quản lý bằng phiên web (cookie), không bằng chính token.</summary>
internal static class AccessTokenEndpoints
{
    public static readonly int[] AllowedLifetimes = [30, 90, 180, 365];
    public const int MaxActivePerUser = 10;

    public static void Map(IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/auth/access-tokens").WithTags("Auth").RequireAuthorization();
        g.MapGet("/", ListAsync);
        g.MapPost("/", CreateAsync);
        g.MapDelete("/{id:guid}", RevokeAsync);
    }

    private static async Task<Ok<List<AccessTokenDto>>> ListAsync(ClaimsPrincipal user, OfficeIdentityDbContext db, TimeProvider clock, CancellationToken ct)
    {
        var uid = user.GetUserId()!.Value;
        var now = clock.GetUtcNow();
        var rows = await db.AccessTokens.AsNoTracking().Where(t => t.UserId == uid)
            .OrderByDescending(t => t.CreatedAt).Take(50).ToListAsync(ct);
        return TypedResults.Ok(rows.Select(t => ToDto(t, now)).ToList());
    }

    private static async Task<Results<Ok<AccessTokenCreatedDto>, ValidationProblem, ProblemHttpResult>> CreateAsync(
        CreateAccessTokenRequest req, ClaimsPrincipal user, OfficeIdentityDbContext db, TimeProvider clock, CancellationToken ct)
    {
        if (user.IsAccessToken()) return TokenNotAllowed();
        var uid = user.GetUserId()!.Value;
        var now = clock.GetUtcNow();
        var days = req.ExpiresInDays ?? 90;
        var v = new Validation()
            .Required(req.Name, "name", "Tên").MaxLength(req.Name?.Trim(), 100, "name", "Tên")
            .When(!AllowedLifetimes.Contains(days), "expiresInDays", "Thời hạn chỉ được 30, 90, 180 hoặc 365 ngày");
        if (v.Failed) return v.Problem();

        var active = await db.AccessTokens.CountAsync(t => t.UserId == uid && t.RevokedAt == null && t.ExpiresAt > now, ct);
        if (active >= MaxActivePerUser)
            return Problems.Conflict($"Tối đa {MaxActivePerUser} token đang hoạt động. Thu hồi bớt token cũ trước.");

        var raw = AccessTokens.Generate();
        var token = new AccessToken
        {
            UserId = uid,
            Name = req.Name!.Trim(),
            TokenHash = AccessTokens.Hash(raw),
            Prefix = AccessTokens.DisplayPrefix(raw),
            CreatedAt = now,
            ExpiresAt = now.AddDays(days),
        };
        db.AccessTokens.Add(token);
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(new AccessTokenCreatedDto(ToDto(token, now), raw));
    }

    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> RevokeAsync(
        Guid id, ClaimsPrincipal user, OfficeIdentityDbContext db, TimeProvider clock, CancellationToken ct)
    {
        if (user.IsAccessToken()) return TokenNotAllowed();
        var uid = user.GetUserId()!.Value;
        var token = await db.AccessTokens.FirstOrDefaultAsync(t => t.Id == id && t.UserId == uid, ct);
        if (token is null) return TypedResults.NotFound();
        if (token.RevokedAt is null)
        {
            token.RevokedAt = clock.GetUtcNow();
            await db.SaveChangesAsync(ct);
        }
        return TypedResults.NoContent();
    }

    private static ProblemHttpResult TokenNotAllowed() =>
        TypedResults.Problem("Chỉ quản lý token khi đăng nhập trên web", statusCode: StatusCodes.Status403Forbidden);

    private static AccessTokenDto ToDto(AccessToken t, DateTimeOffset now) =>
        new(t.Id, t.Name, t.Prefix, t.CreatedAt, t.ExpiresAt, t.LastUsedAt, t.RevokedAt,
            t.RevokedAt is not null ? "Revoked" : t.ExpiresAt <= now ? "Expired" : "Active");
}
