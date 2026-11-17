using System.Security.Claims;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Ai;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.BuildingBlocks.Office;
using OfficeHub.Modules.Audit.Domain;
using OfficeHub.Modules.Audit.Infrastructure;
using OfficeHub.Modules.Identity.Contracts;

namespace OfficeHub.Modules.Audit.Features;

/// <summary>Một transcript trong danh sách tra soát (không có nội dung — tải bằng /download).</summary>
public sealed record AgentTranscriptListItem(Guid Id, Guid UserId, string? UserName, string? FullName, string Key, string Kind, string SessionId,
    string? Branch, string? Summary, long SizeBytes, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt, DateTimeOffset ExpiresAt);

/// <summary>
/// Transcript phiên agent (TEST-144).
/// - Nội bộ (chỉ OfficeHub.Mcp, khoá <c>Chat__McpToApiKey</c> / <c>Chat__InternalKey</c>, nginx chặn từ ngoài): <c>POST /api/audit/internal/agent-transcripts</c>
///   ghi bản của bot (userId từ token, Mcp đã kiểm là bot); <c>GET ?userId=&amp;key=</c> bot đọc lại bản của chính mình.
/// - Tra soát: <c>GET /api/agent-transcripts</c> (danh sách) và <c>GET /api/agent-transcripts/{id}/download</c> (.jsonl.gz đã giải mã) —
///   CHỈ admin / HR đăng nhập web (token AI → 403, kể cả token của admin).
/// </summary>
internal static class AgentTranscriptEndpoints
{
    public static void MapInternal(RouteGroupBuilder g)
    {
        g.MapPost("/agent-transcripts", IngestAsync);
        g.MapGet("/agent-transcripts", ReadOwnAsync);
    }

    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/", ListAsync);
        g.MapGet("/{id:guid}/download", DownloadAsync);
    }

    private static bool KeyOk(HttpRequest http, IOptions<ChatSettings> settings) =>
        BotActivityRoute.KeyMatches(http.Headers[AiUsageRoute.KeyHeader].ToString(), settings.Value.McpApiKey);

    private static async Task<Results<Ok<AgentTranscriptDto>, ProblemHttpResult>> IngestAsync(AgentTranscriptBatch? body, HttpRequest http,
        IOptions<ChatSettings> settings, AgentTranscriptStore store, CancellationToken ct)
    {
        if (!KeyOk(http, settings)) return TypedResults.Problem("Khoá nội bộ không đúng", statusCode: StatusCodes.Status401Unauthorized);
        if (body is null || body.UserId == Guid.Empty) return TypedResults.Problem("Thiếu userId", statusCode: StatusCodes.Status400BadRequest);
        if (AgentTranscriptRoute.Validate(body.Upload, out var gzip) is { } err) return TypedResults.Problem(err, statusCode: StatusCodes.Status400BadRequest);
        var (_, row) = await store.UpsertAsync(body.UserId, body.Upload!, gzip, ct);
        return TypedResults.Ok(ToDto(row, store.Summary(row), null));
    }

    private static async Task<Results<Ok<AgentTranscriptDto>, NotFound, ProblemHttpResult>> ReadOwnAsync(Guid? userId, string? key, HttpRequest http,
        IOptions<ChatSettings> settings, AgentTranscriptStore store, CancellationToken ct)
    {
        if (!KeyOk(http, settings)) return TypedResults.Problem("Khoá nội bộ không đúng", statusCode: StatusCodes.Status401Unauthorized);
        if (userId is not { } uid || uid == Guid.Empty || string.IsNullOrWhiteSpace(key) || key.Length > AgentTranscriptRoute.MaxKey)
            return TypedResults.Problem("Thiếu userId / key", statusCode: StatusCodes.Status400BadRequest);
        if (await store.ReadAsync(uid, key, ct) is not { } found) return TypedResults.NotFound();
        return TypedResults.Ok(ToDto(found.Row, store.Summary(found.Row), Convert.ToBase64String(found.Gzip)));
    }

    internal static AgentTranscriptDto ToDto(AgentTranscript t, string? summary, string? contentBase64) =>
        new(t.Key, t.Kind, t.SessionId, t.Cwd, t.Branch, summary, t.Sha256, t.SizeBytes, t.UpdatedAt, t.ExpiresAt, contentBase64);

    /// <summary>Chỉ admin / HR, đăng nhập web (token AI → 403).</summary>
    private static ProblemHttpResult? Deny(ClaimsPrincipal user) =>
        user.IsAccessToken() || !user.IsHr()
            ? TypedResults.Problem("Chỉ admin / HR xem transcript phiên agent (đăng nhập trên web)", statusCode: StatusCodes.Status403Forbidden)
            : null;

    /// <param name="userId">Lọc một bot; trống = mọi bot.</param>
    /// <param name="kind">task | chat | meeting; trống = mọi loại.</param>
    private static async Task<Results<Ok<PagedResult<AgentTranscriptListItem>>, ValidationProblem, ProblemHttpResult>> ListAsync(Guid? userId, string? kind,
        int? page, int? pageSize, ClaimsPrincipal user, AuditDbContext db, AgentTranscriptStore store, IAccountService accounts, TimeProvider clock,
        CancellationToken ct)
    {
        if (Deny(user) is { } denied) return denied;
        if (!string.IsNullOrWhiteSpace(kind) && !AgentTranscriptRoute.Kinds.Contains(kind.Trim()))
            return new Validation().Add("kind", "Loại phải là task, chat hoặc meeting").Problem();
        var now = clock.GetUtcNow();
        var q = db.AgentTranscripts.AsNoTracking().Where(t => t.ExpiresAt > now);
        if (userId is { } uid) q = q.Where(t => t.UserId == uid);
        if (!string.IsNullOrWhiteSpace(kind)) q = q.Where(t => t.Kind == kind.Trim());
        var paged = await q.OrderByDescending(t => t.UpdatedAt).ThenByDescending(t => t.Id).ToPagedAsync(page ?? 1, pageSize, ct);
        var names = await accounts.GetManyAsync(paged.Items.Select(t => t.UserId).Distinct().ToList(), ct);
        return TypedResults.Ok(paged.Map(t =>
        {
            names.TryGetValue(t.UserId, out var a);
            return new AgentTranscriptListItem(t.Id, t.UserId, a?.UserName, a?.FullName, t.Key, t.Kind, t.SessionId, t.Branch, store.Summary(t), t.SizeBytes,
                t.CreatedAt, t.UpdatedAt, t.ExpiresAt);
        }));
    }

    private static async Task<Results<FileContentHttpResult, NotFound, ProblemHttpResult>> DownloadAsync(Guid id, ClaimsPrincipal user, AuditDbContext db,
        AgentTranscriptStore store, TimeProvider clock, CancellationToken ct)
    {
        if (Deny(user) is { } denied) return denied;
        var now = clock.GetUtcNow();
        var t = await db.AgentTranscripts.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id && x.ExpiresAt > now, ct);
        if (t is null) return TypedResults.NotFound();
        return TypedResults.File(await store.ContentAsync(t, ct), "application/gzip", FileName(t));
    }

    /// <summary>Tên file tải về: <c>transcript-&lt;kind&gt;-&lt;key an toàn&gt;.jsonl.gz</c>.</summary>
    internal static string FileName(AgentTranscript t) => $"transcript-{t.Kind}-{Regex.Replace(t.Key, "[^A-Za-z0-9_-]", "_")}.jsonl.gz";
}
