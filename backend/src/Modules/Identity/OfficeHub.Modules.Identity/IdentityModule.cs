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
using OfficeHub.Modules.Identity.Infrastructure;

namespace OfficeHub.Modules.Identity;

public sealed class IdentityModule : IModule
{
    public string Name => "identity";

    public void Register(IServiceCollection services, IConfiguration config)
    {
        services.AddModuleDbContext<OfficeIdentityDbContext>(config, OfficeIdentityDbContext.Schema);

        services.AddAuthentication(AuthCookie.Scheme)
            .AddIdentityCookies(c => c.ApplicationCookie!.Configure(AuthCookie.Configure));

        services.AddIdentityCore<AppUser>(o =>
            {
                o.Password.RequiredLength = 8;
                o.Password.RequireNonAlphanumeric = false;
                o.Password.RequireUppercase = false;
                o.Lockout.MaxFailedAccessAttempts = 5;
                o.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
                o.User.RequireUniqueEmail = false; // email không bắt buộc; đã có unique index lọc NULL
            })
            .AddRoles<IdentityRole<Guid>>()
            .AddEntityFrameworkStores<OfficeIdentityDbContext>()
            .AddSignInManager()
            .AddClaimsPrincipalFactory<AppClaimsFactory>()
            .AddDefaultTokenProviders();

        // Kiểm tra lại security stamp ở MỌI request: khoá tài khoản / đổi vai trò / cấp lại mật khẩu có hiệu lực ngay
        // (mặc định của Identity là 30 phút). Công ty ~12 người → thêm 1 truy vấn user mỗi request là không đáng kể.
        services.Configure<SecurityStampValidatorOptions>(o => o.ValidationInterval = TimeSpan.Zero);

        // Link mời / quên mật khẩu hết hạn sau 72 giờ
        services.Configure<DataProtectionTokenProviderOptions>(o => o.TokenLifespan = TimeSpan.FromHours(72));
        services.AddScoped<AccountService>();
        services.AddScoped<IAccountService>(sp => sp.GetRequiredService<AccountService>());
        services.AddAuthRateLimits();

        services.AddHostedService<IdentitySeeder>();
    }

    public void MapEndpoints(IEndpointRouteBuilder api)
    {
        AuthEndpoints.Map(api);
        PasswordEndpoints.Map(api);
    }
}
