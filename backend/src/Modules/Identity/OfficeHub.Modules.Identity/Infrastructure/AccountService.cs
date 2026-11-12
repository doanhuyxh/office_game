using System.Net;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.AspNetCore.Http;
using OfficeHub.BuildingBlocks.Auditing;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Email;
using OfficeHub.Modules.Identity.Contracts;
using OfficeHub.Modules.Identity.Domain;

namespace OfficeHub.Modules.Identity.Infrastructure;

internal sealed class AccountService(
    UserManager<AppUser> users,
    OfficeIdentityDbContext db,
    IEmailSender email,
    IOptions<AppSettings> app,
    TimeProvider clock,
    IChangeAuditSink audit,
    IHttpContextAccessor http,
    ILogger<AccountService> log) : IAccountService
{
    public async Task<AccountResult> CreateWithPasswordAsync(NewAccount a, string tempPassword, CancellationToken ct = default)
    {
        if (await ValidateNewAsync(a) is { } fail) return fail;
        var user = NewUser(a);
        user.MustChangePassword = true;
        var r = await users.CreateAsync(user, tempPassword);
        if (!r.Succeeded) return Fail(r);
        return await AssignRolesAsync(user, a.Roles);
    }

    public async Task<AccountResult> CreateInvitedAsync(NewAccount a, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(a.Email)) return AccountResult.Fail("Cần email để gửi lời mời");
        if (await ValidateNewAsync(a) is { } fail) return fail;
        var user = NewUser(a);
        var r = await users.CreateAsync(user); // chưa có mật khẩu
        if (!r.Succeeded) return Fail(r);
        return await AssignRolesAsync(user, a.Roles);
    }

    public async Task<AccountResult> SendInviteAsync(Guid userId, CancellationToken ct = default)
    {
        var user = await users.FindByIdAsync(userId.ToString());
        if (user is null) return AccountResult.Fail("Không tìm thấy tài khoản");
        if (await users.HasPasswordAsync(user)) return AccountResult.Fail("Tài khoản đã đặt mật khẩu, không cần mời lại");
        if (string.IsNullOrWhiteSpace(user.Email)) return AccountResult.Fail("Tài khoản không có email");
        try
        {
            await SendLinkAsync(user, invite: true, ct);
        }
        catch (Exception)
        {
            // SendLinkAsync đã ghi log chi tiết
            return AccountResult.FailWithCode(AccountErrors.EmailFailed, "Gửi email thất bại, kiểm tra cấu hình SMTP");
        }
        return AccountResult.Ok(user.Id);
    }

    public async Task<AccountResult> ResetToTempPasswordAsync(Guid userId, string tempPassword, CancellationToken ct = default)
    {
        var user = await users.FindByIdAsync(userId.ToString());
        if (user is null) return AccountResult.Fail("Không tìm thấy tài khoản");
        if (await users.HasPasswordAsync(user))
        {
            var removed = await users.RemovePasswordAsync(user);
            if (!removed.Succeeded) return Fail(removed);
        }
        var r = await users.AddPasswordAsync(user, tempPassword);
        if (!r.Succeeded) return Fail(r);
        user.MustChangePassword = true;
        await users.UpdateAsync(user);
        await users.SetLockoutEndDateAsync(user, null);
        await users.UpdateSecurityStampAsync(user); // đăng xuất mọi phiên cũ
        await AiAccessRevoker.RevokeAllAsync(db, user.Id, clock.GetUtcNow(), ct); // + token AI / ứng dụng OAuth
        return AccountResult.Ok(user.Id);
    }

    public async Task<AccountResult> SetRolesAsync(Guid userId, IReadOnlyCollection<string> roles, CancellationToken ct = default)
    {
        var user = await users.FindByIdAsync(userId.ToString());
        if (user is null) return AccountResult.Fail("Không tìm thấy tài khoản");
        var invalid = roles.Except(Roles.All).ToArray();
        if (invalid.Length > 0) return AccountResult.Fail($"Vai trò không hợp lệ: {string.Join(", ", invalid)}");
        var current = await users.GetRolesAsync(user);
        var remove = await users.RemoveFromRolesAsync(user, current.Except(roles));
        if (!remove.Succeeded) return Fail(remove);
        var add = await users.AddToRolesAsync(user, roles.Except(current));
        if (!add.Succeeded) return Fail(add);
        await users.UpdateSecurityStampAsync(user); // cookie cũ hết hiệu lực → nhận vai trò mới khi đăng nhập lại
        // user_roles là bảng nối của ASP.NET Identity (không gắn [Audited] được) → ghi lịch sử tay.
        var before = string.Join(", ", current.Order());
        var after = string.Join(", ", roles.Distinct().Order());
        if (before != after)
        {
            var (source, actorId, actorName) = AuditActor.From(http);
            audit.Enqueue(new ChangeRecord(clock.GetUtcNow(), source, actorId, actorName, OfficeIdentityDbContext.Schema, "AppUser", user.Id.ToString(),
                user.FullName, "Modified", [new FieldChange("Roles", before, after)]));
        }
        return AccountResult.Ok(user.Id);
    }

    public async Task<AccountResult> ResetTwoFactorAsync(Guid userId, CancellationToken ct = default)
    {
        var user = await users.FindByIdAsync(userId.ToString());
        if (user is null) return AccountResult.Fail("Không tìm thấy tài khoản");
        if (!user.TwoFactorEnabled && string.IsNullOrEmpty(await users.GetAuthenticatorKeyAsync(user)))
            return AccountResult.Fail("Tài khoản chưa bật xác thực 2 lớp");
        await users.ClearTwoFactorAsync(user); // TwoFactorEnabled → false được ghi lịch sử (AppUser [Audited])
        await users.SetLockoutEndDateAsync(user, null);
        await users.ResetAccessFailedCountAsync(user);
        await users.UpdateSecurityStampAsync(user); // đăng xuất mọi phiên cũ
        await AiAccessRevoker.RevokeAllAsync(db, user.Id, clock.GetUtcNow(), ct); // + token AI / ứng dụng OAuth
        return AccountResult.Ok(user.Id);
    }

    public async Task SetActiveAsync(Guid userId, bool active, CancellationToken ct = default)
    {
        var user = await users.FindByIdAsync(userId.ToString());
        if (user is null || user.IsActive == active) return;
        user.IsActive = active;
        await users.UpdateAsync(user);
        if (active) return;
        await users.UpdateSecurityStampAsync(user); // vô hiệu cookie đang dùng
        await AiAccessRevoker.RevokeAllAsync(db, user.Id, clock.GetUtcNow(), ct); // mở lại tài khoản không làm sống lại token cũ
    }

    public async Task<bool> SetBotAsync(Guid userId, bool isBot, CancellationToken ct = default)
    {
        var user = await users.FindByIdAsync(userId.ToString());
        if (user is null) return false;
        if (user.IsBot == isBot) return true;
        user.IsBot = isBot;
        await users.UpdateAsync(user);
        return true;
    }

    public async Task<AccountInfo?> GetAsync(Guid userId, CancellationToken ct = default) =>
        (await GetManyAsync([userId], ct)).GetValueOrDefault(userId);

    public async Task<IReadOnlyDictionary<Guid, AccountInfo>> GetManyAsync(IReadOnlyCollection<Guid> userIds, CancellationToken ct = default)
    {
        if (userIds.Count == 0) return new Dictionary<Guid, AccountInfo>();
        var list = await users.Users.Where(u => userIds.Contains(u.Id)).ToListAsync(ct);
        var result = new Dictionary<Guid, AccountInfo>();
        foreach (var u in list)
        {
            var roles = await users.GetRolesAsync(u);
            result[u.Id] = new AccountInfo(u.Id, u.UserName!, u.Email, [.. roles], u.IsActive, u.MustChangePassword,
                InvitePending: u.PasswordHash is null, u.LastLoginAt, u.FullName, u.TwoFactorEnabled, u.IsBot);
        }
        return result;
    }

    public async Task<IReadOnlyList<AccountInfo>> ListByRoleAsync(string role, CancellationToken ct = default)
    {
        var ids = (await users.GetUsersInRoleAsync(role)).Where(u => u.IsActive).Select(u => u.Id).ToList();
        return [.. (await GetManyAsync(ids, ct)).Values];
    }

    /// <summary>Gửi link đặt mật khẩu: dùng cho lời mời và quên mật khẩu (mời 72 giờ, quên mật khẩu 1 giờ — PasswordResetTokens).</summary>
    internal async Task SendLinkAsync(AppUser user, bool invite, CancellationToken ct)
    {
        // Mời: provider Default 72 giờ, mục đích riêng; quên mật khẩu: provider 1 giờ (PasswordResetTokens).
        var token = invite
            ? await users.GenerateUserTokenAsync(user, TokenOptions.DefaultProvider, PasswordResetTokens.InvitePurpose)
            : await users.GeneratePasswordResetTokenAsync(user);
        var path = invite ? "accept-invite" : "reset-password";
        var link = $"{app.Value.BaseUrl.TrimEnd('/')}/{path}?uid={user.Id}&token={Uri.EscapeDataString(token)}";
        var name = WebUtility.HtmlEncode(user.FullName);
        var (subject, intro) = invite
            ? ($"Lời mời tham gia {app.Value.Name}", $"Bạn được mời tham gia <b>{WebUtility.HtmlEncode(app.Value.Name)}</b>. Bấm nút dưới đây để đặt mật khẩu và đăng nhập.")
            : ($"Đặt lại mật khẩu {app.Value.Name}", "Bạn (hoặc ai đó) vừa yêu cầu đặt lại mật khẩu. Nếu không phải bạn, hãy bỏ qua email này.");
        var html = $"""
            <p>Xin chào {name},</p>
            <p>{intro}</p>
            <p><a href="{link}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#fff;border-radius:8px;text-decoration:none">
              {(invite ? "Đặt mật khẩu" : "Đặt lại mật khẩu")}</a></p>
            <p style="color:#64748b;font-size:13px">Link hết hạn sau {(invite ? "72 giờ" : "1 giờ")}. Tên đăng nhập của bạn: <b>{WebUtility.HtmlEncode(user.UserName)}</b></p>
            """;
        try
        {
            await email.SendAsync(user.Email!, user.FullName, subject, html, ct);
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Không gửi được email {Kind} tới {Email}", invite ? "mời" : "đặt lại mật khẩu", user.Email);
            throw;
        }
    }

    private async Task<AccountResult?> ValidateNewAsync(NewAccount a)
    {
        if (await users.FindByNameAsync(a.UserName) is not null) return AccountResult.Fail($"Tên đăng nhập '{a.UserName}' đã tồn tại");
        if (!string.IsNullOrWhiteSpace(a.Email) && await users.FindByEmailAsync(a.Email) is not null)
            return AccountResult.Fail($"Email '{a.Email}' đã có tài khoản");
        var invalid = a.Roles.Except(Roles.All).ToArray();
        return invalid.Length > 0 ? AccountResult.Fail($"Vai trò không hợp lệ: {string.Join(", ", invalid)}") : null;
    }

    private AppUser NewUser(NewAccount a) => new()
    {
        UserName = a.UserName.Trim(),
        Email = string.IsNullOrWhiteSpace(a.Email) ? null : a.Email.Trim(),
        FullName = a.FullName.Trim(),
        CreatedAt = clock.GetUtcNow(),
    };

    private async Task<AccountResult> AssignRolesAsync(AppUser user, IReadOnlyCollection<string> roles)
    {
        var r = await users.AddToRolesAsync(user, roles.Count > 0 ? roles : [Roles.Employee]);
        return r.Succeeded ? AccountResult.Ok(user.Id) : Fail(r);
    }

    private static AccountResult Fail(IdentityResult r) => AccountResult.Fail([.. r.Errors.Select(e => e.Description)]);
}
