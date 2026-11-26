using System.Runtime.CompilerServices;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using OfficeHub.Modules.Identity.Domain;

namespace OfficeHub.Modules.Identity.Infrastructure;

/// <summary>
/// Điểm chung xoá cache xác thực (TEST-244): mọi SaveChanges của <see cref="OfficeIdentityDbContext"/> có thêm / sửa / xoá
/// users (security stamp, khoá, lockout, 2FA, mật khẩu tạm, họ tên…), user_roles, user_claims, access_tokens, oauth_grants
/// → xoá cache của user / token / grant đó SAU khi ghi xong; roles / role_claims → xoá toàn bộ cache xác thực.
/// UserManager (UpdateSecurityStampAsync, ChangePasswordAsync, AddToRoleAsync, AccessFailedAsync, SetLockoutEndDateAsync…) đều đi qua đây,
/// nên chỗ mới đổi stamp sau này không phải nhớ xoá cache. Ngoại lệ: <c>ExecuteUpdate</c> / <c>ExecuteDelete</c> không qua SaveChanges
/// → nơi gọi phải tự <see cref="AuthCacheInvalidator.InvalidateAsync"/> (xem AiAccessRevoker, OAuthEndpoints).
/// </summary>
public sealed class AuthCacheSaveChangesInterceptor(AuthCacheInvalidator invalidator) : SaveChangesInterceptor
{
    private readonly ConditionalWeakTable<DbContext, HashSet<string>> _pending = new();

    public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
    {
        Collect(eventData.Context);
        return result;
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        Collect(eventData.Context);
        return ValueTask.FromResult(result);
    }

    public override int SavedChanges(SaveChangesCompletedEventData eventData, int result)
    {
        Flush(eventData.Context).AsTask().GetAwaiter().GetResult();
        return result;
    }

    public override async ValueTask<int> SavedChangesAsync(SaveChangesCompletedEventData eventData, int result,
        CancellationToken cancellationToken = default)
    {
        await Flush(eventData.Context);
        return result;
    }

    // Lỗi giữa chừng vẫn xoá: thừa một lần đọc lại DB còn hơn giữ ảnh chụp có thể đã cũ.
    public override void SaveChangesFailed(DbContextErrorEventData eventData) => Flush(eventData.Context).AsTask().GetAwaiter().GetResult();

    public override Task SaveChangesFailedAsync(DbContextErrorEventData eventData, CancellationToken cancellationToken = default) =>
        Flush(eventData.Context).AsTask();

    public override void SaveChangesCanceled(DbContextEventData eventData) => Flush(eventData.Context).AsTask().GetAwaiter().GetResult();

    public override Task SaveChangesCanceledAsync(DbContextEventData eventData, CancellationToken cancellationToken = default) =>
        Flush(eventData.Context).AsTask();

    /// <summary>Tag cần xoá cho các thay đổi đang chờ ghi (tách riêng để unit test).</summary>
    public static HashSet<string> TagsFor(DbContext context)
    {
        if (context.ChangeTracker.AutoDetectChangesEnabled) context.ChangeTracker.DetectChanges();
        var tags = new HashSet<string>();
        foreach (var e in context.ChangeTracker.Entries())
        {
            if (e.State is not (EntityState.Added or EntityState.Modified or EntityState.Deleted)) continue;
            switch (e.Entity)
            {
                case AppUser u: tags.Add(AuthCacheTags.User(u.Id)); break;
                case IdentityUserRole<Guid> ur: tags.Add(AuthCacheTags.User(ur.UserId)); break;
                case IdentityUserClaim<Guid> uc: tags.Add(AuthCacheTags.User(uc.UserId)); break;
                case IdentityRole<Guid> or IdentityRoleClaim<Guid>: tags.Add(AuthCacheTags.All); break;
                case AccessToken t when e.State != EntityState.Added: tags.Add(AuthCacheTags.Token(t.Id)); break;
                case OAuthGrant g when e.State != EntityState.Added: tags.Add(AuthCacheTags.Grant(g.Id)); break;
            }
        }
        return tags;
    }

    private void Collect(DbContext? context)
    {
        if (context is not OfficeIdentityDbContext) return;
        var tags = TagsFor(context);
        if (tags.Count == 0) return;
        var pending = _pending.GetValue(context, _ => []);
        lock (pending) pending.UnionWith(tags);
    }

    private ValueTask Flush(DbContext? context)
    {
        if (context is null || !_pending.TryGetValue(context, out var pending)) return ValueTask.CompletedTask;
        _pending.Remove(context);
        string[] tags;
        lock (pending) tags = [.. pending];
        return invalidator.InvalidateAsync(tags);
    }
}
