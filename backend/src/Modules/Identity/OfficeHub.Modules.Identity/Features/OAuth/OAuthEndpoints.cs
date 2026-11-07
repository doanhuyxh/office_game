using System.Security.Claims;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.Modules.Identity.Domain;
using OfficeHub.Modules.Identity.Infrastructure;

namespace OfficeHub.Modules.Identity.Features.OAuth;

public sealed record RegisterClientRequest(
    [property: JsonPropertyName("client_name")] string? ClientName,
    [property: JsonPropertyName("redirect_uris")] string[]? RedirectUris,
    [property: JsonPropertyName("token_endpoint_auth_method")] string? TokenEndpointAuthMethod);

/// <summary>Tham số trang đồng ý (giữ nguyên tên OAuth: snake_case trong query lẫn JSON).</summary>
public sealed record AuthorizeParams
{
    [FromQuery(Name = "response_type"), JsonPropertyName("response_type")] public string? ResponseType { get; init; }
    [FromQuery(Name = "client_id"), JsonPropertyName("client_id")] public string? ClientId { get; init; }
    [FromQuery(Name = "redirect_uri"), JsonPropertyName("redirect_uri")] public string? RedirectUri { get; init; }
    [FromQuery(Name = "code_challenge"), JsonPropertyName("code_challenge")] public string? CodeChallenge { get; init; }
    [FromQuery(Name = "code_challenge_method"), JsonPropertyName("code_challenge_method")] public string? CodeChallengeMethod { get; init; }
    [FromQuery(Name = "scope"), JsonPropertyName("scope")] public string? Scope { get; init; }
    [FromQuery(Name = "state"), JsonPropertyName("state")] public string? State { get; init; }
    [FromQuery(Name = "resource"), JsonPropertyName("resource")] public string? Resource { get; init; }
}

public sealed record AuthorizeDecision : AuthorizeParamsBody
{
    [JsonPropertyName("approve")] public bool Approve { get; init; }
}

/// <summary>Body JSON của POST /authorize (cùng trường với query của GET).</summary>
public record AuthorizeParamsBody
{
    [JsonPropertyName("response_type")] public string? ResponseType { get; init; }
    [JsonPropertyName("client_id")] public string? ClientId { get; init; }
    [JsonPropertyName("redirect_uri")] public string? RedirectUri { get; init; }
    [JsonPropertyName("code_challenge")] public string? CodeChallenge { get; init; }
    [JsonPropertyName("code_challenge_method")] public string? CodeChallengeMethod { get; init; }
    [JsonPropertyName("scope")] public string? Scope { get; init; }
    [JsonPropertyName("state")] public string? State { get; init; }
    [JsonPropertyName("resource")] public string? Resource { get; init; }

    public AuthorizeParams ToParams() => new()
    {
        ResponseType = ResponseType, ClientId = ClientId, RedirectUri = RedirectUri, CodeChallenge = CodeChallenge,
        CodeChallengeMethod = CodeChallengeMethod, Scope = Scope, State = State, Resource = Resource,
    };
}

/// <summary>Lỗi trang đồng ý. <c>RedirectTo</c> có giá trị = trả lỗi về ứng dụng; null = chỉ hiện cho người dùng (client / redirect sai).</summary>
public sealed record AuthorizeErrorDto(string Error, string Message, string? RedirectTo);
public sealed record AuthorizeInfoDto(string ClientId, string ClientName, string RedirectUri, string RedirectHost, DateTimeOffset ClientCreatedAt);
public sealed record AuthorizeResultDto(string RedirectTo);
public sealed record GrantDto(Guid Id, string ClientName, DateTimeOffset CreatedAt, DateTimeOffset? LastUsedAt, DateTimeOffset ExpiresAt,
    DateTimeOffset? RevokedAt, string Status);

/// <summary>
/// OAuth 2.1 tối thiểu cho trợ lý AI (MCP Authorization): DCR (RFC 7591) → trang đồng ý (FE /oauth/authorize, cần đăng nhập web)
/// → mã + PKCE S256 → access token ngắn hạn (dòng access_tokens, cùng định dạng ohk_ như token cá nhân) + refresh token xoay vòng.
/// Access token đi qua đúng AccessTokenHandler + danh sách route cho phép như token cá nhân.
/// </summary>
internal static class OAuthEndpoints
{
    public const string CorsPolicy = "oauth-public";
    private const int MaxClients = 2000;

    public static void Map(IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/oauth").WithTags("OAuth");

        // Ẩn danh theo chuẩn, gọi từ máy chủ / ứng dụng của bên AI → CORS mở, giới hạn theo IP.
        g.MapPost("/register", RegisterAsync).AllowAnonymous().RequireCors(CorsPolicy).RequireRateLimiting(RateLimits.OAuth);
        g.MapPost("/token", TokenAsync).AllowAnonymous().RequireCors(CorsPolicy).RequireRateLimiting(RateLimits.OAuth).DisableAntiforgery();
        g.MapPost("/revoke", RevokeTokenAsync).AllowAnonymous().RequireCors(CorsPolicy).RequireRateLimiting(RateLimits.OAuth).DisableAntiforgery();

        // Trang đồng ý (FE) — cần phiên web (cookie), không CORS.
        g.MapGet("/authorize", AuthorizeInfoAsync).RequireAuthorization();
        g.MapPost("/authorize", AuthorizeAsync).RequireAuthorization();

        // Ứng dụng đã kết nối của tôi.
        g.MapGet("/grants", ListGrantsAsync).RequireAuthorization();
        g.MapDelete("/grants/{id:guid}", RevokeGrantAsync).RequireAuthorization();
    }

    // ---------------- Đăng ký ứng dụng (RFC 7591) ----------------

    private static async Task<IResult> RegisterAsync(RegisterClientRequest req, OfficeIdentityDbContext db, TimeProvider clock, CancellationToken ct)
    {
        var uris = (req.RedirectUris ?? []).Select(u => u?.Trim() ?? "").Distinct().ToList();
        if (uris.Count == 0 || uris.Count > OAuthRules.MaxRedirectUris)
            return Error("invalid_redirect_uri", $"Cần 1–{OAuthRules.MaxRedirectUris} redirect_uris");
        if (uris.FirstOrDefault(u => !OAuthRules.IsValidRedirectUri(u)) is { } bad)
            return Error("invalid_redirect_uri", $"redirect_uri không hợp lệ: {bad}");

        var now = clock.GetUtcNow();
        // Dọn ứng dụng đăng ký mà chưa từng được ai cho phép sau 7 ngày (DCR là ẩn danh → chống rác).
        await db.OAuthClients.Where(c => c.LastUsedAt == null && c.CreatedAt < now.AddDays(-7)).ExecuteDeleteAsync(ct);
        if (await db.OAuthClients.CountAsync(ct) >= MaxClients)
            return Error("temporarily_unavailable", "Quá nhiều ứng dụng đã đăng ký, thử lại sau", StatusCodes.Status503ServiceUnavailable);

        var name = string.IsNullOrWhiteSpace(req.ClientName) ? "Ứng dụng AI" : req.ClientName.Trim();
        var client = new OAuthClient
        {
            ClientId = OAuthRules.NewSecret("ohc_")[..36],
            Name = name.Length > 100 ? name[..100] : name,
            RedirectUris = uris,
            CreatedAt = now,
        };
        db.OAuthClients.Add(client);
        await db.SaveChangesAsync(ct);

        // Chỉ hỗ trợ client công khai: dù client xin client_secret_* vẫn trả về "none" (RFC 7591 §3.2.1 cho phép server ghi đè).
        return Results.Json(new Dictionary<string, object>
        {
            ["client_id"] = client.ClientId,
            ["client_id_issued_at"] = now.ToUnixTimeSeconds(),
            ["client_name"] = client.Name,
            ["redirect_uris"] = client.RedirectUris,
            ["grant_types"] = new[] { "authorization_code", "refresh_token" },
            ["response_types"] = new[] { "code" },
            ["token_endpoint_auth_method"] = "none",
            ["scope"] = OAuthMetadata.Scope,
        }, statusCode: StatusCodes.Status201Created);
    }

    // ---------------- Trang đồng ý ----------------

    private sealed record Validated(OAuthClient Client, string RedirectUri);

    private static async Task<(Validated? Ok, AuthorizeErrorDto? Error)> ValidateAsync(AuthorizeParams p, OfficeIdentityDbContext db,
        string baseUrl, CancellationToken ct)
    {
        var client = string.IsNullOrWhiteSpace(p.ClientId) ? null
            : await db.OAuthClients.AsNoTracking().FirstOrDefaultAsync(c => c.ClientId == p.ClientId, ct);
        if (client is null)
            return (null, new("invalid_client", "Ứng dụng không tồn tại hoặc đã bị xoá. Hãy kết nối lại từ ứng dụng AI.", null));
        if (string.IsNullOrWhiteSpace(p.RedirectUri) || !OAuthRules.RedirectMatches(client.RedirectUris, p.RedirectUri))
            return (null, new("invalid_request", "Địa chỉ chuyển hướng không khớp với ứng dụng đã đăng ký.", null));

        AuthorizeErrorDto Back(string error, string message) =>
            new(error, message, OAuthRules.AppendQuery(p.RedirectUri, [new("error", error), new("error_description", message), new("state", p.State)]));

        if (p.ResponseType != "code") return (null, Back("unsupported_response_type", "Chỉ hỗ trợ response_type=code"));
        if (p.CodeChallengeMethod != "S256" || !OAuthRules.IsValidChallenge(p.CodeChallenge))
            return (null, Back("invalid_request", "Bắt buộc PKCE (code_challenge_method=S256)"));
        if (!OAuthRules.ResourceAllowed(p.Resource, baseUrl))
            return (null, Back("invalid_target", "resource không thuộc máy chủ này"));
        return (new Validated(client, p.RedirectUri), null);
    }

    private static async Task<Results<Ok<AuthorizeInfoDto>, BadRequest<AuthorizeErrorDto>, ProblemHttpResult>> AuthorizeInfoAsync(
        [AsParameters] AuthorizeParams p, ClaimsPrincipal user, OfficeIdentityDbContext db, IOptions<AppSettings> app, CancellationToken ct)
    {
        if (user.IsAccessToken()) return CookieOnly();
        var (ok, error) = await ValidateAsync(p, db, app.Value.BaseUrl, ct);
        if (ok is null) return TypedResults.BadRequest(error!);
        var host = Uri.TryCreate(ok.RedirectUri, UriKind.Absolute, out var u) ? (string.IsNullOrEmpty(u.Host) ? u.Scheme + "://" : u.Host) : ok.RedirectUri;
        return TypedResults.Ok(new AuthorizeInfoDto(ok.Client.ClientId, ok.Client.Name, ok.RedirectUri, host, ok.Client.CreatedAt));
    }

    private static async Task<Results<Ok<AuthorizeResultDto>, BadRequest<AuthorizeErrorDto>, ProblemHttpResult>> AuthorizeAsync(
        AuthorizeDecision req, ClaimsPrincipal user, OfficeIdentityDbContext db, IOptions<AppSettings> app, TimeProvider clock,
        ILogger<OAuthClient> log, CancellationToken ct)
    {
        if (user.IsAccessToken()) return CookieOnly();
        if (user.HasClaim(ClaimNames.MustChangePassword, "true"))
            return TypedResults.Problem("Đổi mật khẩu trước khi kết nối ứng dụng", statusCode: StatusCodes.Status403Forbidden);
        var p = req.ToParams();
        var (ok, error) = await ValidateAsync(p, db, app.Value.BaseUrl, ct);
        if (ok is null) return TypedResults.BadRequest(error!);

        if (!req.Approve)
            return TypedResults.Ok(new AuthorizeResultDto(OAuthRules.AppendQuery(ok.RedirectUri,
                [new("error", "access_denied"), new("error_description", "Người dùng từ chối"), new("state", p.State)])));

        var raw = OAuthRules.NewSecret("");
        db.OAuthCodes.Add(new OAuthCode
        {
            CodeHash = AccessTokens.Hash(raw),
            ClientId = ok.Client.Id,
            UserId = user.GetUserId()!.Value,
            RedirectUri = ok.RedirectUri,
            CodeChallenge = p.CodeChallenge!,
            Scope = OAuthMetadata.Scope,
            Resource = p.Resource,
            ExpiresAt = clock.GetUtcNow() + OAuthRules.CodeLifetime,
        });
        await db.SaveChangesAsync(ct);
        log.LogInformation("OAuth: {User} cho phép ứng dụng {Client} ({ClientId})", user.Identity?.Name, ok.Client.Name, ok.Client.ClientId);
        return TypedResults.Ok(new AuthorizeResultDto(OAuthRules.AppendQuery(ok.RedirectUri, [new("code", raw), new("state", p.State)])));
    }

    // ---------------- Cấp token ----------------

    private static async Task<IResult> TokenAsync(HttpContext http, OfficeIdentityDbContext db, UserManager<AppUser> users,
        IOptions<AppSettings> app, IOptionsMonitor<AccessTokenSettings> settings, TimeProvider clock, ILogger<OAuthClient> log, CancellationToken ct)
    {
        if (!http.Request.HasFormContentType) return Error("invalid_request", "Cần Content-Type application/x-www-form-urlencoded");
        if (!settings.CurrentValue.Enabled) return Error("access_denied", "Kết nối AI đang tạm tắt cho toàn công ty");
        var form = await http.Request.ReadFormAsync(ct);
        var clientId = form["client_id"].ToString();
        var client = string.IsNullOrEmpty(clientId) ? null : await db.OAuthClients.FirstOrDefaultAsync(c => c.ClientId == clientId, ct);
        if (client is null) return Error("invalid_client", "client_id không hợp lệ", StatusCodes.Status401Unauthorized);
        var now = clock.GetUtcNow();

        switch (form["grant_type"].ToString())
        {
            case "authorization_code":
            {
                var codeHash = AccessTokens.Hash(form["code"].ToString());
                var code = await db.OAuthCodes.FirstOrDefaultAsync(c => c.CodeHash == codeHash, ct);
                if (code is null || code.ClientId != client.Id) return Error("invalid_grant", "Mã ủy quyền không hợp lệ");
                if (code.ConsumedAt is not null)
                {
                    // Mã bị dùng lại → có thể bị đánh cắp: thu hồi grant đã cấp từ mã này.
                    if (code.GrantId is { } gid)
                        await db.OAuthGrants.Where(g => g.Id == gid && g.RevokedAt == null).ExecuteUpdateAsync(s => s.SetProperty(g => g.RevokedAt, now), ct);
                    log.LogWarning("OAuth: mã ủy quyền bị dùng lại (client {ClientId}) → thu hồi grant", client.ClientId);
                    return Error("invalid_grant", "Mã ủy quyền đã được dùng");
                }
                if (code.ExpiresAt <= now) return Error("invalid_grant", "Mã ủy quyền đã hết hạn");
                if (form["redirect_uri"].ToString() != code.RedirectUri) return Error("invalid_grant", "redirect_uri không khớp");
                if (!OAuthRules.VerifyPkce(form["code_verifier"].ToString(), code.CodeChallenge)) return Error("invalid_grant", "code_verifier sai");
                code.ConsumedAt = now;

                if (await UserProblemAsync(code.UserId, users) is { } userErr) { await db.SaveChangesAsync(ct); return userErr; }

                var refresh = OAuthRules.NewSecret("ohr_");
                var grant = new OAuthGrant
                {
                    UserId = code.UserId,
                    ClientId = client.Id,
                    ClientName = client.Name,
                    Scope = code.Scope,
                    CreatedAt = now,
                    LastUsedAt = now,
                    RefreshHash = AccessTokens.Hash(refresh),
                    RefreshExpiresAt = OAuthRules.NextRefreshExpiry(now, now),
                };
                db.OAuthGrants.Add(grant);
                code.GrantId = grant.Id;
                client.LastUsedAt = now;
                var access = IssueAccess(db, grant, now);
                await db.OAuthCodes.Where(c => c.ExpiresAt < now.AddDays(-1)).ExecuteDeleteAsync(ct);
                await db.SaveChangesAsync(ct);
                return TokenResponse(http, access, refresh);
            }
            case "refresh_token":
            {
                var hash = AccessTokens.Hash(form["refresh_token"].ToString());
                var grant = await db.OAuthGrants.FirstOrDefaultAsync(g => g.RefreshHash == hash, ct);
                if (grant is null)
                {
                    var reused = await db.OAuthGrants.FirstOrDefaultAsync(g => g.PreviousRefreshHash == hash, ct);
                    if (reused is { RevokedAt: null })
                    {
                        reused.RevokedAt = now; // refresh token cũ bị dùng lại → bị lộ: chặn cả grant
                        await db.SaveChangesAsync(ct);
                        log.LogWarning("OAuth: refresh token cũ bị dùng lại (grant {Grant}) → thu hồi", reused.Id);
                    }
                    return Error("invalid_grant", "Refresh token không hợp lệ");
                }
                if (grant.ClientId != client.Id) return Error("invalid_grant", "Refresh token không thuộc ứng dụng này");
                if (!grant.IsActive(now)) return Error("invalid_grant", "Quyền truy cập đã bị thu hồi hoặc hết hạn, hãy kết nối lại");
                if (await UserProblemAsync(grant.UserId, users) is { } userErr) return userErr;

                var refresh = OAuthRules.NewSecret("ohr_");
                grant.PreviousRefreshHash = grant.RefreshHash;
                grant.RefreshHash = AccessTokens.Hash(refresh);
                grant.RefreshExpiresAt = OAuthRules.NextRefreshExpiry(now, grant.CreatedAt);
                grant.LastUsedAt = now;
                client.LastUsedAt = now;
                await db.AccessTokens.Where(t => t.GrantId == grant.Id && t.ExpiresAt < now).ExecuteDeleteAsync(ct);
                var access = IssueAccess(db, grant, now);
                await db.SaveChangesAsync(ct);
                return TokenResponse(http, access, refresh);
            }
            default:
                return Error("unsupported_grant_type", "Chỉ hỗ trợ authorization_code và refresh_token");
        }
    }

    private static string IssueAccess(OfficeIdentityDbContext db, OAuthGrant grant, DateTimeOffset now)
    {
        var raw = AccessTokens.Generate();
        db.AccessTokens.Add(new AccessToken
        {
            UserId = grant.UserId,
            GrantId = grant.Id,
            Name = grant.ClientName,
            TokenHash = AccessTokens.Hash(raw),
            Prefix = AccessTokens.DisplayPrefix(raw),
            CreatedAt = now,
            ExpiresAt = now + OAuthRules.AccessTokenLifetime,
        });
        return raw;
    }

    private static IResult TokenResponse(HttpContext http, string access, string refresh)
    {
        http.Response.Headers.CacheControl = "no-store";
        http.Response.Headers.Pragma = "no-cache";
        return Results.Json(new Dictionary<string, object>
        {
            ["access_token"] = access,
            ["token_type"] = "Bearer",
            ["expires_in"] = (int)OAuthRules.AccessTokenLifetime.TotalSeconds,
            ["refresh_token"] = refresh,
            ["scope"] = OAuthMetadata.Scope,
        });
    }

    private static async Task<IResult?> UserProblemAsync(Guid userId, UserManager<AppUser> users)
    {
        var user = await users.FindByIdAsync(userId.ToString());
        if (user is not { IsActive: true } || await users.IsLockedOutAsync(user)) return Error("invalid_grant", "Tài khoản đã bị khoá");
        if (user.MustChangePassword) return Error("invalid_grant", "Tài khoản cần đổi mật khẩu trên web trước");
        if (!user.TwoFactorEnabled && TwoFactorPolicy.IsRequiredFor(await users.GetRolesAsync(user)))
            return Error("invalid_grant", TwoFactorPolicy.TokenBlockedMessage);
        return null;
    }

    /// <summary>RFC 7009: luôn 200 kể cả token không tồn tại.</summary>
    private static async Task<IResult> RevokeTokenAsync(HttpContext http, OfficeIdentityDbContext db, TimeProvider clock, CancellationToken ct)
    {
        if (!http.Request.HasFormContentType) return Error("invalid_request", "Cần Content-Type application/x-www-form-urlencoded");
        var form = await http.Request.ReadFormAsync(ct);
        var hash = AccessTokens.Hash(form["token"].ToString());
        var now = clock.GetUtcNow();
        var revokeClientId = form["client_id"].ToString();
        var client = await db.OAuthClients.AsNoTracking().FirstOrDefaultAsync(c => c.ClientId == revokeClientId, ct);
        if (client is not null)
            await db.OAuthGrants.Where(g => g.RefreshHash == hash && g.ClientId == client.Id && g.RevokedAt == null)
                .ExecuteUpdateAsync(s => s.SetProperty(g => g.RevokedAt, now), ct);
        await db.AccessTokens.Where(t => t.TokenHash == hash && t.GrantId != null && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now), ct);
        return Results.Ok();
    }

    // ---------------- Ứng dụng đã kết nối ----------------

    private static async Task<Ok<List<GrantDto>>> ListGrantsAsync(ClaimsPrincipal user, OfficeIdentityDbContext db, TimeProvider clock, CancellationToken ct)
    {
        var uid = user.GetUserId()!.Value;
        var now = clock.GetUtcNow();
        var rows = await db.OAuthGrants.AsNoTracking().Where(g => g.UserId == uid).OrderByDescending(g => g.CreatedAt).Take(50).ToListAsync(ct);
        return TypedResults.Ok(rows.Select(g => ToDto(g, now)).ToList());
    }

    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> RevokeGrantAsync(Guid id, ClaimsPrincipal user,
        OfficeIdentityDbContext db, TimeProvider clock, CancellationToken ct)
    {
        if (user.IsAccessToken()) return CookieOnly();
        var uid = user.GetUserId()!.Value;
        var grant = await db.OAuthGrants.FirstOrDefaultAsync(g => g.Id == id, ct);
        if (grant is null || (grant.UserId != uid && !user.IsHr())) return TypedResults.NotFound();
        if (grant.RevokedAt is null)
        {
            grant.RevokedAt = clock.GetUtcNow();
            await db.SaveChangesAsync(ct);
        }
        return TypedResults.NoContent();
    }

    internal static GrantDto ToDto(OAuthGrant g, DateTimeOffset now) =>
        new(g.Id, g.ClientName, g.CreatedAt, g.LastUsedAt, g.RefreshExpiresAt, g.RevokedAt,
            g.RevokedAt is not null ? "Revoked" : g.RefreshExpiresAt <= now ? "Expired" : "Active");

    private static ProblemHttpResult CookieOnly() =>
        TypedResults.Problem("Chỉ thao tác khi đăng nhập trên web", statusCode: StatusCodes.Status403Forbidden);

    private static IResult Error(string error, string description, int status = StatusCodes.Status400BadRequest) =>
        Results.Json(new { error, error_description = description }, statusCode: status);
}
