using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Routing;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.Modules.Identity.Domain;
using OfficeHub.Modules.Identity.Infrastructure;

namespace OfficeHub.Modules.Identity.Features.Auth;

public sealed record LoginRequest([Required] string Login, [Required] string Password, bool RememberMe = true);
public sealed record ChangePasswordRequest([Required] string CurrentPassword, [Required] string NewPassword);
/// <summary>Avatar = ngoại hình nhân vật 3D (JSON, xem AvatarRules); null = nhân vật mặc định. Realtime đọc trường này khi vào văn phòng.</summary>
public sealed record MeResponse(Guid Id, string UserName, string? Email, string FullName, string[] Roles, bool MustChangePassword,
    JsonElement? Avatar = null);

internal static class AuthEndpoints
{
    public static void Map(IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/auth").WithTags("Auth");

        g.MapPost("/login", LoginAsync).AllowAnonymous().RequireRateLimiting(Infrastructure.RateLimits.Auth);
        g.MapPost("/logout", async (SignInManager<AppUser> signIn) => { await signIn.SignOutAsync(); return TypedResults.NoContent(); })
            .RequireAuthorization();
        g.MapGet("/me", MeAsync).RequireAuthorization();
        g.MapPost("/change-password", ChangePasswordAsync).RequireAuthorization();
    }

    /// <summary>Đăng nhập bằng email HOẶC tên đăng nhập (mã nhân viên).</summary>
    private static async Task<Results<Ok<MeResponse>, ProblemHttpResult>> LoginAsync(
        LoginRequest req, UserManager<AppUser> users, SignInManager<AppUser> signIn, OfficeIdentityDbContext db, TimeProvider clock)
    {
        var user = await users.FindByNameAsync(req.Login) ?? await users.FindByEmailAsync(req.Login);
        if (user is null || !user.IsActive)
            return TypedResults.Problem("Sai tài khoản hoặc mật khẩu", statusCode: StatusCodes.Status401Unauthorized);

        var result = await signIn.PasswordSignInAsync(user, req.Password, req.RememberMe, lockoutOnFailure: true);
        if (result.IsLockedOut)
            return TypedResults.Problem("Tài khoản tạm khoá do đăng nhập sai nhiều lần, thử lại sau 15 phút", statusCode: StatusCodes.Status423Locked);
        if (result.RequiresTwoFactor)
            return TypedResults.Problem("Cần mã xác thực 2 lớp", statusCode: StatusCodes.Status403Forbidden, title: "2fa_required");
        if (!result.Succeeded)
            return TypedResults.Problem("Sai tài khoản hoặc mật khẩu", statusCode: StatusCodes.Status401Unauthorized);

        user.LastLoginAt = clock.GetUtcNow();
        await users.UpdateAsync(user);
        return TypedResults.Ok(await ToMe(user, users, db));
    }

    private static async Task<Results<Ok<MeResponse>, UnauthorizedHttpResult>> MeAsync(HttpContext ctx, UserManager<AppUser> users,
        OfficeIdentityDbContext db)
    {
        var user = await users.GetUserAsync(ctx.User);
        return user is { IsActive: true } ? TypedResults.Ok(await ToMe(user, users, db)) : TypedResults.Unauthorized();
    }

    private static async Task<Results<NoContent, ValidationProblem, UnauthorizedHttpResult>> ChangePasswordAsync(
        ChangePasswordRequest req, HttpContext ctx, UserManager<AppUser> users, SignInManager<AppUser> signIn)
    {
        var user = await users.GetUserAsync(ctx.User);
        if (user is null) return TypedResults.Unauthorized();

        var result = await users.ChangePasswordAsync(user, req.CurrentPassword, req.NewPassword);
        if (!result.Succeeded)
            return TypedResults.ValidationProblem(result.Errors.GroupBy(e => e.Code).ToDictionary(g => g.Key, g => g.Select(e => e.Description).ToArray()));

        user.MustChangePassword = false;
        await users.UpdateAsync(user);
        await signIn.RefreshSignInAsync(user); // cấp lại cookie không còn cờ must_change_password
        return TypedResults.NoContent();
    }

    private static async Task<MeResponse> ToMe(AppUser u, UserManager<AppUser> users, OfficeIdentityDbContext db)
    {
        var look = await db.UserAvatars.AsNoTracking().Where(a => a.UserId == u.Id).Select(a => a.Look).FirstOrDefaultAsync();
        return new(u.Id, u.UserName!, u.Email, u.FullName, [.. await users.GetRolesAsync(u)], u.MustChangePassword,
            look is null ? null : JsonDocument.Parse(look).RootElement.Clone());
    }
}
