using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OfficeHub.BuildingBlocks.Auth;
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

        services.AddIdentityCore<AppUser>(o =>
            {
                o.Password.RequiredLength = 8;
                o.Password.RequireNonAlphanumeric = false;
                o.Password.RequireUppercase = false;
                o.Lockout.MaxFailedAccessAttempts = 5;
                o.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
                o.User.RequireUniqueEmail = false; // email không bắt buộc; đã có unique index lọc NULL
                // Quên mật khẩu: link 1 giờ (provider riêng); link mời vẫn dùng provider "Default" 72 giờ — PasswordResetMailer.cs
                o.Tokens.PasswordResetTokenProvider = PasswordResetTokens.ResetProvider;
            })
            .AddRoles<IdentityRole<Guid>>()
            .AddEntityFrameworkStores<OfficeIdentityDbContext>()
            .AddSignInManager()
            .AddClaimsPrincipalFactory<AppClaimsFactory>()
            .AddDefaultTokenProviders()
            .AddTokenProvider<ResetTokenProvider>(PasswordResetTokens.ResetProvider);

        // Kiểm tra lại security stamp ở MỌI request: khoá tài khoản / đổi vai trò / cấp lại mật khẩu có hiệu lực ngay
        // (mặc định của Identity là 30 phút). Công ty ~12 người → thêm 1 truy vấn user mỗi request là không đáng kể.
        services.Configure<SecurityStampValidatorOptions>(o => o.ValidationInterval = TimeSpan.Zero);

        // Link mời / quên mật khẩu hết hạn sau 72 giờ
        services.Configure<DataProtectionTokenProviderOptions>(o => o.TokenLifespan = TimeSpan.FromHours(72));
        services.AddScoped<AccountService>();
        services.AddScoped<IAccountService>(sp => sp.GetRequiredService<AccountService>());
        services.AddValidatedOptions<AccessTokenSettings>(config, AccessTokenSettings.Section);
        services.AddAuthRateLimits();
        services.AddSingleton<LoginThrottle>();
        services.AddSingleton(sp => new AttemptCounter(sp.GetRequiredService<TimeProvider>())); // hạn mức email quên mật khẩu
        services.AddSingleton<PasswordResetMailer>();
        services.AddHostedService(sp => sp.GetRequiredService<PasswordResetMailer>());
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
