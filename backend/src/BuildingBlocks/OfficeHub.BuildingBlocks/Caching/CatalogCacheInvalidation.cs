using System.Collections.Concurrent;
using System.Data.Common;
using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace OfficeHub.BuildingBlocks.Caching;

/// <summary>Khai báo bảng nguồn của từng tag cache danh mục: entity <typeparamref name="TEntity"/> bị ghi → xoá các tag.</summary>
public sealed class CatalogCacheRules
{
    internal Dictionary<Type, string[]> ByEntity { get; } = [];

    public CatalogCacheRules On<TEntity>(params string[] tags) where TEntity : class
    {
        ByEntity[typeof(TEntity)] = ByEntity.TryGetValue(typeof(TEntity), out var old) ? [.. old.Union(tags)] : tags;
        return this;
    }
}

public static class CatalogCacheExtensions
{
    /// <summary>
    /// Bật cache danh mục cho module có DbContext <typeparamref name="TContext"/> (gọi SAU <c>AddModuleDbContext</c>):
    /// đăng ký <see cref="CatalogCache"/> (singleton dùng chung) + interceptor xoá tag khi bảng nguồn bị ghi.
    /// </summary>
    public static IServiceCollection AddCatalogCache<TContext>(this IServiceCollection services, Action<CatalogCacheRules> rules)
        where TContext : DbContext
    {
        services.AddOfficeHubCache();
        services.TryAddSingleton<CatalogCache>();
        var r = new CatalogCacheRules();
        rules(r);
        services.AddSingleton(sp => new CatalogCacheInvalidation<TContext>(sp.GetRequiredService<CatalogCache>(), r));
        services.ConfigureDbContext<TContext>((sp, o) => o.AddInterceptors(sp.GetRequiredService<CatalogCacheInvalidation<TContext>>().Interceptors));
        return services;
    }
}

/// <summary>
/// Điểm chung xoá cache danh mục (TEST-245) cho một DbContext module — mọi đường ghi, không phải nhớ gọi tay:
/// <list type="bullet">
/// <item>SaveChanges: entity được khai báo ở <see cref="CatalogCacheRules"/> thêm / sửa / xoá → xoá tag SAU khi ghi (cả khi lỗi / huỷ).</item>
/// <item>ExecuteUpdate / ExecuteDelete / SQL thô (không qua ChangeTracker): câu <c>INSERT INTO / UPDATE / DELETE FROM / TRUNCATE</c>
///   vào bảng của entity đó → xoá tag sau khi chạy.</item>
/// <item>Đang trong transaction: xoá ngay VÀ xoá lần nữa khi commit / rollback — request khác đọc DB lúc transaction chưa commit
///   (thấy dữ liệu cũ) không giữ ảnh chụp cũ tới hết TTL.</item>
/// </list>
/// </summary>
public sealed class CatalogCacheInvalidation<TContext> where TContext : DbContext
{
    private readonly CatalogCache _cache;
    private readonly Dictionary<Type, string[]> _byEntity;
    private readonly ConditionalWeakTable<DbContext, HashSet<string>> _saving = new();
    private readonly ConditionalWeakTable<DbTransaction, HashSet<string>> _inTransaction = new();
    private (Regex Pattern, string[] Tags)[]? _tables;

    public CatalogCacheInvalidation(CatalogCache cache, CatalogCacheRules rules)
    {
        _cache = cache;
        _byEntity = rules.ByEntity;
        Interceptors = [new SaveChanges(this), new Commands(this), new Transactions(this)];
    }

    public IInterceptor[] Interceptors { get; }

    /// <summary>Tag cần xoá cho các thay đổi đang chờ ghi của context (tách riêng để unit test).</summary>
    public HashSet<string> TagsFor(DbContext context)
    {
        if (context.ChangeTracker.AutoDetectChangesEnabled) context.ChangeTracker.DetectChanges();
        var tags = new HashSet<string>();
        foreach (var e in context.ChangeTracker.Entries())
            if (e.State is (EntityState.Added or EntityState.Modified or EntityState.Deleted) && _byEntity.TryGetValue(e.Entity.GetType(), out var t))
                tags.UnionWith(t);
        return tags;
    }

    /// <summary>Tag cần xoá cho một câu SQL ghi trực tiếp (ExecuteUpdate / ExecuteDelete / SQL thô). Câu SELECT → rỗng.</summary>
    public HashSet<string> TagsForSql(DbContext context, string sql)
    {
        var tags = new HashSet<string>();
        if (sql.AsSpan().TrimStart().StartsWith("SELECT", StringComparison.OrdinalIgnoreCase)) return tags;
        foreach (var (pattern, t) in Tables(context))
            if (pattern.IsMatch(sql)) tags.UnionWith(t);
        return tags;
    }

    private (Regex Pattern, string[] Tags)[] Tables(DbContext context) => _tables ??= BuildTables(context);

    private (Regex Pattern, string[] Tags)[] BuildTables(DbContext context)
    {
        var result = new List<(Regex, string[])>();
        foreach (var (type, tags) in _byEntity)
        {
            if (context.Model.FindEntityType(type) is not { } entity || entity.GetTableName() is not { } table) continue;
            var schema = entity.GetSchema() ?? context.Model.GetDefaultSchema();
            var name = (schema is null ? "" : $@"""?{Regex.Escape(schema)}""?\s*\.\s*") + $@"""?{Regex.Escape(table)}""?";
            result.Add((new Regex(@"\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO|TRUNCATE(?:\s+TABLE)?)\s+(?:ONLY\s+)?" + name + @"(?![\w""])",
                RegexOptions.IgnoreCase | RegexOptions.CultureInvariant), tags));
        }
        return [.. result];
    }

    private void CollectSaving(DbContext? context)
    {
        if (context is not TContext) return;
        var tags = TagsFor(context);
        if (tags.Count == 0) return;
        var pending = _saving.GetValue(context, _ => []);
        lock (pending) pending.UnionWith(tags);
    }

    private ValueTask FlushSaving(DbContext? context)
    {
        if (context is null || !_saving.TryGetValue(context, out var pending)) return ValueTask.CompletedTask;
        _saving.Remove(context);
        string[] tags;
        lock (pending) tags = [.. pending];
        var tx = context.Database.CurrentTransaction is IInfrastructure<DbTransaction> t ? t.Instance : null;
        return Written(tags, tx);
    }

    private ValueTask CommandExecuted(DbCommand command, CommandEventData data)
    {
        if (data.Context is not TContext ctx) return ValueTask.CompletedTask;
        var tags = TagsForSql(ctx, command.CommandText);
        return tags.Count == 0 ? ValueTask.CompletedTask : Written(tags, command.Transaction);
    }

    private ValueTask Written(IReadOnlyCollection<string> tags, DbTransaction? tx)
    {
        if (tags.Count == 0) return ValueTask.CompletedTask;
        if (tx is not null)
        {
            var pending = _inTransaction.GetValue(tx, _ => []);
            lock (pending) pending.UnionWith(tags);
        }
        return _cache.InvalidateAsync(tags);
    }

    private ValueTask TransactionEnded(DbTransaction tx)
    {
        if (!_inTransaction.TryGetValue(tx, out var pending)) return ValueTask.CompletedTask;
        _inTransaction.Remove(tx);
        string[] tags;
        lock (pending) tags = [.. pending];
        return _cache.InvalidateAsync(tags);
    }

    private static void Wait(ValueTask t)
    {
        if (!t.IsCompletedSuccessfully) t.AsTask().GetAwaiter().GetResult();
    }

    private sealed class SaveChanges(CatalogCacheInvalidation<TContext> o) : SaveChangesInterceptor
    {
        public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
        {
            o.CollectSaving(eventData.Context);
            return result;
        }

        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            o.CollectSaving(eventData.Context);
            return ValueTask.FromResult(result);
        }

        public override int SavedChanges(SaveChangesCompletedEventData eventData, int result)
        {
            Wait(o.FlushSaving(eventData.Context));
            return result;
        }

        public override async ValueTask<int> SavedChangesAsync(SaveChangesCompletedEventData eventData, int result,
            CancellationToken cancellationToken = default)
        {
            await o.FlushSaving(eventData.Context);
            return result;
        }

        // Lỗi / huỷ giữa chừng vẫn xoá: thừa một lần đọc lại DB còn hơn giữ ảnh chụp có thể đã cũ.
        public override void SaveChangesFailed(DbContextErrorEventData eventData) => Wait(o.FlushSaving(eventData.Context));

        public override Task SaveChangesFailedAsync(DbContextErrorEventData eventData, CancellationToken cancellationToken = default) =>
            o.FlushSaving(eventData.Context).AsTask();

        public override void SaveChangesCanceled(DbContextEventData eventData) => Wait(o.FlushSaving(eventData.Context));

        public override Task SaveChangesCanceledAsync(DbContextEventData eventData, CancellationToken cancellationToken = default) =>
            o.FlushSaving(eventData.Context).AsTask();
    }

    private sealed class Commands(CatalogCacheInvalidation<TContext> o) : DbCommandInterceptor
    {
        public override int NonQueryExecuted(DbCommand command, CommandExecutedEventData eventData, int result)
        {
            Wait(o.CommandExecuted(command, eventData));
            return result;
        }

        public override async ValueTask<int> NonQueryExecutedAsync(DbCommand command, CommandExecutedEventData eventData, int result,
            CancellationToken cancellationToken = default)
        {
            await o.CommandExecuted(command, eventData);
            return result;
        }

        // UPDATE … RETURNING / FromSql ghi dữ liệu đi qua reader; câu SELECT bị bỏ qua ngay ở TagsForSql.
        public override DbDataReader ReaderExecuted(DbCommand command, CommandExecutedEventData eventData, DbDataReader result)
        {
            Wait(o.CommandExecuted(command, eventData));
            return result;
        }

        public override async ValueTask<DbDataReader> ReaderExecutedAsync(DbCommand command, CommandExecutedEventData eventData, DbDataReader result,
            CancellationToken cancellationToken = default)
        {
            await o.CommandExecuted(command, eventData);
            return result;
        }

        public override void CommandFailed(DbCommand command, CommandErrorEventData eventData) => Wait(o.CommandExecuted(command, eventData));

        public override Task CommandFailedAsync(DbCommand command, CommandErrorEventData eventData, CancellationToken cancellationToken = default) =>
            o.CommandExecuted(command, eventData).AsTask();
    }

    private sealed class Transactions(CatalogCacheInvalidation<TContext> o) : DbTransactionInterceptor
    {
        public override void TransactionCommitted(DbTransaction transaction, TransactionEndEventData eventData) => Wait(o.TransactionEnded(transaction));

        public override Task TransactionCommittedAsync(DbTransaction transaction, TransactionEndEventData eventData,
            CancellationToken cancellationToken = default) => o.TransactionEnded(transaction).AsTask();

        public override void TransactionRolledBack(DbTransaction transaction, TransactionEndEventData eventData) => Wait(o.TransactionEnded(transaction));

        public override Task TransactionRolledBackAsync(DbTransaction transaction, TransactionEndEventData eventData,
            CancellationToken cancellationToken = default) => o.TransactionEnded(transaction).AsTask();

        public override void TransactionFailed(DbTransaction transaction, TransactionErrorEventData eventData) => Wait(o.TransactionEnded(transaction));

        public override Task TransactionFailedAsync(DbTransaction transaction, TransactionErrorEventData eventData,
            CancellationToken cancellationToken = default) => o.TransactionEnded(transaction).AsTask();
    }
}
