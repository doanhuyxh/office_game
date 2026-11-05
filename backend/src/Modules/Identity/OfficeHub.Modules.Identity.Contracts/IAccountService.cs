namespace OfficeHub.Modules.Identity.Contracts;

/// <summary>
/// Phần công khai của module Identity: module khác (Organization) dùng để tạo / quản lý tài khoản đăng nhập
/// mà không phụ thuộc vào ASP.NET Identity.
/// </summary>
public interface IAccountService
{
    /// <summary>HR tạo sẵn tài khoản với mật khẩu tạm → nhân viên bắt buộc đổi mật khẩu lần đầu.</summary>
    Task<AccountResult> CreateWithPasswordAsync(NewAccount account, string tempPassword, CancellationToken ct = default);

    /// <summary>
    /// Tạo tài khoản CHƯA có mật khẩu (chưa gửi email). Bên gọi phải lưu liên kết tới tài khoản trước,
    /// rồi mới gọi <see cref="SendInviteAsync"/> — để lỗi email không bao giờ để lại tài khoản mồ côi.
    /// </summary>
    Task<AccountResult> CreateInvitedAsync(NewAccount account, CancellationToken ct = default);

    /// <summary>
    /// Gửi (hoặc gửi lại) email mời cho tài khoản chưa đặt mật khẩu (link đặt mật khẩu, hết hạn 72 giờ).
    /// SMTP lỗi → Fail với <see cref="AccountResult.Code"/> = <see cref="AccountErrors.EmailFailed"/> (không ném exception).
    /// </summary>
    Task<AccountResult> SendInviteAsync(Guid userId, CancellationToken ct = default);

    /// <summary>HR đặt lại mật khẩu tạm (nhân viên quên mật khẩu, không có email).</summary>
    Task<AccountResult> ResetToTempPasswordAsync(Guid userId, string tempPassword, CancellationToken ct = default);

    Task<AccountResult> SetRolesAsync(Guid userId, IReadOnlyCollection<string> roles, CancellationToken ct = default);

    /// <summary>Khoá / mở khoá đăng nhập (nhân viên nghỉ việc).</summary>
    Task SetActiveAsync(Guid userId, bool active, CancellationToken ct = default);

    Task<AccountInfo?> GetAsync(Guid userId, CancellationToken ct = default);

    Task<IReadOnlyDictionary<Guid, AccountInfo>> GetManyAsync(IReadOnlyCollection<Guid> userIds, CancellationToken ct = default);

    /// <summary>Tài khoản đang hoạt động có vai trò <paramref name="role"/> (vd gửi thông báo cho mọi HR).</summary>
    Task<IReadOnlyList<AccountInfo>> ListByRoleAsync(string role, CancellationToken ct = default);
}

public sealed record NewAccount(string UserName, string? Email, string FullName, IReadOnlyCollection<string> Roles);

public sealed record AccountResult(bool Succeeded, Guid? UserId, IReadOnlyList<string> Errors, string? Code = null)
{
    public static AccountResult Ok(Guid userId) => new(true, userId, []);
    public static AccountResult Fail(params string[] errors) => new(false, null, errors);
    public static AccountResult FailWithCode(string code, string error) => new(false, null, [error], code);
}

/// <summary>Mã lỗi để bên gọi phân biệt cách xử lý (vd trả 502 khi email lỗi).</summary>
public static class AccountErrors
{
    public const string EmailFailed = "email_failed";
}

public sealed record AccountInfo(
    Guid Id,
    string UserName,
    string? Email,
    IReadOnlyList<string> Roles,
    bool IsActive,
    bool MustChangePassword,
    bool InvitePending,
    DateTimeOffset? LastLoginAt,
    string FullName = "");
