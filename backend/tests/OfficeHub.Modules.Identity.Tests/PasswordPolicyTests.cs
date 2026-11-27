using Microsoft.AspNetCore.Identity;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.Modules.Identity.Domain;
using OfficeHub.Modules.Identity.Infrastructure;

namespace OfficeHub.Modules.Identity.Tests;

/// <summary>TEST-260: chính sách mật khẩu / khoá theo cấu hình Bảo mật.</summary>
public class PasswordPolicyTests
{
    [Fact]
    public void WithPolicy_overrides_password_and_lockout_keeps_rest()
    {
        var b = new IdentityOptions();
        b.User.RequireUniqueEmail = false;
        b.Tokens.PasswordResetTokenProvider = "custom";
        var o = AppUserManager.WithPolicy(b, new PasswordPolicySettings
        {
            MinLength = 12, RequireUppercase = true, RequireNonAlphanumeric = true, RequireDigit = false, MaxFailures = 7, BlockMinutes = 90,
        });
        Assert.Equal(12, o.Password.RequiredLength);
        Assert.True(o.Password.RequireUppercase);
        Assert.True(o.Password.RequireNonAlphanumeric);
        Assert.False(o.Password.RequireDigit);
        Assert.Equal(7, o.Lockout.MaxFailedAccessAttempts);
        Assert.Equal(TimeSpan.FromMinutes(90), o.Lockout.DefaultLockoutTimeSpan);
        Assert.Equal("custom", o.Tokens.PasswordResetTokenProvider);
        Assert.Same(b.ClaimsIdentity, o.ClaimsIdentity);
        Assert.Equal(6, b.Password.RequiredLength); // bản gốc (singleton) không bị sửa
    }

    [Theory]
    [InlineData(15, "15 phút")]
    [InlineData(60, "1 giờ")]
    [InlineData(90, "1 giờ 30 phút")]
    [InlineData(1440, "24 giờ")]
    public void Block_text(int minutes, string expected) =>
        Assert.Equal(expected, new PasswordPolicySettings { BlockMinutes = minutes }.BlockText);

    [Fact]
    public void Describe_lists_required_kinds()
    {
        Assert.Equal("tối thiểu 8 ký tự, có chữ số, chữ thường", new PasswordPolicySettings().Describe());
        Assert.Equal("tối thiểu 10 ký tự", new PasswordPolicySettings { MinLength = 10, RequireDigit = false, RequireLowercase = false }.Describe());
    }

    [Fact]
    public async Task Default_validator_uses_manager_options()
    {
        var policy = new PasswordPolicySettings { MinLength = 10, RequireUppercase = true, RequireNonAlphanumeric = true };
        var manager = new FakeManager(AppUserManager.WithPolicy(new IdentityOptions(), policy));
        var v = new PasswordValidator<AppUser>(new ViIdentityErrorDescriber());
        var bad = await v.ValidateAsync(manager, new AppUser(), "abc12345");
        Assert.Contains(bad.Errors, e => e.Code == "PasswordTooShort" && e.Description.Contains("10 ký tự"));
        Assert.Contains(bad.Errors, e => e.Code == "PasswordRequiresUpper");
        Assert.Contains(bad.Errors, e => e.Code == "PasswordRequiresNonAlphanumeric");
        Assert.True((await v.ValidateAsync(manager, new AppUser(), "Abcdef12!x")).Succeeded);
    }

    private sealed class FakeManager : UserManager<AppUser>
    {
        public FakeManager(IdentityOptions o) : base(new NullStore(), null!, null!, null!, null!, null!, null!, null!, null!) => Options = o;
    }

    private sealed class NullStore : IUserStore<AppUser>
    {
        public void Dispose() { }
        public Task<string> GetUserIdAsync(AppUser user, CancellationToken ct) => Task.FromResult(user.Id.ToString());
        public Task<string?> GetUserNameAsync(AppUser user, CancellationToken ct) => Task.FromResult(user.UserName);
        public Task SetUserNameAsync(AppUser user, string? userName, CancellationToken ct) => Task.CompletedTask;
        public Task<string?> GetNormalizedUserNameAsync(AppUser user, CancellationToken ct) => Task.FromResult(user.NormalizedUserName);
        public Task SetNormalizedUserNameAsync(AppUser user, string? normalizedName, CancellationToken ct) => Task.CompletedTask;
        public Task<IdentityResult> CreateAsync(AppUser user, CancellationToken ct) => Task.FromResult(IdentityResult.Success);
        public Task<IdentityResult> UpdateAsync(AppUser user, CancellationToken ct) => Task.FromResult(IdentityResult.Success);
        public Task<IdentityResult> DeleteAsync(AppUser user, CancellationToken ct) => Task.FromResult(IdentityResult.Success);
        public Task<AppUser?> FindByIdAsync(string userId, CancellationToken ct) => Task.FromResult<AppUser?>(null);
        public Task<AppUser?> FindByNameAsync(string normalizedUserName, CancellationToken ct) => Task.FromResult<AppUser?>(null);
    }
}
