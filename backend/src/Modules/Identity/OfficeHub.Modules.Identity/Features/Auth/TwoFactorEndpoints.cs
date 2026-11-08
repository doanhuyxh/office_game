using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Identity.Domain;
using OfficeHub.Modules.Identity.Infrastructure;

namespace OfficeHub.Modules.Identity.Features.Auth;

/// <param name="Required">Vai trò admin / hr → bắt buộc, không tự tắt được.</param>
/// <param name="RecoveryCodesLeft">Số mã dự phòng chưa dùng (0 khi chưa bật).</param>
public sealed record TwoFactorStatusDto(bool Enabled, bool Required, int RecoveryCodesLeft);
/// <param name="SharedKey">Khoá base32 nhóm 4 ký tự (nhập tay vào ứng dụng).</param>
/// <param name="AuthenticatorUri"><c>otpauth://totp/…</c> → FE vẽ mã QR.</param>
public sealed record TwoFactorSetupDto(string SharedKey, string AuthenticatorUri);
/// <summary><c>reset = true</c> → tạo khoá mới (bỏ khoá đang chờ xác nhận).</summary>
public sealed record TwoFactorSetupRequest(bool Reset = false);
public sealed record TwoFactorCodeRequest(string Code);
public sealed record TwoFactorDisableRequest(string CurrentPassword, string Code);
/// <summary>Mã dự phòng chỉ trả về MỘT lần.</summary>
public sealed record RecoveryCodesDto(string[] RecoveryCodes);
public sealed record LoginTwoFactorRequest(string Code, bool IsRecoveryCode = false, bool RememberMe = true);

/// <summary>
/// Xác thực 2 lớp bằng ứng dụng TOTP (Google Authenticator, Microsoft Authenticator…) dùng sẵn
/// AuthenticatorTokenProvider + mã dự phòng của ASP.NET Identity. Khoá / mã dự phòng lưu ở identity.user_tokens.
/// Admin / HR bắt buộc (xem <see cref="TwoFactorPolicy"/>).
/// </summary>
internal static class TwoFactorEndpoints
{
    private const string InvalidCode = "Mã xác thực không đúng hoặc đã hết hạn";

    public static void Map(IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/auth/2fa").WithTags("Auth").RequireAuthorization();
        g.MapGet("/status", StatusAsync);
        g.MapPost("/setup", SetupAsync);
        g.MapPost("/enable", EnableAsync).RequireRateLimiting(RateLimits.Auth);
        g.MapPost("/disable", DisableAsync).RequireRateLimiting(RateLimits.Auth);
        g.MapPost("/recovery-codes", RegenerateCodesAsync).RequireRateLimiting(RateLimits.Auth);

        // Bước 2 của đăng nhập: cookie tạm (Identity.TwoFactorUserId) do bước mật khẩu cấp.
        api.MapPost("/auth/login/2fa", LoginAsync).WithTags("Auth").AllowAnonymous().RequireRateLimiting(RateLimits.Auth);
    }

    private static async Task<Results<Ok<TwoFactorStatusDto>, UnauthorizedHttpResult>> StatusAsync(ClaimsPrincipal principal, UserManager<AppUser> users)
    {
        var user = await users.GetUserAsync(principal);
        if (user is null) return TypedResults.Unauthorized();
        return TypedResults.Ok(new TwoFactorStatusDto(user.TwoFactorEnabled, TwoFactorPolicy.IsRequiredFor(await users.GetRolesAsync(user)),
            user.TwoFactorEnabled ? await users.CountRecoveryCodesAsync(user) : 0));
    }

    /// <summary>Lấy (hoặc tạo) khoá chờ xác nhận. Đã bật 2FA → 409 (tắt rồi bật lại để đổi điện thoại).</summary>
    private static async Task<Results<Ok<TwoFactorSetupDto>, UnauthorizedHttpResult, ProblemHttpResult>> SetupAsync(
        TwoFactorSetupRequest? req, ClaimsPrincipal principal, UserManager<AppUser> users, SignInManager<AppUser> signIn, IOptions<AppSettings> app)
    {
        var user = await users.GetUserAsync(principal);
        if (user is null) return TypedResults.Unauthorized();
        if (user.TwoFactorEnabled) return Problems.Conflict("Xác thực 2 lớp đang bật. Muốn đổi điện thoại: tắt rồi bật lại, hoặc nhờ HR đặt lại.");

        var key = await users.GetAuthenticatorKeyAsync(user);
        if (string.IsNullOrEmpty(key) || req?.Reset == true)
        {
            await users.ResetAuthenticatorKeyAsync(user); // đổi security stamp → cấp lại cookie cho phiên hiện tại
            await signIn.RefreshSignInAsync(user);
            key = await users.GetAuthenticatorKeyAsync(user);
        }
        var account = string.IsNullOrWhiteSpace(user.Email) ? user.UserName! : user.Email;
        return TypedResults.Ok(new TwoFactorSetupDto(TwoFactorRules.FormatKey(key!), TwoFactorRules.AuthenticatorUri(app.Value.Name, account, key!)));
    }

    private static async Task<Results<Ok<RecoveryCodesDto>, ValidationProblem, UnauthorizedHttpResult, ProblemHttpResult>> EnableAsync(
        TwoFactorCodeRequest req, ClaimsPrincipal principal, UserManager<AppUser> users, SignInManager<AppUser> signIn)
    {
        var user = await users.GetUserAsync(principal);
        if (user is null) return TypedResults.Unauthorized();
        if (user.TwoFactorEnabled) return Problems.Conflict("Xác thực 2 lớp đã bật");
        if (string.IsNullOrEmpty(await users.GetAuthenticatorKeyAsync(user)))
            return Problems.Conflict("Chưa tạo mã thiết lập, tải lại trang rồi quét mã QR");
        if (!await VerifyTotpAsync(users, user, req.Code)) return CodeError();

        await users.SetTwoFactorEnabledAsync(user, true); // đổi security stamp: phiên khác của chính người này phải đăng nhập lại
        var codes = await users.GenerateNewTwoFactorRecoveryCodesAsync(user, TwoFactorRules.RecoveryCodeCount);
        await signIn.RefreshSignInAsync(user); // cookie mới không còn claim must_setup_2fa
        return TypedResults.Ok(new RecoveryCodesDto([.. codes ?? []]));
    }

    /// <summary>Tự tắt: cần mật khẩu + mã hiện tại. Admin / HR không được tắt (bắt buộc).</summary>
    private static async Task<Results<NoContent, ValidationProblem, UnauthorizedHttpResult, ProblemHttpResult>> DisableAsync(
        TwoFactorDisableRequest req, ClaimsPrincipal principal, UserManager<AppUser> users, SignInManager<AppUser> signIn)
    {
        var user = await users.GetUserAsync(principal);
        if (user is null) return TypedResults.Unauthorized();
        if (!user.TwoFactorEnabled) return Problems.Conflict("Xác thực 2 lớp chưa bật");
        if (TwoFactorPolicy.IsRequiredFor(await users.GetRolesAsync(user)))
            return Problems.Conflict("Tài khoản admin / HR bắt buộc dùng xác thực 2 lớp, không thể tắt. Đổi điện thoại: nhờ admin / HR khác đặt lại.");
        if (!await users.CheckPasswordAsync(user, req.CurrentPassword ?? ""))
            return new Validation().Add("currentPassword", "Mật khẩu hiện tại không đúng").Problem();
        if (!await VerifyTotpAsync(users, user, req.Code)) return CodeError();

        await users.ClearTwoFactorAsync(user);
        await signIn.RefreshSignInAsync(user);
        return TypedResults.NoContent();
    }

    private static async Task<Results<Ok<RecoveryCodesDto>, ValidationProblem, UnauthorizedHttpResult, ProblemHttpResult>> RegenerateCodesAsync(
        TwoFactorCodeRequest req, ClaimsPrincipal principal, UserManager<AppUser> users)
    {
        var user = await users.GetUserAsync(principal);
        if (user is null) return TypedResults.Unauthorized();
        if (!user.TwoFactorEnabled) return Problems.Conflict("Xác thực 2 lớp chưa bật");
        if (!await VerifyTotpAsync(users, user, req.Code)) return CodeError();
        var codes = await users.GenerateNewTwoFactorRecoveryCodesAsync(user, TwoFactorRules.RecoveryCodeCount); // mã cũ hết hiệu lực
        return TypedResults.Ok(new RecoveryCodesDto([.. codes ?? []]));
    }

    /// <summary>
    /// Bước 2 đăng nhập. Mã sai (TOTP hoặc dự phòng) cộng vào số lần sai → 5 lần khoá 15 phút như mật khẩu.
    /// Hết hạn cookie tạm (5 phút) → 401 <c>2fa_expired</c>, FE quay về bước mật khẩu.
    /// </summary>
    private static async Task<Results<Ok<MeResponse>, ProblemHttpResult>> LoginAsync(
        LoginTwoFactorRequest req, UserManager<AppUser> users, SignInManager<AppUser> signIn, OfficeIdentityDbContext db, TimeProvider clock)
    {
        var user = await signIn.GetTwoFactorAuthenticationUserAsync();
        if (user is null)
            return TypedResults.Problem("Phiên đăng nhập đã hết hạn, nhập lại mật khẩu", statusCode: StatusCodes.Status401Unauthorized, title: "2fa_expired");
        if (!user.IsActive)
            return TypedResults.Problem("Sai tài khoản hoặc mật khẩu", statusCode: StatusCodes.Status401Unauthorized);
        if (await users.IsLockedOutAsync(user)) return LockedOut();

        SignInResult result;
        if (req.IsRecoveryCode)
        {
            result = await signIn.TwoFactorRecoveryCodeSignInAsync(TwoFactorRules.NormalizeRecoveryCode(req.Code));
            if (result.Succeeded)
            {
                // Identity đăng nhập mã dự phòng với cookie phiên (không nhớ) → cấp lại theo "Ghi nhớ đăng nhập".
                if (req.RememberMe) await signIn.SignInWithClaimsAsync(user, isPersistent: true, [new Claim("amr", "mfa")]);
            }
            else
            {
                // Identity không đếm sai cho mã dự phòng → tự đếm để chống dò.
                await users.AccessFailedAsync(user);
                if (await users.IsLockedOutAsync(user)) return LockedOut();
            }
        }
        else
        {
            var code = TwoFactorRules.NormalizeCode(req.Code);
            result = await signIn.TwoFactorAuthenticatorSignInAsync(code, req.RememberMe, rememberClient: false);
        }

        if (result.IsLockedOut) return LockedOut();
        if (!result.Succeeded) return TypedResults.Problem(InvalidCode, statusCode: StatusCodes.Status401Unauthorized, title: "2fa_invalid");

        // Mỗi lúc chỉ 1 thiết bị — xem AuthEndpoints.LoginAsync. Đặt sau khi xác thực 2FA xong (không đổi stamp ở bước mật khẩu,
        // tránh đá thiết bị khác khi người này còn chưa hoàn tất nhập mã).
        await users.UpdateSecurityStampAsync(user);
        await signIn.RefreshSignInAsync(user);

        user.LastLoginAt = clock.GetUtcNow();
        await users.UpdateAsync(user);
        return TypedResults.Ok(await AuthEndpoints.ToMe(user, users, db));
    }

    private static async Task<bool> VerifyTotpAsync(UserManager<AppUser> users, AppUser user, string? raw)
    {
        var code = TwoFactorRules.NormalizeCode(raw);
        return TwoFactorRules.IsTotpFormat(code)
            && await users.VerifyTwoFactorTokenAsync(user, users.Options.Tokens.AuthenticatorTokenProvider, code);
    }

    private static ValidationProblem CodeError() => new Validation().Add("code", InvalidCode).Problem();

    private static ProblemHttpResult LockedOut() =>
        TypedResults.Problem("Tài khoản tạm khoá do đăng nhập sai nhiều lần, thử lại sau 15 phút", statusCode: StatusCodes.Status423Locked);
}
