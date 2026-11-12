using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Logging;
using OfficeHub.Modules.Identity.Domain;
using OfficeHub.Modules.Identity.Infrastructure;

namespace OfficeHub.Modules.Identity.Features.Auth;

public sealed record ForgotPasswordRequest([Required] string Email);
public sealed record ResetPasswordRequest([Required] Guid UserId, [Required] string Token, [Required] string NewPassword);

/// <summary>Quên mật khẩu + đặt mật khẩu qua link (dùng chung cho link mời và link quên mật khẩu).</summary>
internal static class PasswordEndpoints
{
    public static void Map(IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/auth").WithTags("Auth").AllowAnonymous();
        g.MapPost("/forgot-password", ForgotAsync).RequireRateLimiting(RateLimits.Auth);
        g.MapPost("/reset-password", ResetAsync).RequireRateLimiting(RateLimits.Auth);
    }

    /// <summary>Luôn trả 204 (không tiết lộ email có tồn tại hay không).</summary>
    private static async Task<NoContent> ForgotAsync(ForgotPasswordRequest req, UserManager<AppUser> users,
        AccountService accounts, ILoggerFactory lf, CancellationToken ct)
    {
        var user = await users.FindByEmailAsync(req.Email.Trim());
        if (user is { IsActive: true, Email: not null })
        {
            try { await accounts.SendLinkAsync(user, invite: false, ct); }
            catch (Exception ex) { lf.CreateLogger("Auth").LogError(ex, "Gửi email quên mật khẩu thất bại"); }
        }
        return TypedResults.NoContent();
    }

    private static async Task<Results<NoContent, ValidationProblem, ProblemHttpResult>> ResetAsync(
        ResetPasswordRequest req, UserManager<AppUser> users, OfficeIdentityDbContext db, TimeProvider clock, CancellationToken ct)
    {
        var user = await users.FindByIdAsync(req.UserId.ToString());
        if (user is not { IsActive: true })
            return TypedResults.Problem("Link không hợp lệ hoặc đã hết hạn", statusCode: StatusCodes.Status400BadRequest);

        var result = await users.ResetPasswordAsync(user, req.Token, req.NewPassword);
        if (!result.Succeeded)
        {
            if (result.Errors.Any(e => e.Code == "InvalidToken"))
                return TypedResults.Problem("Link không hợp lệ hoặc đã hết hạn", statusCode: StatusCodes.Status400BadRequest);
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["newPassword"] = [.. result.Errors.Select(e => e.Description)],
            });
        }

        user.EmailConfirmed = true; // bấm được link trong email = email đúng
        user.MustChangePassword = false;
        await users.UpdateAsync(user);
        await users.SetLockoutEndDateAsync(user, null);
        // ResetPasswordAsync đã đổi security stamp (đăng xuất mọi phiên); quên mật khẩu = có thể bị lộ → thu hồi luôn token AI.
        await AiAccessRevoker.RevokeAllAsync(db, user.Id, clock.GetUtcNow(), ct);
        return TypedResults.NoContent();
    }
}
