using Microsoft.EntityFrameworkCore;
using Npgsql;
using OfficeHub.BuildingBlocks.Ai;
using OfficeHub.Modules.Audit.Domain;

namespace OfficeHub.Modules.Audit.Infrastructure;

/// <summary>Ghi mức dùng AI theo phiên (TEST-134): upsert theo (UserId, SourceId), không xoá phiên.</summary>
internal static class AiSessionUsageStore
{
    /// <summary>Lô đã qua <see cref="AiUsageRoute.Validate"/>. Hai lô cùng SourceId gửi đồng thời → trùng khoá → thử lại một lần (thành cập nhật).</summary>
    public static async Task<AiUsageAccepted> UpsertAsync(AuditDbContext db, Guid userId, IReadOnlyList<AiUsageSession> sessions, DateTimeOffset now,
        CancellationToken ct)
    {
        try
        {
            return await TryUpsertAsync(db, userId, sessions, now, ct);
        }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            db.ChangeTracker.Clear();
            return await TryUpsertAsync(db, userId, sessions, now, ct);
        }
    }

    private static async Task<AiUsageAccepted> TryUpsertAsync(AuditDbContext db, Guid userId, IReadOnlyList<AiUsageSession> sessions, DateTimeOffset now,
        CancellationToken ct)
    {
        var items = sessions.Select(s => (Raw: s, N: AiSessionLedger.Normalize(s))).ToList();
        var keys = items.Select(x => x.N.SourceId).ToList();
        var existing = await db.AiUsageSessions.Include(x => x.Models)
            .Where(x => x.UserId == userId && keys.Contains(x.SourceId))
            .ToDictionaryAsync(x => x.SourceId, StringComparer.Ordinal, ct);

        int created = 0, updated = 0;
        foreach (var (raw, n) in items)
        {
            if (!existing.TryGetValue(n.SourceId, out var row))
            {
                row = new AiSessionUsage { UserId = userId, SourceId = n.SourceId };
                db.AiUsageSessions.Add(row);
                created++;
            }
            else updated++;

            row.Kind = n.Kind;
            row.TaskId = raw.TaskId;
            row.ProjectId = raw.ProjectId;
            row.TaskCode = n.TaskCode;
            row.Executor = n.Executor;
            row.Status = raw.Status!;
            row.StartedAt = raw.StartedAt!.Value.ToUniversalTime();
            row.FinishedAt = raw.FinishedAt!.Value.ToUniversalTime();
            row.Turns = raw.Turns;
            row.CostUsd = n.CostUsd;
            row.ReceivedAt = now.ToUniversalTime();
            MergeModels(row, n.Models);
        }
        await db.SaveChangesAsync(ct);
        return new AiUsageAccepted(items.Count, created, updated);
    }

    /// <summary>Cập nhật tại chỗ theo tên model (không xoá rồi thêm lại — tránh đụng khoá duy nhất (SessionId, Model) trong cùng lô lệnh).</summary>
    private static void MergeModels(AiSessionUsage row, IReadOnlyList<AiSessionModel> models)
    {
        var names = models.Select(m => m.Model).ToHashSet(StringComparer.Ordinal);
        row.Models.RemoveAll(m => !names.Contains(m.Model));
        foreach (var m in models)
        {
            if (row.Models.FirstOrDefault(x => x.Model == m.Model) is { } cur)
            {
                cur.InputTokens = m.InputTokens;
                cur.OutputTokens = m.OutputTokens;
                cur.CacheReadTokens = m.CacheReadTokens;
                cur.CacheWriteTokens = m.CacheWriteTokens;
                cur.CostUsd = m.CostUsd;
            }
            else row.Models.Add(m);
        }
    }
}
