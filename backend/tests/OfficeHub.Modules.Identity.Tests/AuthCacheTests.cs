using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Hosting.Internal;
using OfficeHub.BuildingBlocks.Configuration;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Caching;
using OfficeHub.Modules.Identity.Domain;
using OfficeHub.Modules.Identity.Infrastructure;

namespace OfficeHub.Modules.Identity.Tests;

/// <summary>
/// Cache xác thực (TEST-244): đọc lần 2 lấy từ cache; đổi stamp / vai trò / khoá / mật khẩu tạm / thu hồi token → xoá cache ngay
/// (interceptor SaveChanges), ảnh chụp đọc từ DB trước lần xoá bị bỏ. DB = EF InMemory (ExecuteUpdate không hỗ trợ → e2e).
/// </summary>
public sealed class AuthCacheTests : IAsyncLifetime
{
    private ServiceProvider _sp = null!;
    private AppUser _user = null!;

    public async Task InitializeAsync()
    {
        var s = new ServiceCollection();
        s.AddLogging();
        s.AddSingleton(TimeProvider.System);
        s.AddHttpContextAccessor();
        s.AddDataProtection();
        s.AddOfficeHubCache();
        s.AddSingleton<AuthCacheInvalidator>();
        s.AddSingleton<AuthCacheSaveChangesInterceptor>();
        s.AddScoped<AuthCache>();
        s.AddScoped<CachedSecurityStampValidator>();
        // RuntimeConfig không có ISystemSettingsStore → chính sách bảo mật mặc định (2FA: admin + HR).
        s.AddSingleton<IConfiguration>(new ConfigurationBuilder().Build());
        s.AddSingleton<IHostEnvironment>(new HostingEnvironment { ContentRootPath = AppContext.BaseDirectory });
        s.AddSingleton<RuntimeConfig>();
        var dbName = Guid.NewGuid().ToString();
        s.AddDbContext<OfficeIdentityDbContext>((sp, o) => o.UseInMemoryDatabase(dbName)
            .AddInterceptors(sp.GetRequiredService<AuthCacheSaveChangesInterceptor>()));
        s.AddAuthentication(IdentityConstants.ApplicationScheme).AddIdentityCookies();
        s.AddIdentityCore<AppUser>()
            .AddRoles<IdentityRole<Guid>>()
            .AddEntityFrameworkStores<OfficeIdentityDbContext>()
            .AddSignInManager()
            .AddClaimsPrincipalFactory<AppClaimsFactory>();
        _sp = s.BuildServiceProvider();

        await using var scope = _sp.CreateAsyncScope();
        var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<Guid>>>();
        foreach (var r in Roles.All) await roles.CreateAsync(new IdentityRole<Guid>(r));
        var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        _user = new AppUser { Id = Guid.CreateVersion7(), UserName = "NV001", FullName = "Nguyễn Văn A" };
        Assert.True((await users.CreateAsync(_user)).Succeeded);
        Assert.True((await users.AddToRoleAsync(_user, Roles.Employee)).Succeeded);
    }

    public async Task DisposeAsync() => await _sp.DisposeAsync();

    private async Task<T> InScope<T>(Func<IServiceProvider, Task<T>> f)
    {
        await using var scope = _sp.CreateAsyncScope();
        return await f(scope.ServiceProvider);
    }

    private Task InScope(Func<IServiceProvider, Task> f) => InScope<object?>(async sp => { await f(sp); return null; });

    private Task<UserAuthSnapshot?> GetUser() => InScope(sp => sp.GetRequiredService<AuthCache>().GetUserAsync(_user.Id));

    private Task UpdateUser(Func<UserManager<AppUser>, AppUser, Task> change) => InScope(async sp =>
    {
        var users = sp.GetRequiredService<UserManager<AppUser>>();
        await change(users, (await users.FindByIdAsync(_user.Id.ToString()))!);
    });

    [Fact]
    public async Task Second_read_comes_from_cache()
    {
        var a = await GetUser();
        var b = await GetUser();
        Assert.NotNull(a);
        Assert.Same(a, b); // kiểu bất biến → HybridCache trả đúng đối tượng đã lưu, không đọc DB lần 2
        Assert.Contains(Roles.Employee, a!.Roles);
        Assert.Contains(a.Claims, c => c.Type == ClaimNames.FullName && c.Value == "Nguyễn Văn A");
    }

    [Fact]
    public async Task Security_stamp_change_invalidates_immediately()
    {
        var before = await GetUser();
        await UpdateUser((u, user) => u.UpdateSecurityStampAsync(user)); // đăng xuất / đăng nhập thiết bị khác / đổi mật khẩu
        var after = await GetUser();
        Assert.NotEqual(before!.SecurityStamp, after!.SecurityStamp);
        Assert.Equal(after.SecurityStamp, await InScope(async sp =>
            (await sp.GetRequiredService<UserManager<AppUser>>().FindByIdAsync(_user.Id.ToString()))!.SecurityStamp));
    }

    [Fact]
    public async Task Role_change_invalidates_immediately()
    {
        await GetUser();
        await UpdateUser((u, user) => u.AddToRoleAsync(user, Roles.Hr));
        var after = await GetUser();
        Assert.Contains(Roles.Hr, after!.Roles);
        Assert.Contains(after.Claims, c => c.Type == ClaimNames.MustSetupTwoFactor); // HR chưa bật 2FA → cờ có ngay
    }

    [Fact]
    public async Task Lock_account_temp_password_and_lockout_invalidate_immediately()
    {
        await GetUser();
        await UpdateUser(async (u, user) => { user.IsActive = false; user.MustChangePassword = true; await u.UpdateAsync(user); });
        var after = await GetUser();
        Assert.False(after!.IsActive);
        Assert.True(after.MustChangePassword);

        await UpdateUser((u, user) => u.SetLockoutEndDateAsync(user, DateTimeOffset.UtcNow.AddMinutes(15)));
        Assert.True((await GetUser())!.IsLockedOut(DateTimeOffset.UtcNow));
    }

    [Fact]
    public async Task Token_revoke_invalidates_immediately()
    {
        const string hash = "abc123";
        var tokenId = await InScope(async sp =>
        {
            var db = sp.GetRequiredService<OfficeIdentityDbContext>();
            var t = new AccessToken { UserId = _user.Id, Name = "Claude", TokenHash = hash, Prefix = "ohk_abcd", ExpiresAt = DateTimeOffset.UtcNow.AddDays(30) };
            db.AccessTokens.Add(t);
            await db.SaveChangesAsync();
            return t.Id;
        });
        var a = await InScope(sp => sp.GetRequiredService<AuthCache>().GetTokenAsync(hash));
        Assert.Same(a, await InScope(sp => sp.GetRequiredService<AuthCache>().GetTokenAsync(hash)));
        Assert.True(a!.IsUsable(DateTimeOffset.UtcNow));

        await InScope(async sp =>
        {
            var db = sp.GetRequiredService<OfficeIdentityDbContext>();
            (await db.AccessTokens.FindAsync(tokenId))!.RevokedAt = DateTimeOffset.UtcNow; // như DELETE /auth/access-tokens/{id}
            await db.SaveChangesAsync();
        });
        var after = await InScope(sp => sp.GetRequiredService<AuthCache>().GetTokenAsync(hash));
        Assert.False(after!.IsUsable(DateTimeOffset.UtcNow));
    }

    [Fact]
    public async Task Unknown_token_is_not_cached()
    {
        Assert.Null(await InScope(sp => sp.GetRequiredService<AuthCache>().GetTokenAsync("khong-co")));
        Assert.Null(await InScope(sp => sp.GetRequiredService<AuthCache>().GetTokenAsync("khong-co")));
    }

    [Fact]
    public async Task User_invalidation_also_drops_token_snapshots()
    {
        // AiAccessRevoker (ExecuteUpdate) chỉ gọi InvalidateUserAsync → ảnh chụp token của user phải đọc lại.
        const string hash = "def456";
        await InScope(async sp =>
        {
            var db = sp.GetRequiredService<OfficeIdentityDbContext>();
            db.AccessTokens.Add(new AccessToken { UserId = _user.Id, Name = "x", TokenHash = hash, Prefix = "ohk_", ExpiresAt = DateTimeOffset.UtcNow.AddDays(1) });
            await db.SaveChangesAsync();
        });
        var a = await InScope(sp => sp.GetRequiredService<AuthCache>().GetTokenAsync(hash));
        await _sp.GetRequiredService<AuthCacheInvalidator>().InvalidateUserAsync(_user.Id);
        var b = await InScope(sp => sp.GetRequiredService<AuthCache>().GetTokenAsync(hash));
        Assert.NotSame(a, b);
    }

    [Fact]
    public async Task Snapshot_loaded_before_invalidation_is_stale()
    {
        var inv = _sp.GetRequiredService<AuthCacheInvalidator>();
        var tags = new[] { AuthCacheTags.User(_user.Id) };
        var loadedBefore = AuthCacheInvalidator.Now();
        await inv.InvalidateAsync(tags);
        var loadedAfter = AuthCacheInvalidator.Now();
        Assert.True(inv.IsStale(loadedBefore, tags));   // factory đọc DB trước khi ghi xong → không được dùng
        Assert.False(inv.IsStale(loadedAfter, tags));
        Assert.False(inv.IsStale(loadedBefore, [AuthCacheTags.User(Guid.NewGuid())]));
    }

    [Fact]
    public async Task Role_claim_change_invalidates_everything()
    {
        await InScope(async sp =>
        {
            var db = sp.GetRequiredService<OfficeIdentityDbContext>();
            var role = await db.Roles.FirstAsync();
            db.RoleClaims.Add(new IdentityRoleClaim<Guid> { RoleId = role.Id, ClaimType = "p", ClaimValue = "v" });
            Assert.Contains(AuthCacheTags.All, AuthCacheSaveChangesInterceptor.TagsFor(db));
        });
    }

    [Fact]
    public async Task Cookie_validator_rejects_old_stamp_and_refreshes_claims()
    {
        var oldPrincipal = await InScope(async sp =>
        {
            var users = sp.GetRequiredService<UserManager<AppUser>>();
            return await sp.GetRequiredService<IUserClaimsPrincipalFactory<AppUser>>().CreateAsync((await users.FindByIdAsync(_user.Id.ToString()))!);
        });
        Assert.True(await Validate(oldPrincipal) is { } ok && ok.IsInRole(Roles.Employee));

        await UpdateUser((u, user) => u.AddToRoleAsync(user, Roles.Manager)); // vai trò mới có ngay ở request kế tiếp
        Assert.True(await Validate(oldPrincipal) is { } refreshed && refreshed.IsInRole(Roles.Manager));

        await UpdateUser((u, user) => u.UpdateSecurityStampAsync(user)); // đăng xuất / đăng nhập thiết bị khác → cookie cũ bị từ chối
        Assert.Null(await Validate(oldPrincipal));
    }

    /// <summary>Chạy validator như CookieAuthenticationHandler: trả principal mới, null = bị từ chối.</summary>
    private Task<ClaimsPrincipal?> Validate(ClaimsPrincipal principal) => InScope(async sp =>
    {
        var http = new DefaultHttpContext { RequestServices = sp };
        sp.GetRequiredService<IHttpContextAccessor>().HttpContext = http;
        var scheme = new AuthenticationScheme(IdentityConstants.ApplicationScheme, null, typeof(CookieAuthenticationHandler));
        var ctx = new CookieValidatePrincipalContext(http, scheme, new CookieAuthenticationOptions { SlidingExpiration = true },
            new AuthenticationTicket(principal, IdentityConstants.ApplicationScheme));
        await sp.GetRequiredService<CachedSecurityStampValidator>().ValidateAsync(ctx);
        return ctx.Principal;
    });
}
