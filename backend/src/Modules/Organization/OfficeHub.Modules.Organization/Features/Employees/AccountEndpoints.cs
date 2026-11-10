using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Identity.Contracts;
using OfficeHub.Modules.Notification.Contracts;
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
        g.MapPost("/reset-2fa", ResetTwoFactorAsync);
        g.MapPut("/bot", SetBotAsync);
    }

    /// <summary>
    /// Đánh dấu tài khoản do bot / agent AI vận hành → bot hiện trong văn phòng 3D khi gọi MCP (không đổi quyền).
    /// Bàn giao tài khoản cho người thật → bỏ cờ.
    /// </summary>
    private static async Task<Results<NoContent, NotFound>> SetBotAsync(
        Guid id, SetBotRequest req, OrgDbContext db, IAccountService accounts, CancellationToken ct)
    {
        var e = await db.Employees.FindAsync([id], ct);
        if (e?.UserId is not { } uid || !await accounts.SetBotAsync(uid, req.IsBot, ct)) return TypedResults.NotFound();
        return TypedResults.NoContent();
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

        var mode = req.Mode?.ToLowerInvariant();
        if (mode is not ("invite" or "password"))
            return new Validation().Add("mode", "Chọn 'invite' (mời qua email) hoặc 'password' (mật khẩu tạm)").Problem();
        if (mode == "invite" && string.IsNullOrWhiteSpace(e.Email))
            return new Validation().Add("mode", "Nhân viên chưa có email, hãy nhập email hoặc chọn cấp mật khẩu tạm").Problem();

        // Thứ tự quan trọng (giữ nguyên khi sửa): 1) tạo tài khoản → 2) gắn vào hồ sơ → 3) gửi email.
        // Email lỗi ở bước 3 thì tài khoản vẫn đã gắn, HR bấm "Gửi lại lời mời" được — không còn tài khoản mồ côi.
        var temp = mode == "password" ? GenerateTempPassword() : null;
        var result = temp is null
            ? await accounts.CreateInvitedAsync(account, ct)
            : await accounts.CreateWithPasswordAsync(account, temp, ct);
        if (!result.Succeeded) return new Validation().Add("account", string.Join(" ", result.Errors)).Problem();

        e.UserId = result.UserId;
        await db.SaveChangesAsync(ct);

        if (temp is null)
        {
            var sent = await accounts.SendInviteAsync(result.UserId!.Value, ct);
            if (!sent.Succeeded)
                return sent.Code == AccountErrors.EmailFailed
                    ? EmailFailed()
                    : Problems.Conflict(string.Join(" ", sent.Errors));
        }
        return TypedResults.Ok(new AccountCreatedResponse(result.UserId!.Value, userName, temp, InviteSent: temp is null));
    }

    private static ProblemHttpResult EmailFailed() => TypedResults.Problem(
        "Đã tạo tài khoản nhưng gửi email thất bại. Kiểm tra cấu hình SMTP rồi bấm 'Gửi lại lời mời'.",
        statusCode: StatusCodes.Status502BadGateway);

    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> ResendInviteAsync(
        Guid id, OrgDbContext db, IAccountService accounts, CancellationToken ct)
    {
        var e = await db.Employees.FindAsync([id], ct);
        if (e?.UserId is not { } uid) return TypedResults.NotFound();
        var r = await accounts.SendInviteAsync(uid, ct);
        if (r.Succeeded) return TypedResults.NoContent();
        return r.Code == AccountErrors.EmailFailed
            ? TypedResults.Problem("Gửi email thất bại. Kiểm tra cấu hình SMTP rồi thử lại.", statusCode: StatusCodes.Status502BadGateway)
            : Problems.Conflict(string.Join(" ", r.Errors));
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

    /// <summary>
    /// Nhân viên mất điện thoại: tắt 2FA + xoá khoá, đăng xuất mọi phiên. Admin / HR bị buộc bật lại khi đăng nhập.
    /// Không tự đặt lại cho chính mình (tránh phiên bị chiếm tự gắn điện thoại khác); chỉ admin đặt lại cho admin.
    /// </summary>
    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> ResetTwoFactorAsync(
        Guid id, ClaimsPrincipal user, OrgDbContext db, IAccountService accounts, INotifier notifier, CancellationToken ct)
    {
        var e = await db.Employees.FindAsync([id], ct);
        if (e?.UserId is not { } uid) return TypedResults.NotFound();
        if (uid == user.GetUserId()) return Forbidden("Không thể tự đặt lại xác thực 2 lớp của chính mình — nhờ admin / HR khác");
        if (await IsAdminTargetByNonAdminAsync(user, uid, accounts, ct)) return Forbidden("Chỉ admin được đặt lại xác thực 2 lớp của admin");
        var r = await accounts.ResetTwoFactorAsync(uid, ct);
        if (!r.Succeeded) return Problems.Conflict(string.Join(" ", r.Errors));
        await notifier.NotifyAsync(new NotificationRequest([uid], NotificationCategories.AccountSecurity, "Xác thực 2 lớp đã được đặt lại",
            $"{user.FindFirstValue(ClaimNames.FullName) ?? "Bộ phận Nhân sự"} vừa đặt lại xác thực 2 lớp cho tài khoản của bạn. " +
            "Đăng nhập lại và quét mã QR mới trong ứng dụng xác thực. Nếu bạn không yêu cầu, hãy báo ngay cho bộ phận Nhân sự.",
            "/profile"), ct);
        return TypedResults.NoContent();
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
