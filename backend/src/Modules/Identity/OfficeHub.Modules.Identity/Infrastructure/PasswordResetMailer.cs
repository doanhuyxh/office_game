using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using OfficeHub.Modules.Identity.Domain;

namespace OfficeHub.Modules.Identity.Infrastructure;

/// <summary>
/// Gửi email quên mật khẩu ở nền (TEST-20, TEST-28): <c>/auth/forgot-password</c> chỉ ghi một dòng <see cref="PasswordResetRequest"/> rồi trả 204 ngay
/// (thời gian phản hồi như nhau dù email có tài khoản hay không). Job lấy dòng đến hạn bằng <c>FOR UPDATE SKIP LOCKED</c> (nhiều instance không
/// gửi trùng), lúc đó mới tạo token + gửi; SMTP lỗi → thử lại sau 1 / 5 / 15 phút; quá 1 giờ (link hết hạn) hoặc 4 lần → bỏ. Không mất khi khởi động lại.
/// </summary>
public sealed class PasswordResetMailer(IServiceScopeFactory scopes, TimeProvider clock, ILogger<PasswordResetMailer> log) : BackgroundService
{
    private static readonly TimeSpan Tick = TimeSpan.FromSeconds(3);
    /// <summary>Đang gửi thì đẩy hạn lên chừng này (instance gửi chết giữa chừng → dòng tự hiện lại).</summary>
    private static readonly TimeSpan Lease = TimeSpan.FromMinutes(2);
    private static readonly TimeSpan[] Backoff = [TimeSpan.FromMinutes(1), TimeSpan.FromMinutes(5), TimeSpan.FromMinutes(15)];
    public const int MaxAttempts = 4;

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        using var timer = new PeriodicTimer(Tick);
        do
        {
            try { await RunOnceAsync(stop); }
            catch (Exception ex) when (!stop.IsCancellationRequested) { log.LogError(ex, "Lỗi hàng đợi email quên mật khẩu"); }
        } while (await timer.WaitForNextTickAsync(stop));
    }

    public async Task<int> RunOnceAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<OfficeIdentityDbContext>();
        var now = clock.GetUtcNow();
        // Dọn: yêu cầu > 1 giờ (link đặt lại đã hết hạn) mà chưa gửi được → bỏ; dòng đã xong > 1 ngày → xoá.
        await db.PasswordResetRequests.Where(r => r.NextAttemptAt != null && r.CreatedAt < now - PasswordResetTokens.ResetLifetime)
            .ExecuteUpdateAsync(s => s.SetProperty(r => r.NextAttemptAt, (DateTimeOffset?)null).SetProperty(r => r.Error, "Bỏ: quá hạn link 1 giờ"), ct);
        await db.PasswordResetRequests.Where(r => r.NextAttemptAt == null && r.CreatedAt < now.AddDays(-1)).ExecuteDeleteAsync(ct);

        // Nhận việc: đẩy hạn các dòng đến hạn lên (Lease) trong cùng câu lệnh → instance khác không lấy trùng.
        var leaseUntil = now + Lease;
        var claimed = await db.Database.SqlQuery<Guid>($"""
            UPDATE identity.password_reset_requests SET "NextAttemptAt" = {leaseUntil}
            WHERE "Id" IN (SELECT "Id" FROM identity.password_reset_requests WHERE "NextAttemptAt" <= {now}
                           ORDER BY "NextAttemptAt" LIMIT 10 FOR UPDATE SKIP LOCKED)
            RETURNING "Id" AS "Value"
            """).ToListAsync(ct);
        foreach (var id in claimed)
        {
            var r = await db.PasswordResetRequests.FirstAsync(x => x.Id == id, ct);
            r.Attempts++;
            try
            {
                var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
                var user = await users.FindByIdAsync(r.UserId.ToString());
                if (user is { IsActive: true, Email: not null })
                    await scope.ServiceProvider.GetRequiredService<AccountService>().SendLinkAsync(user, invite: false, ct);
                (r.SentAt, r.NextAttemptAt, r.Error) = (clock.GetUtcNow(), null, null);
            }
            catch (Exception ex) when (!ct.IsCancellationRequested)
            {
                r.Error = ex.Message.Length > 500 ? ex.Message[..500] : ex.Message;
                r.NextAttemptAt = r.Attempts >= MaxAttempts ? null : clock.GetUtcNow() + Backoff[Math.Min(r.Attempts - 1, Backoff.Length - 1)];
                log.LogWarning("Gửi email quên mật khẩu lỗi (lần {Attempt}/{Max}): {Error}", r.Attempts, MaxAttempts, r.Error);
            }
            await db.SaveChangesAsync(ct);
        }
        return claimed.Count;
    }
}

/// <summary>
/// Link quên mật khẩu sống 1 giờ (<see cref="PasswordResetTokens.ResetProvider"/>), link mời 72 giờ (provider "Default", mục đích
/// <see cref="PasswordResetTokens.InvitePurpose"/>) — hai loại token khác khoá bảo vệ nên không dùng lẫn được.
/// </summary>
public static class PasswordResetTokens
{
    public const string ResetProvider = "PasswordReset1h";
    public const string InvitePurpose = "Invite";
    public static readonly TimeSpan ResetLifetime = TimeSpan.FromHours(1);
}

public sealed class ResetTokenProviderOptions : DataProtectionTokenProviderOptions
{
    public ResetTokenProviderOptions()
    {
        Name = PasswordResetTokens.ResetProvider;
        TokenLifespan = PasswordResetTokens.ResetLifetime;
    }
}

public sealed class ResetTokenProvider(IDataProtectionProvider dp, IOptions<ResetTokenProviderOptions> options, ILogger<DataProtectorTokenProvider<AppUser>> logger)
    : DataProtectorTokenProvider<AppUser>(dp, options, logger);
