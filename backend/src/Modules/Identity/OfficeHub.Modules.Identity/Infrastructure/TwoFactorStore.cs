using Microsoft.AspNetCore.Identity;
using OfficeHub.Modules.Identity.Domain;

namespace OfficeHub.Modules.Identity.Infrastructure;

internal static class TwoFactorStore
{
    /// <summary>
    /// Tắt 2FA + xoá khoá TOTP và mã dự phòng (identity.user_tokens) — dùng chung cho tự tắt và HR đặt lại. Đổi security stamp.
    /// Khoá / mã nằm ở user_tokens (không [Audited]) nên không bao giờ vào nhật ký; chỉ TwoFactorEnabled của AppUser được ghi lịch sử.
    /// </summary>
    public static async Task ClearTwoFactorAsync(this UserManager<AppUser> users, AppUser user)
    {
        await users.SetTwoFactorEnabledAsync(user, false);
        await users.RemoveAuthenticationTokenAsync(user, TwoFactorRules.StoreProvider, TwoFactorRules.AuthenticatorKeyName);
        await users.RemoveAuthenticationTokenAsync(user, TwoFactorRules.StoreProvider, TwoFactorRules.RecoveryCodesName);
    }
}
