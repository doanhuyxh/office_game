using System.Collections;
using System.Globalization;
using System.Runtime.CompilerServices;
using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;

namespace OfficeHub.BuildingBlocks.Auditing;

/// <summary>Gắn lên entity cần ghi lịch sử sửa (ai, lúc nào, trường nào đổi từ gì sang gì). Interceptor tự bắt khi SaveChanges.</summary>
[AttributeUsage(AttributeTargets.Class)]
public sealed class AuditedAttribute : Attribute;

/// <summary>Trường bí mật: chỉ ghi "đã đổi", không ghi giá trị. Tên kết thúc bằng Encrypted / Hash tự động được che.</summary>
[AttributeUsage(AttributeTargets.Property)]
public sealed class AuditMaskAttribute : Attribute;

public sealed record FieldChange(string Field, string? Old, string? New, bool Masked = false);

/// <param name="Source">"web" | "ai" (token AI / MCP) | "system" (job nền, không có người dùng).</param>
/// <param name="Action">"Added" | "Modified" | "Deleted" (xoá mềm = Modified với DeletedAt).</param>
public sealed record ChangeRecord(DateTimeOffset OccurredAt, string Source, Guid? UserId, string? UserName, string Module, string Entity,
    string EntityId, string? EntityLabel, string Action, IReadOnlyList<FieldChange> Changes);

/// <summary>Nơi nhận bản ghi thay đổi (module Audit cài đặt: hàng đợi → ghi DB nền). Mặc định: bỏ qua.</summary>
public interface IChangeAuditSink
{
    void Enqueue(ChangeRecord record);
}

public sealed class NullChangeAuditSink : IChangeAuditSink
{
    public void Enqueue(ChangeRecord record) { }
}

/// <summary>Người đang thao tác (từ HttpContext) cho bản ghi thay đổi — dùng cả khi module tự ghi (vd đổi vai trò).</summary>
public static class AuditActor
{
    public static (string Source, Guid? UserId, string? UserName) From(IHttpContextAccessor? http)
    {
        var user = http?.HttpContext?.User;
        if (user?.Identity?.IsAuthenticated != true) return ("system", null, null);
        return (user.IsAccessToken() ? "ai" : "web", user.GetUserId(), user.FindFirstValue(ClaimNames.FullName) ?? user.Identity?.Name);
    }
}

/// <summary>
/// Bắt thay đổi của entity có [Audited] khi SaveChanges: chụp giá trị cũ / mới TRƯỚC khi lưu, chỉ gửi sang sink SAU khi lưu thành công.
/// Bỏ qua entity owned (file đính kèm), các trường kỹ thuật (CreatedAt, UpdatedAt, …) và bản sửa chỉ đổi trường kỹ thuật.
/// </summary>
public sealed class AuditSaveChangesInterceptor(IServiceProvider sp, TimeProvider clock) : SaveChangesInterceptor
{
    private static readonly HashSet<string> Ignored =
    [
        "CreatedAt", "UpdatedAt", "LastUsedAt", "LastLoginAt", "Reminded30At", "Reminded7At", "AccessFailedCount", "LockoutEnd",
        "ConcurrencyStamp", "SecurityStamp", "NormalizedEmail", "NormalizedUserName",
    ];
    private static readonly string[] LabelProps = ["FullName", "Name", "Number", "Title", "Code", "UserName"];
    private readonly ConditionalWeakTable<DbContext, List<ChangeRecord>> _pending = new();

    public override InterceptionResult<int> SavingChanges(DbContextEventData e, InterceptionResult<int> result)
    {
        Capture(e.Context);
        return result;
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData e, InterceptionResult<int> result, CancellationToken ct = default)
    {
        Capture(e.Context);
        return ValueTask.FromResult(result);
    }

    public override int SavedChanges(SaveChangesCompletedEventData e, int result) { Flush(e.Context); return result; }

    public override ValueTask<int> SavedChangesAsync(SaveChangesCompletedEventData e, int result, CancellationToken ct = default)
    {
        Flush(e.Context);
        return ValueTask.FromResult(result);
    }

    public override void SaveChangesFailed(DbContextErrorEventData e) { if (e.Context is { } c) _pending.Remove(c); }

    public override Task SaveChangesFailedAsync(DbContextErrorEventData e, CancellationToken ct = default)
    {
        if (e.Context is { } c) _pending.Remove(c);
        return Task.CompletedTask;
    }

    private void Capture(DbContext? ctx)
    {
        if (ctx is null) return;
        var (source, userId, userName) = AuditActor.From(sp.GetService<IHttpContextAccessor>());
        var module = ctx.Model.GetDefaultSchema() ?? ctx.GetType().Name;
        var now = clock.GetUtcNow();
        var list = new List<ChangeRecord>();
        foreach (var entry in ctx.ChangeTracker.Entries())
        {
            if (entry.State is not (EntityState.Added or EntityState.Modified or EntityState.Deleted)) continue;
            if (entry.Metadata.IsOwned() || !Attribute.IsDefined(entry.Entity.GetType(), typeof(AuditedAttribute))) continue;
            var changes = Changes(entry);
            if (entry.State == EntityState.Modified && changes.Count == 0) continue;
            list.Add(new ChangeRecord(now, source, userId, userName, module, entry.Metadata.ClrType.Name, Key(entry), Label(entry),
                entry.State.ToString(), changes));
        }
        if (list.Count > 0) _pending.AddOrUpdate(ctx, list);
    }

    private void Flush(DbContext? ctx)
    {
        if (ctx is null || !_pending.TryGetValue(ctx, out var list)) return;
        _pending.Remove(ctx);
        var sink = sp.GetService<IChangeAuditSink>();
        if (sink is null) return;
        foreach (var r in list) sink.Enqueue(r);
    }

    internal static List<FieldChange> Changes(EntityEntry entry)
    {
        var result = new List<FieldChange>();
        foreach (var p in entry.Properties)
        {
            var name = p.Metadata.Name;
            if (Ignored.Contains(name) || p.Metadata.IsShadowProperty() || p.Metadata.IsPrimaryKey()) continue;
            var masked = name.EndsWith("Encrypted", StringComparison.Ordinal) || name.EndsWith("Hash", StringComparison.Ordinal)
                         || p.Metadata.PropertyInfo?.IsDefined(typeof(AuditMaskAttribute), true) == true;
            var (oldV, newV) = entry.State switch
            {
                EntityState.Added => (null, Format(p.CurrentValue)),
                EntityState.Deleted => (Format(p.OriginalValue), null),
                _ => (Format(p.OriginalValue), Format(p.CurrentValue)),
            };
            if (oldV == newV) continue;
            if (entry.State == EntityState.Added && newV is null) continue;
            result.Add(masked ? new FieldChange(name, oldV is null ? null : "•••", newV is null ? null : "•••", Masked: true) : new FieldChange(name, oldV, newV));
        }
        return result;
    }

    internal static string? Format(object? v) => v switch
    {
        null => null,
        string s => s.Length > 500 ? s[..500] + "…" : s,
        DateTimeOffset d => Instants.Format(d),
        DateOnly d => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        TimeOnly t => t.ToString("HH:mm", CultureInfo.InvariantCulture),
        DateTime d => d.ToString("O", CultureInfo.InvariantCulture),
        bool b => b ? "true" : "false",
        IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
        IEnumerable e => string.Join(", ", e.Cast<object?>().Select(x => x?.ToString())),
        _ => v.ToString(),
    };

    private static string Key(EntityEntry entry) =>
        string.Join("|", entry.Metadata.FindPrimaryKey()?.Properties.Select(p => Format(entry.Property(p.Name).CurrentValue)) ?? []);

    private static string? Label(EntityEntry entry)
    {
        foreach (var name in LabelProps)
        {
            var p = entry.Metadata.FindProperty(name);
            if (p is null) continue;
            var prop = entry.Property(name);
            if ((entry.State == EntityState.Deleted ? prop.OriginalValue : prop.CurrentValue) is string { Length: > 0 } s) return s;
        }
        return null;
    }
}
