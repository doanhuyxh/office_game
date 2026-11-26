using System.Collections.Concurrent;
using System.ComponentModel;
using System.Diagnostics;
using System.Security.Claims;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Hybrid;
using OfficeHub.Modules.Identity.Domain;

namespace OfficeHub.Modules.Identity.Infrastructure;

/// <summary>
/// Cache xác thực trong RAM (TEST-244): "ảnh chụp" tài khoản theo userId (cookie + token AI dùng chung) và token AI theo hash.
/// Thay cho việc đọc users / user_claims / user_roles / roles / role_claims / access_tokens / oauth_grants ở MỌI request.
/// <para>An toàn: mọi chỗ đổi trạng thái tài khoản / token xoá cache NGAY (<see cref="AuthCacheInvalidator"/>, gọi từ
/// <see cref="AuthCacheSaveChangesInterceptor"/> cho mọi SaveChanges và tường minh ở các câu ExecuteUpdate) → đăng xuất, khoá,
/// đổi vai trò, thu hồi token có hiệu lực ở request kế tiếp. <see cref="Ttl"/> chỉ là lưới an toàn.</para>
/// ⚠ Chỉ đúng khi chạy MỘT bản Api: xoá cache không tới tiến trình khác (≥ 2 bản → làm B3: Redis + phát lệnh xoá).
/// </summary>
public static class AuthCacheTags
{
    /// <summary>Gắn cho mọi mục cache xác thực — đổi vai trò (bảng roles / role_claims) thì xoá hết.</summary>
    public const string All = "identity";
    /// <summary>Gắn cho mọi ảnh chụp token — thu hồi OAuth theo refresh token / mã dùng lại (không biết token nào) thì xoá hết token.</summary>
    public const string Tokens = "identity:tokens";
    public static string User(Guid userId) => $"user:{userId}";
    public static string Token(Guid tokenId) => $"token:{tokenId}";
    public static string Grant(Guid grantId) => $"grant:{grantId}";

    public static string UserKey(Guid userId) => $"identity:user:{userId}";
    public static string TokenKey(string tokenHash) => $"identity:token:{tokenHash}";
}

public sealed record CachedClaim(string Type, string Value);

/// <summary>Ảnh chụp xác thực của một tài khoản. <see cref="Claims"/> = đúng các claim <c>AppClaimsFactory</c> dựng (gồm security stamp, vai trò).</summary>
[ImmutableObject(true)]
public sealed record UserAuthSnapshot(
    Guid UserId, string? SecurityStamp, bool IsActive, bool MustChangePassword, bool LockoutEnabled, DateTimeOffset? LockoutEnd,
    bool TwoFactorEnabled, IReadOnlyList<string> Roles, IReadOnlyList<CachedClaim> Claims, long LoadedAt)
{
    public bool IsLockedOut(DateTimeOffset now) => LockoutEnabled && LockoutEnd is { } end && end > now;

    public IEnumerable<string> Tags => [AuthCacheTags.All, AuthCacheTags.User(UserId)];

    public ClaimsIdentity ToIdentity(string authenticationType, string nameType, string roleType) =>
        new(Claims.Select(c => new Claim(c.Type, c.Value)), authenticationType, nameType, roleType);

    public static UserAuthSnapshot From(AppUser user, ClaimsPrincipal principal, string roleClaimType, long loadedAt) =>
        new(user.Id, user.SecurityStamp, user.IsActive, user.MustChangePassword, user.LockoutEnabled, user.LockoutEnd, user.TwoFactorEnabled,
            principal.FindAll(roleClaimType).Select(c => c.Value).ToArray(),
            principal.Claims.Select(c => new CachedClaim(c.Type, c.Value)).ToArray(), loadedAt);
}

/// <summary>Ảnh chụp token AI (PAT hoặc access token OAuth) theo hash. Không chứa token rõ.</summary>
[ImmutableObject(true)]
public sealed record TokenAuthSnapshot(
    Guid TokenId, Guid UserId, string Name, DateTimeOffset ExpiresAt, DateTimeOffset? RevokedAt, Guid? GrantId, bool GrantRevoked,
    DateTimeOffset? LastUsedAt, long LoadedAt)
{
    public bool IsUsable(DateTimeOffset now) => RevokedAt is null && ExpiresAt > now;

    public IEnumerable<string> Tags => GrantId is { } g
        ? [AuthCacheTags.All, AuthCacheTags.Tokens, AuthCacheTags.User(UserId), AuthCacheTags.Token(TokenId), AuthCacheTags.Grant(g)]
        : [AuthCacheTags.All, AuthCacheTags.Tokens, AuthCacheTags.User(UserId), AuthCacheTags.Token(TokenId)];
}

/// <summary>
/// Xoá cache xác thực (singleton). Ngoài <c>HybridCache.RemoveByTagAsync</c> còn ghi mốc xoá theo tag: ảnh chụp được đọc từ DB
/// TRƯỚC mốc đó (factory chạy song song với thay đổi — đọc dữ liệu cũ rồi ghi vào cache sau khi đã xoá) bị coi là cũ và đọc lại.
/// Mốc dùng <see cref="Stopwatch.GetTimestamp"/> (đơn điệu, không phụ thuộc giờ hệ thống).
/// </summary>
public sealed class AuthCacheInvalidator(HybridCache cache)
{
    /// <summary>Mốc xoá cũ hơn khoảng này không còn ý nghĩa (mục cache đã hết hạn) → dọn để từ điển không phình.</summary>
    private static readonly long PruneAfter = (long)(AuthCache.Ttl.TotalSeconds * 2 * Stopwatch.Frequency);
    private const int PruneThreshold = 4096;
    private readonly ConcurrentDictionary<string, long> _invalidatedAt = new();

    public static long Now() => Stopwatch.GetTimestamp();

    public async ValueTask InvalidateAsync(IReadOnlyCollection<string> tags, CancellationToken ct = default)
    {
        if (tags.Count == 0) return;
        var now = Now();
        foreach (var tag in tags) _invalidatedAt[tag] = now;
        if (_invalidatedAt.Count > PruneThreshold) Prune(now);
        // Không truyền ct của request: đã ghi DB thì phải xoá cache dù client ngắt kết nối.
        await cache.RemoveByTagAsync(tags, CancellationToken.None);
    }

    public ValueTask InvalidateUserAsync(Guid userId) => InvalidateAsync([AuthCacheTags.User(userId)]);

    /// <summary>true = ảnh chụp đọc từ DB không muộn hơn lần xoá gần nhất của một tag của nó → không dùng.</summary>
    public bool IsStale(long loadedAt, IEnumerable<string> tags)
    {
        foreach (var tag in tags)
            if (_invalidatedAt.TryGetValue(tag, out var at) && loadedAt <= at) return true;
        return false;
    }

    /// <summary>Chỉ cho cache đọc lại một khoá (vd sau khi ghi LastUsedAt) — không phải thu hồi.</summary>
    public ValueTask RemoveKeyAsync(string key) => cache.RemoveAsync(key, CancellationToken.None);

    private void Prune(long now)
    {
        foreach (var (tag, at) in _invalidatedAt)
            if (now - at > PruneAfter) _invalidatedAt.TryRemove(new KeyValuePair<string, long>(tag, at));
    }
}

/// <summary>Đọc ảnh chụp xác thực qua cache (scoped — factory dùng UserManager / DbContext của request).</summary>
public sealed class AuthCache(
    HybridCache cache, AuthCacheInvalidator invalidator, UserManager<AppUser> users, IUserClaimsPrincipalFactory<AppUser> principals,
    OfficeIdentityDbContext db)
{
    /// <summary>Lưới an toàn: ảnh chụp sống tối đa 60 giây kể cả khi lỡ một chỗ quên xoá cache.</summary>
    public static readonly TimeSpan Ttl = TimeSpan.FromSeconds(60);
    private const int MaxAttempts = 3;

    private static readonly HybridCacheEntryOptions Entry = new()
    {
        Expiration = Ttl,
        LocalCacheExpiration = Ttl,
        Flags = HybridCacheEntryFlags.DisableDistributedCache,
    };

    /// <summary>null = không có tài khoản (không lưu kết quả rỗng vào cache).</summary>
    public async Task<UserAuthSnapshot?> GetUserAsync(Guid userId, CancellationToken ct = default)
    {
        var key = AuthCacheTags.UserKey(userId);
        string[] tags = [AuthCacheTags.All, AuthCacheTags.User(userId)];
        for (var i = 0; i < MaxAttempts; i++)
        {
            var snap = await cache.GetOrCreateAsync(key, (self: this, userId),
                static async (s, c) => await s.self.LoadUserAsync(s.userId, c), Entry, tags, ct);
            if (snap is null) { await cache.RemoveAsync(key, CancellationToken.None); return null; }
            if (!invalidator.IsStale(snap.LoadedAt, snap.Tags)) return snap;
            await cache.RemoveAsync(key, CancellationToken.None);
        }
        return await LoadUserAsync(userId, ct); // bị xoá liên tục → đọc thẳng DB, không cache
    }

    /// <summary>null = không có token với hash này (không lưu kết quả rỗng → chuỗi ngẫu nhiên không làm phình cache).</summary>
    public async Task<TokenAuthSnapshot?> GetTokenAsync(string tokenHash, CancellationToken ct = default)
    {
        var key = AuthCacheTags.TokenKey(tokenHash);
        for (var i = 0; i < MaxAttempts; i++)
        {
            // Tag theo user / token / grant chỉ biết sau khi đọc → không truyền ở đây; độ tươi do IsStale(snap.Tags) đảm bảo,
            // HybridCache chỉ cần tag chung để RemoveByTag xoá khỏi RAM.
            var snap = await cache.GetOrCreateAsync(key, (self: this, tokenHash),
                static async (s, c) => await s.self.LoadTokenAsync(s.tokenHash, c), Entry, [AuthCacheTags.All, AuthCacheTags.Tokens], ct);
            if (snap is null) { await cache.RemoveAsync(key, CancellationToken.None); return null; }
            if (!invalidator.IsStale(snap.LoadedAt, snap.Tags)) return snap;
            await cache.RemoveAsync(key, CancellationToken.None);
        }
        return await LoadTokenAsync(tokenHash, ct);
    }

    private async Task<UserAuthSnapshot?> LoadUserAsync(Guid userId, CancellationToken ct)
    {
        var loadedAt = AuthCacheInvalidator.Now(); // lấy mốc TRƯỚC khi đọc DB
        var user = await users.FindByIdAsync(userId.ToString());
        if (user is null) return null;
        var principal = await principals.CreateAsync(user);
        return UserAuthSnapshot.From(user, principal, users.Options.ClaimsIdentity.RoleClaimType, loadedAt);
    }

    private async Task<TokenAuthSnapshot?> LoadTokenAsync(string tokenHash, CancellationToken ct)
    {
        var loadedAt = AuthCacheInvalidator.Now();
        return await db.AccessTokens.AsNoTracking()
            .Where(t => t.TokenHash == tokenHash)
            .Select(t => new TokenAuthSnapshot(t.Id, t.UserId, t.Name, t.ExpiresAt, t.RevokedAt, t.GrantId,
                t.GrantId != null && !db.OAuthGrants.Any(g => g.Id == t.GrantId && g.RevokedAt == null),
                t.LastUsedAt, loadedAt))
            .FirstOrDefaultAsync(ct);
    }
}
