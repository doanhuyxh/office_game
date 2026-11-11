using System.Diagnostics;
using System.Threading.Channels;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.Modules.Audit.Domain;

namespace OfficeHub.Modules.Audit.Infrastructure;

/// <summary>Hàng đợi trong RAM: request không chờ ghi DB. Đầy (DB chậm / sập) → bỏ bản ghi cũ nhất, không chặn người dùng.</summary>
public sealed class AiAuditQueue
{
    private readonly Channel<AiRequestLog> _channel = Channel.CreateBounded<AiRequestLog>(
        new BoundedChannelOptions(10_000) { FullMode = BoundedChannelFullMode.DropOldest, SingleReader = true });

    public void Enqueue(AiRequestLog log) => _channel.Writer.TryWrite(log);
    public ChannelReader<AiRequestLog> Reader => _channel.Reader;
}

/// <summary>
/// Bọc toàn bộ pipeline của Api (IStartupFilter — module không sửa Program.cs): sau khi request xong, nếu module Identity đã
/// đánh dấu người gọi bằng token AI (<see cref="AccessTokenAuth.CallerItemKey"/>) thì ghi một dòng audit.
/// </summary>
internal sealed class AiAuditStartupFilter(AiAuditQueue queue, TimeProvider clock) : IStartupFilter
{
    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
    {
        app.Use(async (ctx, nextMw) =>
        {
            var started = Stopwatch.GetTimestamp();
            // Chưa xác thực ở đây → chỉ đoán theo header; người gọi thật sự là token AI hay không xét ở finally.
            var buffered = WantsBody(ctx.Request);
            if (buffered) ctx.Request.EnableBuffering();
            try { await nextMw(ctx); }
            finally
            {
                if (ctx.Items.TryGetValue(AccessTokenAuth.CallerItemKey, out var v) && v is AccessTokenCaller caller)
                    queue.Enqueue(new AiRequestLog
                    {
                        RequestSummary = AuditRules.KeepsSummary(ctx.Request.Method, ctx.Response.StatusCode)
                            ? await SummarizeAsync(ctx.Request, buffered) : null,
                        OccurredAt = clock.GetUtcNow(),
                        UserId = caller.UserId,
                        TokenId = caller.TokenId,
                        ClientName = Cut(caller.ClientName, 100),
                        ViaOAuth = caller.ViaOAuth,
                        Tool = AuditRules.CleanTool(ctx.Request.Headers[AccessTokenAuth.ToolHeader].ToString()),
                        Method = Cut(ctx.Request.Method, 10),
                        Path = Cut(ctx.Request.Path.Value ?? "", 300),
                        Status = ctx.Response.StatusCode,
                        DurationMs = (int)Stopwatch.GetElapsedTime(started).TotalMilliseconds,
                        Ip = ctx.Connection.RemoteIpAddress?.ToString(),
                    });
            }
        });
        next(app);
    };

    private static string Cut(string s, int max) => s.Length <= max ? s : s[..max];

    /// <summary>Chỉ đệm body JSON của lệnh ghi có Bearer token AI (<c>ohk_</c>) — request cookie không tốn thêm gì.</summary>
    private static bool WantsBody(HttpRequest req) =>
        AuditRules.IsWrite(req.Method)
        && req.Headers.Authorization.ToString().StartsWith("Bearer ohk_", StringComparison.Ordinal)
        && IsJson(req.ContentType)
        && req.ContentLength is null or <= AiRequestSummary.MaxBodyBytes;

    private static bool IsJson(string? contentType) =>
        contentType is not null && contentType.Contains("json", StringComparison.OrdinalIgnoreCase);

    /// <summary>Không bao giờ ném lỗi: nhật ký không được làm hỏng request.</summary>
    private static async Task<string?> SummarizeAsync(HttpRequest req, bool buffered)
    {
        try
        {
            if (!buffered)
            {
                if (req.ContentLength is null or 0 && !IsJson(req.ContentType)) return null;
                var type = IsJson(req.ContentType) ? "too_large"
                    : req.HasFormContentType ? "form" : "binary";
                return AiRequestSummary.Meta(type, req.ContentLength);
            }
            req.Body.Position = 0;
            var buf = new byte[AiRequestSummary.MaxBodyBytes + 1];
            var read = 0;
            int n;
            while (read < buf.Length && (n = await req.Body.ReadAsync(buf.AsMemory(read))) > 0) read += n;
            if (read > AiRequestSummary.MaxBodyBytes) return AiRequestSummary.Meta("too_large", req.ContentLength);
            return AiRequestSummary.FromJson(buf.AsSpan(0, read));
        }
        catch (Exception)
        {
            return null;
        }
    }
}

/// <summary>Ghi hàng đợi xuống DB theo lô; mỗi ngày xoá bản ghi quá hạn lưu.</summary>
internal sealed class AiAuditWriter(AiAuditQueue queue, IServiceProvider sp, TimeProvider clock, ILogger<AiAuditWriter> log) : BackgroundService
{
    private DateTimeOffset _lastCleanup = DateTimeOffset.MinValue;

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        var batch = new List<AiRequestLog>(200);
        while (await queue.Reader.WaitToReadAsync(ct))
        {
            while (batch.Count < 200 && queue.Reader.TryRead(out var item)) batch.Add(item);
            try
            {
                using var scope = sp.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AuditDbContext>();
                db.AiRequests.AddRange(batch);
                await db.SaveChangesAsync(ct);
                var now = clock.GetUtcNow();
                if (now - _lastCleanup > TimeSpan.FromHours(1))
                {
                    _lastCleanup = now;
                    var cutoff = now.AddDays(-AuditRules.AiRetentionDays);
                    await db.AiRequests.Where(x => x.OccurredAt < cutoff).ExecuteDeleteAsync(ct);
                    // Nội dung lệnh ghi chỉ giữ 7 ngày (dòng nhật ký vẫn còn). Đọc cũng lọc theo mốc này nên không lộ quá hạn dù job trễ.
                    var summaryCutoff = now.AddDays(-AuditRules.AiSummaryRetentionDays);
                    await db.AiRequests.Where(x => x.RequestSummary != null && x.OccurredAt < summaryCutoff)
                        .ExecuteUpdateAsync(s => s.SetProperty(x => x.RequestSummary, (string?)null), ct);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogWarning(ex, "Không ghi được {Count} dòng audit AI", batch.Count);
            }
            batch.Clear();
        }
    }
}
