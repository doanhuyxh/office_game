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
            try { await nextMw(ctx); }
            finally
            {
                if (ctx.Items.TryGetValue(AccessTokenAuth.CallerItemKey, out var v) && v is AccessTokenCaller caller)
                    queue.Enqueue(new AiRequestLog
                    {
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
                if (now - _lastCleanup > TimeSpan.FromDays(1))
                {
                    _lastCleanup = now;
                    var cutoff = now.AddDays(-AuditRules.AiRetentionDays);
                    await db.AiRequests.Where(x => x.OccurredAt < cutoff).ExecuteDeleteAsync(ct);
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
