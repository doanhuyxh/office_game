using Microsoft.EntityFrameworkCore;

namespace OfficeHub.Modules.Identity.Infrastructure;

/// <summary>
/// Thu hồi MỌI kết nối AI của một tài khoản: token cá nhân (PAT), access token OAuth và grant OAuth (refresh token).
/// Gọi khi đổi / đặt lại mật khẩu, HR cấp mật khẩu tạm, đặt lại 2FA, khoá tài khoản — cookie thì đã hết hiệu lực nhờ đổi security stamp,
/// nhưng token AI không gắn với stamp (stamp đổi cả mỗi lần đăng nhập vì "mỗi lúc 1 thiết bị") nên phải thu hồi riêng.
/// </summary>
internal static class AiAccessRevoker
{
    /// <remarks>ExecuteUpdate không qua SaveChanges → tự xoá cache xác thực của user (mọi token của user mang tag user — TEST-244).</remarks>
    public static async Task<int> RevokeAllAsync(OfficeIdentityDbContext db, AuthCacheInvalidator cache, Guid userId, DateTimeOffset now,
        CancellationToken ct = default)
    {
        var tokens = await db.AccessTokens.Where(t => t.UserId == userId && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now), ct);
        var grants = await db.OAuthGrants.Where(g => g.UserId == userId && g.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(g => g.RevokedAt, now), ct);
        await cache.InvalidateUserAsync(userId);
        return tokens + grants;
    }
}
