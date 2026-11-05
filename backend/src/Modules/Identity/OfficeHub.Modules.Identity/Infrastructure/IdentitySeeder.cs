using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.Modules.Identity.Domain;

namespace OfficeHub.Modules.Identity.Infrastructure;

public sealed class SeedSettings
{
    public const string Section = "Seed";
    public string? AdminEmail { get; set; }
    public string? AdminPassword { get; set; }
    public string AdminFullName { get; set; } = "Quản trị hệ thống";
}

/// <summary>Khi khởi động: chạy migration (nếu bật), tạo các vai trò, tạo admin đầu tiên từ .env nếu chưa có.</summary>
public sealed class IdentitySeeder(IServiceProvider sp, IConfiguration config, ILogger<IdentitySeeder> log) : IHostedService
{
    public async Task StartAsync(CancellationToken ct)
    {
        using var scope = sp.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<OfficeIdentityDbContext>();
        if (config.GetValue("Database:MigrateOnStartup", true))
            await db.Database.MigrateAsync(ct);

        var roleManager = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<Guid>>>();
        foreach (var role in Roles.All)
            if (!await roleManager.RoleExistsAsync(role))
                await roleManager.CreateAsync(new IdentityRole<Guid>(role));

        var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        if ((await users.GetUsersInRoleAsync(Roles.Admin)).Count > 0) return;

        var seed = config.GetSection(SeedSettings.Section).Get<SeedSettings>() ?? new();
        if (string.IsNullOrWhiteSpace(seed.AdminEmail) || string.IsNullOrWhiteSpace(seed.AdminPassword))
            throw new InvalidOperationException(
                "Chưa có tài khoản admin. Điền Seed__AdminEmail và Seed__AdminPassword trong .env rồi khởi động lại.");

        var admin = new AppUser
        {
            UserName = seed.AdminEmail,
            Email = seed.AdminEmail,
            EmailConfirmed = true,
            FullName = seed.AdminFullName,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        var result = await users.CreateAsync(admin, seed.AdminPassword);
        if (!result.Succeeded)
            throw new InvalidOperationException("Không tạo được admin: " + string.Join("; ", result.Errors.Select(e => e.Description)));
        await users.AddToRolesAsync(admin, [Roles.Admin, Roles.Hr]);
        log.LogWarning("Đã tạo tài khoản admin {Email}. Nên xoá Seed__AdminPassword khỏi .env sau lần chạy đầu.", seed.AdminEmail);
    }

    public Task StopAsync(CancellationToken ct) => Task.CompletedTask;
}
