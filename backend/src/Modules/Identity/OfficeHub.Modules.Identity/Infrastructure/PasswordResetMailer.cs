using System.Threading.Channels;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using OfficeHub.Modules.Identity.Domain;

namespace OfficeHub.Modules.Identity.Infrastructure;

/// <summary>
/// Gửi email quên mật khẩu ở nền (TEST-20): <c>/auth/forgot-password</c> trả 204 ngay, không chờ SMTP → thời gian phản hồi như nhau
/// dù email có tài khoản hay không. Hàng đợi trong RAM (tối đa 100, đầy thì bỏ) — mất khi khởi động lại, người dùng bấm gửi lại.
/// </summary>
public sealed class PasswordResetMailer(IServiceScopeFactory scopes, ILogger<PasswordResetMailer> log) : BackgroundService
{
    private readonly Channel<Guid> _queue = Channel.CreateBounded<Guid>(new BoundedChannelOptions(100) { FullMode = BoundedChannelFullMode.DropWrite });

    public bool Enqueue(Guid userId) => _queue.Writer.TryWrite(userId);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var userId in _queue.Reader.ReadAllAsync(stoppingToken))
        {
            try
            {
                using var scope = scopes.CreateScope();
                var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
                var user = await users.FindByIdAsync(userId.ToString());
                if (user is { IsActive: true, Email: not null })
                    await scope.ServiceProvider.GetRequiredService<AccountService>().SendLinkAsync(user, invite: false, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
            catch (Exception ex) { log.LogError(ex, "Gửi email quên mật khẩu thất bại"); }
        }
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
