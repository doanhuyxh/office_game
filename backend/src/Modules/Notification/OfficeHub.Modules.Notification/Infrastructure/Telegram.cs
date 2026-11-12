using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Hosting;
using OfficeHub.Modules.Identity.Contracts;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Notification.Domain;

namespace OfficeHub.Modules.Notification.Infrastructure;

/// <summary>
/// Gọi Telegram Bot API <c>sendMessage</c>. URL chứa bot token → HttpClient này TẮT log của IHttpClientFactory (NotificationModule:
/// <c>RemoveAllLoggers</c>) và không bao giờ đưa URL / token vào thông điệp lỗi. <c>Telegram__ApiUrl</c> chỉ để test (máy chủ giả).
/// </summary>
internal sealed class TelegramClient(IHttpClientFactory http, IConfiguration config)
{
    public const string ClientName = "officehub-telegram";

    public sealed record Result(bool Ok, int? Status, string? Error, int? RetryAfter);

    public async Task<Result> SendAsync(string token, string chatId, string text, CancellationToken ct)
    {
        var baseUrl = (config["Telegram:ApiUrl"] is { Length: > 0 } u ? u : "https://api.telegram.org").TrimEnd('/');
        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TelegramQueueRules.Timeout);
            using var res = await http.CreateClient(ClientName).PostAsJsonAsync($"{baseUrl}/bot{token}/sendMessage",
                new { chat_id = chatId, text, disable_web_page_preview = true }, cts.Token);
            var status = (int)res.StatusCode;
            if (res.IsSuccessStatusCode) return new(true, status, null, null);
            string? description = null;
            int? retryAfter = null;
            try
            {
                using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(cts.Token));
                if (doc.RootElement.TryGetProperty("description", out var d) && d.ValueKind == JsonValueKind.String) description = d.GetString();
                if (doc.RootElement.TryGetProperty("parameters", out var p) && p.TryGetProperty("retry_after", out var ra) && ra.TryGetInt32(out var s)) retryAfter = s;
            }
            catch (JsonException) { /* thân không phải JSON */ }
            var msg = $"Telegram trả {status}{(description is null ? "" : $": {description}")}";
            return new(false, status, Trim(msg.Replace(token, "***")), retryAfter);
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            // Không dùng ex.ToString(): tránh lộ URL có token nếu thư viện có ghi vào thông điệp.
            var msg = ex is TaskCanceledException ? "Hết thời gian chờ Telegram" : (ex.InnerException?.Message ?? ex.Message).Replace(token, "***");
            return new(false, null, Trim(msg), null);
        }
    }

    private static string Trim(string s) => s.Length > 500 ? s[..500] : s;
}

/// <summary>Đưa tin đánh thức vào hàng đợi (TEST-42) + gửi thử. Chỉ tài khoản bot đang hoạt động.</summary>
internal sealed class TelegramWakeup(NotificationDbContext db, IAccountService accounts, RuntimeConfig runtime, TelegramClient client,
    TimeProvider clock, ILogger<TelegramWakeup> log) : ITelegramWakeup
{
    public async Task TaskAssignedAsync(Guid assigneeUserId, string employeeCode, Guid projectId, Guid taskId, string taskCode, CancellationToken ct = default)
    {
        try
        {
            var cfg = runtime.Telegram;
            if (!cfg.Ready) return;
            var acc = await accounts.GetAsync(assigneeUserId, ct);
            if (acc is not { IsBot: true, IsActive: true }) return;
            var now = clock.GetUtcNow();
            db.TelegramMessages.Add(new TelegramMessage
            {
                Kind = "task_assigned", ChatId = cfg.ChatId!, UserId = assigneeUserId, TaskId = taskId, CreatedAt = now, NextAttemptAt = now,
                Text = TelegramRules.WakeMessage(employeeCode, projectId, taskId, taskCode),
            });
            await db.SaveChangesAsync(ct);
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            log.LogError(ex, "Không đưa được tin Telegram đánh thức agent vào hàng đợi (việc {TaskCode})", taskCode);
        }
    }

    public async Task<(bool Ok, string Message)> SendTestAsync(CancellationToken ct = default)
    {
        var cfg = runtime.Telegram;
        if (string.IsNullOrWhiteSpace(cfg.BotToken) || string.IsNullOrWhiteSpace(cfg.ChatId)) return (false, "Chưa có bot token / chat id");
        var r = await client.SendAsync(cfg.BotToken, cfg.ChatId, $"OfficeHub: tin thử kênh Telegram lúc {clock.GetUtcNow():yyyy-MM-dd HH:mm:ss} UTC", ct);
        return r.Ok
            ? (true, $"Đã gửi tin thử vào chat {cfg.ChatId}{(cfg.Enabled ? "" : " (kênh đang TẮT — giao việc chưa gửi tin)")}")
            : (false, r.Error ?? "Gửi thất bại");
    }
}

/// <summary>Gửi hàng đợi Telegram mỗi 3 giây; lỗi mạng / 429 / 5xx thử lại tối đa <see cref="TelegramQueueRules.MaxAttempts"/> lần.</summary>
internal sealed class TelegramDispatcher(IServiceScopeFactory scopes, RuntimeConfig runtime, TelegramClient client, TimeProvider clock,
    ILogger<TelegramDispatcher> log, JobMonitor monitor) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(3);
    private DateTimeOffset _lastCleanup = DateTimeOffset.MinValue;

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        var job = monitor.Register("notification.telegram", "Gửi Telegram (đánh thức agent)", Interval);
        using var timer = new PeriodicTimer(Interval);
        do
        {
            try { await job.RunAsync(() => SendDueAsync(stop)); }
            catch (Exception ex) when (!stop.IsCancellationRequested) { log.LogError(ex, "Lỗi khi quét hàng đợi Telegram"); }
        } while (await timer.WaitForNextTickAsync(stop));
    }

    internal async Task SendDueAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NotificationDbContext>();
        var now = clock.GetUtcNow();
        if (now - _lastCleanup > TimeSpan.FromHours(1))
        {
            _lastCleanup = now;
            var cutoff = now - TelegramQueueRules.KeepMessages;
            await db.TelegramMessages.Where(m => m.Status != TelegramStatus.Pending && m.CreatedAt < cutoff).ExecuteDeleteAsync(ct);
        }
        var due = await db.TelegramMessages.Where(m => m.Status == TelegramStatus.Pending && m.NextAttemptAt <= now)
            .OrderBy(m => m.NextAttemptAt).Take(20).ToListAsync(ct);
        foreach (var m in due)
        {
            var cfg = runtime.Telegram;
            if (!cfg.Ready)
            {
                (m.Status, m.NextAttemptAt, m.Error) = (TelegramStatus.Failed, null, "Kênh Telegram đã tắt / thiếu cấu hình");
                await db.SaveChangesAsync(ct);
                continue;
            }
            m.Attempts++;
            var r = await client.SendAsync(cfg.BotToken!, m.ChatId, m.Text, ct);
            var at = clock.GetUtcNow();
            m.ResponseStatus = r.Status;
            if (r.Ok)
                (m.Status, m.SentAt, m.NextAttemptAt, m.Error) = (TelegramStatus.Sent, at, null, null);
            else
            {
                var next = TelegramQueueRules.Retryable(r.Status) ? TelegramQueueRules.NextAttempt(m.Attempts, at, r.RetryAfter) : null;
                (m.Status, m.NextAttemptAt, m.Error) = (next is null ? TelegramStatus.Failed : TelegramStatus.Pending, next, r.Error);
                log.LogWarning("Gửi Telegram lỗi (lần {Attempt}, {Next}): {Error}", m.Attempts, next is null ? "bỏ" : "thử lại", r.Error);
            }
            await db.SaveChangesAsync(ct); // lưu từng tin: lỗi giữa chừng không gửi lại tin đã gửi
        }
    }
}
