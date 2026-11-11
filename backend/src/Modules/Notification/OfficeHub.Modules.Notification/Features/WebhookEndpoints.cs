using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.BuildingBlocks.Security;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Notification.Domain;
using OfficeHub.Modules.Notification.Infrastructure;

namespace OfficeHub.Modules.Notification.Features;

public sealed record WebhookDeliveryDto(Guid Id, string Event, WebhookStatus Status, int Attempts, int? ResponseStatus, string? Error,
    DateTimeOffset CreatedAt, DateTimeOffset? SentAt);
/// <param name="Configured">false = chưa đặt webhook (các trường khác rỗng).</param>
public sealed record WebhookDto(bool Configured, string? Url, bool Enabled, DateTimeOffset? CreatedAt, DateTimeOffset? LastSuccessAt, DateTimeOffset? LastFailureAt,
    string? LastError, int ConsecutiveFailures, IReadOnlyList<WebhookDeliveryDto> Recent);
public sealed record SaveWebhookRequest(string? Url, bool Enabled = true);
/// <param name="Secret">Khoá ký — CHỈ trả lúc tạo mới / đổi khoá, không xem lại được.</param>
public sealed record WebhookSecretDto(string? Secret);

/// <summary>
/// Webhook cá nhân của tài khoản đang đăng nhập (<c>/api/notifications/webhook</c>): đặt / sửa URL, bật / tắt, đổi khoá ký, gửi thử, xoá.
/// Chỉ đăng nhập web (token AI → 403: agent không tự đổi nơi nhận sự kiện của mình). Mọi truy vấn theo UserId của chính người gọi.
/// </summary>
internal static class WebhookEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("", GetAsync);
        g.MapPut("", SaveAsync);
        g.MapPost("/rotate", RotateAsync);
        g.MapPost("/test", TestAsync);
        g.MapDelete("", DeleteAsync);
    }

    private static ProblemHttpResult WebOnly() =>
        TypedResults.Problem("Chỉ cài đặt webhook khi đăng nhập trên web", statusCode: StatusCodes.Status403Forbidden);

    private static async Task<Results<Ok<WebhookDto>, ProblemHttpResult>> GetAsync(ClaimsPrincipal user, NotificationDbContext db, CancellationToken ct)
    {
        if (user.IsAccessToken()) return WebOnly();
        var me = user.GetUserId()!.Value;
        var w = await db.Webhooks.AsNoTracking().FirstOrDefaultAsync(x => x.UserId == me, ct);
        if (w is null) return TypedResults.Ok(new WebhookDto(false, null, false, null, null, null, null, 0, []));
        var recent = await db.WebhookDeliveries.AsNoTracking().Where(d => d.UserId == me).OrderByDescending(d => d.CreatedAt).Take(10)
            .Select(d => new WebhookDeliveryDto(d.Id, d.Event, d.Status, d.Attempts, d.ResponseStatus, d.Error, d.CreatedAt, d.SentAt)).ToListAsync(ct);
        return TypedResults.Ok(new WebhookDto(true, w.Url, w.Enabled, w.CreatedAt, w.LastSuccessAt, w.LastFailureAt, w.LastError, w.ConsecutiveFailures, recent));
    }

    /// <summary>Tạo (trả khoá ký một lần) hoặc đổi URL / bật tắt (giữ khoá cũ). Bật lại → đếm lỗi về 0.</summary>
    private static async Task<Results<Ok<WebhookSecretDto>, ValidationProblem, ProblemHttpResult>> SaveAsync(SaveWebhookRequest req, ClaimsPrincipal user,
        NotificationDbContext db, IFieldEncryptor enc, IHostEnvironment env, TimeProvider clock, CancellationToken ct)
    {
        if (user.IsAccessToken()) return WebOnly();
        if (WebhookRules.UrlError(req.Url, env.IsDevelopment()) is { } err) return new Validation().Add("url", err).Problem();
        var me = user.GetUserId()!.Value;
        var now = clock.GetUtcNow();
        var w = await db.Webhooks.FirstOrDefaultAsync(x => x.UserId == me, ct);
        string? secret = null;
        if (w is null)
        {
            secret = WebhookRules.NewSecret();
            w = new Webhook { UserId = me, SecretEncrypted = enc.Encrypt(secret), CreatedAt = now };
            db.Webhooks.Add(w);
        }
        if (req.Enabled && !w.Enabled) w.ConsecutiveFailures = 0;
        (w.Url, w.Enabled, w.UpdatedAt) = (req.Url!.Trim(), req.Enabled, now);
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(new WebhookSecretDto(secret));
    }

    private static async Task<Results<Ok<WebhookSecretDto>, ProblemHttpResult>> RotateAsync(ClaimsPrincipal user, NotificationDbContext db, IFieldEncryptor enc,
        TimeProvider clock, CancellationToken ct)
    {
        if (user.IsAccessToken()) return WebOnly();
        var me = user.GetUserId()!.Value;
        var w = await db.Webhooks.FirstOrDefaultAsync(x => x.UserId == me, ct);
        if (w is null) return Problems.NotFound("webhook");
        var secret = WebhookRules.NewSecret();
        (w.SecretEncrypted, w.UpdatedAt) = (enc.Encrypt(secret), clock.GetUtcNow());
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(new WebhookSecretDto(secret));
    }

    /// <summary>Gửi sự kiện <c>ping</c> (vào hàng đợi, vài giây sau có kết quả ở "Gần đây").</summary>
    private static async Task<Results<NoContent, ProblemHttpResult>> TestAsync(ClaimsPrincipal user, NotificationDbContext db, TimeProvider clock, CancellationToken ct)
    {
        if (user.IsAccessToken()) return WebOnly();
        var me = user.GetUserId()!.Value;
        var w = await db.Webhooks.AsNoTracking().FirstOrDefaultAsync(x => x.UserId == me, ct);
        if (w is null) return Problems.NotFound("webhook");
        if (!w.Enabled) return Problems.Conflict("Webhook đang tắt — bật lại rồi gửi thử");
        var now = clock.GetUtcNow();
        await WebhookJson.EnqueueAsync(db, [me], WebhookEvents.Ping, _ => new { message = "Gửi thử từ OfficeHub" }, now, ct);
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private static async Task<Results<NoContent, ProblemHttpResult>> DeleteAsync(ClaimsPrincipal user, NotificationDbContext db, CancellationToken ct)
    {
        if (user.IsAccessToken()) return WebOnly();
        var me = user.GetUserId()!.Value;
        await db.WebhookDeliveries.Where(d => d.UserId == me).ExecuteDeleteAsync(ct);
        await db.Webhooks.Where(w => w.UserId == me).ExecuteDeleteAsync(ct);
        return TypedResults.NoContent();
    }
}
