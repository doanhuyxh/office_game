using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using OfficeHub.BuildingBlocks.Hosting;
using OfficeHub.BuildingBlocks.Security;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Notification.Domain;

namespace OfficeHub.Modules.Notification.Infrastructure;

internal static class WebhookJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);

    /// <summary>Thêm sự kiện vào hàng đợi cho những người (trong <paramref name="userIds"/>) có webhook đang bật. Chưa SaveChanges.</summary>
    public static async Task<int> EnqueueAsync(NotificationDbContext db, IReadOnlyCollection<Guid> userIds, string eventType,
        Func<Guid, object> data, DateTimeOffset now, CancellationToken ct)
    {
        if (userIds.Count == 0) return 0;
        var targets = await db.Webhooks.AsNoTracking().Where(w => userIds.Contains(w.UserId) && w.Enabled).Select(w => w.UserId).ToListAsync(ct);
        foreach (var uid in targets)
            db.WebhookDeliveries.Add(new WebhookDelivery
            {
                UserId = uid, Event = eventType, DataJson = JsonSerializer.Serialize(data(uid), Options), CreatedAt = now, NextAttemptAt = now,
            });
        return targets.Count;
    }
}

/// <summary>Module khác gửi sự kiện không tạo chuông (vd tin nhắn 1-1) tới webhook.</summary>
internal sealed class WebhookPublisher(NotificationDbContext db, TimeProvider clock, ILogger<WebhookPublisher> log) : IWebhookPublisher
{
    public async Task PublishAsync(IReadOnlyCollection<Guid> userIds, string eventType, object data, CancellationToken ct = default)
    {
        try
        {
            if (await WebhookJson.EnqueueAsync(db, userIds.Distinct().ToList(), eventType, _ => data, clock.GetUtcNow(), ct) > 0)
                await db.SaveChangesAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Không xếp được sự kiện webhook {Event}", eventType);
        }
    }
}

/// <summary>
/// Gửi hàng đợi webhook mỗi 3 giây (≤ 20 sự kiện / lượt). Ký HMAC (<see cref="WebhookRules.Sign"/>), không theo chuyển hướng, timeout 10 giây.
/// Chống SSRF: kết nối thẳng tới IP đã kiểm tra (<see cref="WebhookRules.IsPublic"/>) — tên miền trỏ về IP nội bộ bị chặn kể cả khi đổi DNS
/// giữa lúc kiểm tra và lúc kết nối. Môi trường Development cho phép địa chỉ nội bộ (e2e gửi về máy dev).
/// Lỗi tạm thời → thử lại 1 / 5 / 15 / 60 phút; hết lượt → Failed; 20 sự kiện liên tiếp thất bại → tự tắt webhook. Chỉ chạy trong host Api, một instance.
/// </summary>
internal sealed class WebhookDispatcher(IServiceScopeFactory scopes, IHttpClientFactory http, TimeProvider clock,
    ILogger<WebhookDispatcher> log, JobMonitor monitor) : BackgroundService
{
    public const string ClientName = "officehub-webhook";
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(3);
    private DateTimeOffset _lastCleanup = DateTimeOffset.MinValue;

    /// <summary>Handler cho HttpClient webhook: chặn IP nội bộ ngay lúc mở kết nối, không tự chuyển hướng.</summary>
    public static SocketsHttpHandler CreateHandler(bool allowPrivate) => new()
    {
        AllowAutoRedirect = false,
        UseCookies = false,
        ConnectTimeout = TimeSpan.FromSeconds(5),
        ConnectCallback = async (ctx, ct) =>
        {
            var addresses = await Dns.GetHostAddressesAsync(ctx.DnsEndPoint.Host, ct);
            var allowed = addresses.Where(a => allowPrivate || WebhookRules.IsPublic(a)).ToArray();
            if (allowed.Length == 0) throw new HttpRequestException("Không gửi webhook tới địa chỉ nội bộ");
            var socket = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
            try
            {
                await socket.ConnectAsync(allowed, ctx.DnsEndPoint.Port, ct);
                return new NetworkStream(socket, ownsSocket: true);
            }
            catch
            {
                socket.Dispose();
                throw;
            }
        },
    };

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        var job = monitor.Register("notification.webhook", "Gửi webhook (đánh thức agent)", Interval);
        using var timer = new PeriodicTimer(Interval);
        do
        {
            try { await job.RunAsync(() => SendDueAsync(stop)); }
            catch (Exception ex) when (!stop.IsCancellationRequested) { log.LogError(ex, "Lỗi khi quét hàng đợi webhook"); }
        } while (await timer.WaitForNextTickAsync(stop));
    }

    internal async Task SendDueAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NotificationDbContext>();
        var enc = scope.ServiceProvider.GetRequiredService<IFieldEncryptor>();
        var now = clock.GetUtcNow();
        if (now - _lastCleanup > TimeSpan.FromHours(1))
        {
            _lastCleanup = now;
            var cutoff = now - WebhookRules.KeepDeliveries;
            await db.WebhookDeliveries.Where(d => d.Status != WebhookStatus.Pending && d.CreatedAt < cutoff).ExecuteDeleteAsync(ct);
        }
        var due = await db.WebhookDeliveries.Where(d => d.Status == WebhookStatus.Pending && d.NextAttemptAt <= now)
            .OrderBy(d => d.NextAttemptAt).Take(20).ToListAsync(ct);
        if (due.Count == 0) return;
        var userIds = due.Select(d => d.UserId).Distinct().ToList();
        var hooks = await db.Webhooks.Where(w => userIds.Contains(w.UserId)).ToDictionaryAsync(w => w.UserId, ct);
        var client = http.CreateClient(ClientName);
        foreach (var d in due)
        {
            if (!hooks.TryGetValue(d.UserId, out var hook) || !hook.Enabled)
            {
                (d.Status, d.NextAttemptAt, d.Error) = (WebhookStatus.Failed, null, "Webhook đã tắt / xoá");
                await db.SaveChangesAsync(ct);
                continue;
            }
            d.Attempts++;
            int? status = null;
            string? error = null;
            try
            {
                var body = Envelope(d);
                var ts = clock.GetUtcNow().ToUnixTimeSeconds();
                using var req = new HttpRequestMessage(HttpMethod.Post, hook.Url) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
                req.Headers.TryAddWithoutValidation("User-Agent", "OfficeHub-Webhook/1");
                req.Headers.Add(WebhookRules.EventHeader, d.Event);
                req.Headers.Add(WebhookRules.DeliveryHeader, d.Id.ToString());
                req.Headers.Add(WebhookRules.TimestampHeader, ts.ToString(System.Globalization.CultureInfo.InvariantCulture));
                req.Headers.Add(WebhookRules.SignatureHeader, WebhookRules.Sign(enc.Decrypt(hook.SecretEncrypted), ts, body));
                using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                cts.CancelAfter(WebhookRules.Timeout);
                using var res = await client.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, cts.Token);
                status = (int)res.StatusCode;
                if (!res.IsSuccessStatusCode) error = $"Phản hồi {status}";
            }
            catch (Exception ex) when (!ct.IsCancellationRequested)
            {
                var m = ex.InnerException?.Message ?? ex.Message;
                error = m.Length > 500 ? m[..500] : m;
            }

            var at = clock.GetUtcNow();
            d.ResponseStatus = status;
            if (error is null)
            {
                (d.Status, d.SentAt, d.NextAttemptAt, d.Error) = (WebhookStatus.Sent, at, null, null);
                (hook.LastSuccessAt, hook.ConsecutiveFailures) = (at, 0);
            }
            else
            {
                var next = WebhookRules.Retryable(status) ? WebhookRules.NextAttempt(d.Attempts, at) : null;
                (d.Status, d.NextAttemptAt, d.Error) = (next is null ? WebhookStatus.Failed : WebhookStatus.Pending, next, error);
                (hook.LastFailureAt, hook.LastError) = (at, error);
                if (next is null && ++hook.ConsecutiveFailures >= WebhookRules.DisableAfterFailures)
                {
                    hook.Enabled = false;
                    log.LogWarning("Tự tắt webhook của {UserId} sau {N} lần thất bại liên tiếp", hook.UserId, hook.ConsecutiveFailures);
                }
            }
            await db.SaveChangesAsync(ct); // lưu từng sự kiện: lỗi giữa chừng không gửi lại cái đã gửi
        }
    }

    /// <summary>Body gửi đi: <c>{ id, event, createdAt, data }</c>.</summary>
    internal static string Envelope(WebhookDelivery d) => new JsonObject
    {
        ["id"] = d.Id.ToString(),
        ["event"] = d.Event,
        ["createdAt"] = d.CreatedAt.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", System.Globalization.CultureInfo.InvariantCulture),
        ["data"] = JsonNode.Parse(d.DataJson),
    }.ToJsonString();
}
