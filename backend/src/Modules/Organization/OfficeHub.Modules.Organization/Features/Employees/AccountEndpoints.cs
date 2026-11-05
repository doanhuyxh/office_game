using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Identity.Contracts;
using OfficeHub.Modules.Organization.Domain;
using OfficeHub.Modules.Organization.Infrastructure;

namespace OfficeHub.Modules.Organization.Features.Employees;

/// <summary>HR cấp / quản lý tài khoản đăng nhập cho nhân viên (gọi sang Identity qua IAccountService).</summary>
internal static class AccountEndpoints
{
    public static void Map(RouteGroupBuilder org)
    {
        var g = org.MapGroup("/employees/{id:guid}/account").WithTags("Organization").RequireAuthorization(AuthPolicies.Hr);
        g.MapPost("/", CreateAsync);
        g.MapPost("/resend-invite", ResendInviteAsync);
        g.MapPost("/reset-password", ResetPasswordAsync);
        g.MapPut("/roles", SetRolesAsync);
    }

    private static async Task<Results<Ok<AccountCreatedResponse>, NotFound, ValidationProblem, ProblemHttpResult>> CreateAsync(
        Guid id, CreateAccountRequest req, ClaimsPrincipal user, OrgDbContext db, IAccountService accounts, CancellationToken ct)
    {
        var e = await db.Employees.FindAsync([id], ct);
        if (e is null) return TypedResults.NotFound();
        if (e.UserId is not null) return Problems.Conflict("Nhân viên đã có tài khoản");
        if (e.Status == EmployeeStatus.Resigned) return Problems.Conflict("Nhân viên đã nghỉ việc");

        var roles = NormalizeRoles(req.Roles);
        if (CheckRoleGrant(user, roles) is { } denied) return denied;
        var userName = string.IsNullOrWhiteSpace(req.UserName) ? e.Code : req.UserName.Trim();
        var account = new NewAccount(userName, e.Email, e.FullName, roles);

        AccountResult result;
        string? temp = null;
        switch (req.Mode?.ToLowerInvariant())
        {
            case "invite":
                if (string.IsNullOrWhiteSpace(e.Email))
                    return new Validation().Add("mode", "Nhân viên chưa có email, hãy nhập email hoặc chọn cấp mật khẩu tạm").Problem();
                try { result = await accounts.InviteAsync(account, ct); }
                catch (Exception) { return TypedResults.Problem("Đã tạo tài khoản nhưng gửi email thất bại. Kiểm tra cấu hình SMTP rồi bấm 'Gửi lại lời mời'.", statusCode: 502); }
                break;
            case "password":
                temp = GenerateTempPassword();
                result = await accounts.CreateWithPasswordAsync(account, temp, ct);
                break;
            default:
                return new Validation().Add("mode", "Chọn 'invite' (mời qua email) hoặc 'password' (mật khẩu tạm)").Problem();
        }
        if (!result.Succeeded) return new Validation().Add("account", string.Join(" ", result.Errors)).Problem();

        e.UserId = result.UserId;
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(new AccountCreatedResponse(result.UserId!.Value, userName, temp, InviteSent: temp is null));
    }

    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> ResendInviteAsync(
        Guid id, OrgDbContext db, IAccountService accounts, CancellationToken ct)
    {
        var e = await db.Employees.FindAsync([id], ct);
        if (e?.UserId is not { } uid) return TypedResults.NotFound();
        var r = await accounts.ResendInviteAsync(uid, ct);
        return r.Succeeded ? TypedResults.NoContent() : Problems.Conflict(string.Join(" ", r.Errors));
    }

    private static async Task<Results<Ok<TempPasswordResponse>, NotFound, ProblemHttpResult>> ResetPasswordAsync(
        Guid id, ClaimsPrincipal user, OrgDbContext db, IAccountService accounts, CancellationToken ct)
    {
        var e = await db.Employees.FindAsync([id], ct);
        if (e?.UserId is not { } uid) return TypedResults.NotFound();
        if (await IsAdminTargetByNonAdminAsync(user, uid, accounts, ct)) return Forbidden("Chỉ admin được đặt lại mật khẩu của admin");
        var temp = GenerateTempPassword();
        var r = await accounts.ResetToTempPasswordAsync(uid, temp, ct);
        return r.Succeeded ? TypedResults.Ok(new TempPasswordResponse(temp)) : Problems.Conflict(string.Join(" ", r.Errors));
    }

    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> SetRolesAsync(
        Guid id, SetRolesRequest req, ClaimsPrincipal user, OrgDbContext db, IAccountService accounts, CancellationToken ct)
    {
        var e = await db.Employees.FindAsync([id], ct);
        if (e?.UserId is not { } uid) return TypedResults.NotFound();
        var roles = NormalizeRoles(req.Roles);
        if (CheckRoleGrant(user, roles) is { } denied) return denied;
        if (await IsAdminTargetByNonAdminAsync(user, uid, accounts, ct)) return Forbidden("Chỉ admin được đổi vai trò của admin");
        if (uid == user.GetUserId() && user.IsInRole(Roles.Admin) && !roles.Contains(Roles.Admin))
            return Forbidden("Không thể tự gỡ vai trò admin của chính mình");
        var r = await accounts.SetRolesAsync(uid, roles, ct);
        return r.Succeeded ? TypedResults.NoContent() : Problems.Conflict(string.Join(" ", r.Errors));
    }

    /// <summary>Luôn có "employee"; bỏ trùng.</summary>
    private static string[] NormalizeRoles(string[]? roles) =>
        [.. (roles ?? []).Select(r => r.Trim().ToLowerInvariant()).Append(Roles.Employee).Distinct()];

    /// <summary>Chỉ admin được cấp vai trò admin (HR không tự nâng quyền).</summary>
    private static ProblemHttpResult? CheckRoleGrant(ClaimsPrincipal user, string[] roles) =>
        roles.Contains(Roles.Admin) && !user.IsInRole(Roles.Admin) ? Forbidden("Chỉ admin được cấp vai trò admin") : null;

    private static async Task<bool> IsAdminTargetByNonAdminAsync(ClaimsPrincipal user, Guid targetUserId, IAccountService accounts, CancellationToken ct) =>
        !user.IsInRole(Roles.Admin) && (await accounts.GetAsync(targetUserId, ct))?.Roles.Contains(Roles.Admin) == true;

    private static ProblemHttpResult Forbidden(string msg) => TypedResults.Problem(msg, statusCode: StatusCodes.Status403Forbidden);

    /// <summary>Mật khẩu tạm 10 ký tự: chữ thường + chữ hoa + số (bỏ ký tự dễ nhầm 0/O, 1/l/I).</summary>
    internal static string GenerateTempPassword()
    {
        const string lower = "abcdefghijkmnpqrstuvwxyz", upper = "ABCDEFGHJKLMNPQRSTUVWXYZ", digits = "23456789";
        const string all = lower + upper + digits;
        var chars = new[] { Pick(lower), Pick(upper), Pick(digits) }
            .Concat(Enumerable.Range(0, 7).Select(_ => Pick(all))).ToArray();
        RandomNumberGenerator.Shuffle(chars.AsSpan());
        return new string(chars);
        static char Pick(string s) => s[RandomNumberGenerator.GetInt32(s.Length)];
    }
}
