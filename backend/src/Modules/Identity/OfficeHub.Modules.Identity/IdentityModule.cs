using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Caching;
using OfficeHub.BuildingBlocks.Modules;
using OfficeHub.BuildingBlocks.Persistence;
using OfficeHub.Modules.Identity.Contracts;
using OfficeHub.Modules.Identity.Domain;
using OfficeHub.Modules.Identity.Features.Auth;
using OfficeHub.Modules.Identity.Features.OAuth;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.Modules.Identity.Infrastructure;

namespace OfficeHub.Modules.Identity;

public sealed class IdentityModule : IModule
{
    public string Name => "identity";

    public void Register(IServiceCollection services, IConfiguration config)
    {
        services.AddModuleDbContext<OfficeIdentityDbContext>(config, OfficeIdentityDbContext.Schema);
        // Cache xác thực trong RAM (TEST-244, AuthCache.cs): mọi SaveChanges đổi users / user_roles / user_claims / roles / token / grant
        // → xoá cache ngay (interceptor); ExecuteUpdate tự xoá ở nơi gọi. Chỉ đúng với MỘT bản Api (≥ 2 bản → B3: Redis + phát lệnh xoá).
        services.AddOfficeHubCache();
        services.AddSingleton<AuthCacheInvalidator>();
        services.AddSingleton<AuthCacheSaveChangesInterceptor>();
        services.AddScoped<AuthCache>();
        services.ConfigureDbContext<OfficeIdentityDbContext>((sp, o) => o.AddInterceptors(sp.GetRequiredService<AuthCacheSaveChangesInterceptor>()));

        // Mặc định: cookie trình duyệt. Có "Authorization: Bearer ohk_…" (trợ lý AI qua MCP) → token truy cập.
        services.AddAuthentication(AccessTokenAuth.SelectorScheme)
            .AddPolicyScheme(AccessTokenAuth.SelectorScheme, "Cookie hoặc token AI", o => o.ForwardDefaultSelector = ctx =>
                AccessTokenAuth.HasBearerToken(ctx.Request.Headers.Authorization.ToString()) ? AccessTokenAuth.Scheme : AuthCookie.Scheme)
            .AddScheme<AuthenticationSchemeOptions, AccessTokenHandler>(AccessTokenAuth.Scheme, null)
            .AddIdentityCookies(c =>
            {
                c.ApplicationCookie!.Configure(AuthCookie.Configure);
                c.TwoFactorUserIdCookie!.Configure(AuthCookie.ConfigureTwoFactor); // bước mã 2FA sau mật khẩu
            });

        // Thời hạn phiên (TEST-259): cookie mới / cấp lại lấy hạn theo cấu hình Bảo mật, ghi mốc đăng nhập (giữ qua các lần cấp lại).
        services.AddOptions<CookieAuthenticationOptions>(IdentityConstants.ApplicationScheme).Configure<RuntimeConfig, TimeProvider>((o, runtime, clock) =>
        {
            var inner = o.Events.OnSigningIn;
            o.Events.OnSigningIn = async ctx =>
            {
                var issued = ctx.Properties.IssuedUtc ?? clock.GetUtcNow();
                if (SessionRules.ReadLoginAt(ctx.Properties.Items) is null) SessionRules.WriteLoginAt(ctx.Properties.Items, issued);
                ctx.Properties.ExpiresUtc = issued + runtime.Session.Idle;
                await inner(ctx);
            };
        });

        services.AddIdentityCore<AppUser>(o =>
            {
                // Password / Lockout: theo cấu hình Bảo mật → Mật khẩu, áp mỗi request ở AppUserManager (TEST-260).
                o.User.RequireUniqueEmail = false; // email không bắt buộc; đã có unique index lọc NULL
                // Quên mật khẩu: link 1 giờ (provider riêng); link mời vẫn dùng provider "Default" 72 giờ — PasswordResetMailer.cs
                o.Tokens.PasswordResetTokenProvider = PasswordResetTokens.ResetProvider;
            })
            .AddRoles<IdentityRole<Guid>>()
            .AddEntityFrameworkStores<OfficeIdentityDbContext>()
            .AddUserManager<AppUserManager>()
            .AddErrorDescriber<ViIdentityErrorDescriber>()
            .AddSignInManager()
            .AddClaimsPrincipalFactory<AppClaimsFactory>()
            .AddDefaultTokenProviders()
            .AddTokenProvider<ResetTokenProvider>(PasswordResetTokens.ResetProvider);

        // Kiểm tra security stamp ở MỌI request (khoá tài khoản / đổi vai trò / cấp lại mật khẩu có hiệu lực ngay — mặc định của Identity
        // là 30 phút), stamp + claim lấy từ AuthCache thay vì 3 + 2 × số vai trò câu truy vấn / request (TEST-244).
        services.Replace(ServiceDescriptor.Scoped<ISecurityStampValidator, CachedSecurityStampValidator>());

        // Link mời / quên mật khẩu hết hạn sau 72 giờ
        services.Configure<DataProtectionTokenProviderOptions>(o => o.TokenLifespan = TimeSpan.FromHours(72));
        services.AddScoped<AccountService>();
        services.AddScoped<IAccountService>(sp => sp.GetRequiredService<AccountService>());
        services.AddValidatedOptions<AccessTokenSettings>(config, AccessTokenSettings.Section);
        services.AddAuthRateLimits();
        // Bộ đếm đăng nhập sai + hạn mức email quên mật khẩu: lưu DB (TEST-27, bảng identity.attempt_counters)
        services.AddScoped<IAttemptStore, DbAttemptStore>();
        services.AddScoped(sp => new LoginThrottle(sp.GetRequiredService<IAttemptStore>(), sp.GetRequiredService<RuntimeConfig>().Password));
        services.AddHostedService<PasswordResetMailer>(); // hàng đợi DB identity.password_reset_requests (TEST-28)
        // /api/oauth/register, /token, /revoke được gọi từ máy chủ / trình duyệt của ứng dụng AI (không cookie).
        services.AddCors(o => o.AddPolicy(OAuthEndpoints.CorsPolicy, p => p.AllowAnyOrigin().AllowAnyHeader().WithMethods("POST")));

        services.AddHostedService<IdentitySeeder>();
    }

    public void MapEndpoints(IEndpointRouteBuilder api)
    {
        AuthEndpoints.Map(api);
        PasswordEndpoints.Map(api);
        AccessTokenEndpoints.Map(api);
        AvatarEndpoints.Map(api);
        TwoFactorEndpoints.Map(api);
        OAuthEndpoints.Map(api);
    }
}
