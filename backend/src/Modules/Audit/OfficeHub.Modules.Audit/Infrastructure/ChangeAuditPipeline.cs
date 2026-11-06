using System.Text.Json;
using System.Threading.Channels;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using OfficeHub.BuildingBlocks.Auditing;
using OfficeHub.Modules.Audit.Domain;

namespace OfficeHub.Modules.Audit.Infrastructure;

/// <summary>Cài đặt <see cref="IChangeAuditSink"/>: hàng đợi RAM (không làm chậm request) → <see cref="ChangeAuditWriter"/> ghi DB theo lô.</summary>
public sealed class ChangeAuditQueue : IChangeAuditSink
{
    private readonly Channel<ChangeRecord> _channel = Channel.CreateBounded<ChangeRecord>(
        new BoundedChannelOptions(20_000) { FullMode = BoundedChannelFullMode.DropOldest, SingleReader = true });

    public void Enqueue(ChangeRecord record) => _channel.Writer.TryWrite(record);
    public ChannelReader<ChangeRecord> Reader => _channel.Reader;
}

internal sealed class ChangeAuditWriter(ChangeAuditQueue queue, IServiceProvider sp, ILogger<ChangeAuditWriter> log) : BackgroundService
{
    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        var batch = new List<ChangeRecord>(200);
        while (await queue.Reader.WaitToReadAsync(ct))
        {
            while (batch.Count < 200 && queue.Reader.TryRead(out var r)) batch.Add(r);
            try
            {
                using var scope = sp.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AuditDbContext>();
                db.Changes.AddRange(batch.Select(r => new ChangeLog
                {
                    OccurredAt = r.OccurredAt,
                    Source = r.Source,
                    UserId = r.UserId,
                    UserName = Cut(r.UserName, 200),
                    Module = Cut(r.Module, 30)!,
                    Entity = Cut(r.Entity, 60)!,
                    EntityId = Cut(r.EntityId, 100)!,
                    EntityLabel = Cut(r.EntityLabel, 200),
                    Action = r.Action,
                    ChangesJson = JsonSerializer.Serialize(r.Changes, Json),
                }));
                await db.SaveChangesAsync(ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogWarning(ex, "Không ghi được {Count} dòng lịch sử sửa", batch.Count);
            }
            batch.Clear();
        }
    }

    private static string? Cut(string? s, int max) => s is null ? null : s.Length <= max ? s : s[..max];
}
