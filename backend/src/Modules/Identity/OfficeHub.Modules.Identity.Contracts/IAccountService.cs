namespace OfficeHub.Modules.Identity.Contracts;

/// <summary>
/// Phần công khai của module Identity: module khác (Organization) dùng để tạo / quản lý tài khoản đăng nhập
/// mà không phụ thuộc vào ASP.NET Identity.
/// </summary>
public interface IAccountService
{
    /// <summary>HR tạo sẵn tài khoản với mật khẩu tạm → nhân viên bắt buộc đổi mật khẩu lần đầu.</summary>
    Task<AccountResult> CreateWithPasswordAsync(NewAccount account, string tempPassword, CancellationToken ct = default);

    /// <summary>Tạo tài khoản chưa có mật khẩu và gửi email mời (link đặt mật khẩu, hết hạn 72 giờ).</summary>
    Task<AccountResult> InviteAsync(NewAccount account, CancellationToken ct = default);

    /// <summary>Gửi lại email mời cho tài khoản chưa đặt mật khẩu.</summary>
    Task<AccountResult> ResendInviteAsync(Guid userId, CancellationToken ct = default);

    /// <summary>HR đặt lại mật khẩu tạm (nhân viên quên mật khẩu, không có email).</summary>
    Task<AccountResult> ResetToTempPasswordAsync(Guid userId, string tempPassword, CancellationToken ct = default);

    Task<AccountResult> SetRolesAsync(Guid userId, IReadOnlyCollection<string> roles, CancellationToken ct = default);

    /// <summary>Khoá / mở khoá đăng nhập (nhân viên nghỉ việc).</summary>
    Task SetActiveAsync(Guid userId, bool active, CancellationToken ct = default);

    Task<AccountInfo?> GetAsync(Guid userId, CancellationToken ct = default);

    Task<IReadOnlyDictionary<Guid, AccountInfo>> GetManyAsync(IReadOnlyCollection<Guid> userIds, CancellationToken ct = default);
}

public sealed record NewAccount(string UserName, string? Email, string FullName, IReadOnlyCollection<string> Roles);

public sealed record AccountResult(bool Succeeded, Guid? UserId, IReadOnlyList<string> Errors)
{
    public static AccountResult Ok(Guid userId) => new(true, userId, []);
    public static AccountResult Fail(params string[] errors) => new(false, null, errors);
}

public sealed record AccountInfo(
    Guid Id,
    string UserName,
    string? Email,
    IReadOnlyList<string> Roles,
    bool IsActive,
    bool MustChangePassword,
    bool InvitePending,
    DateTimeOffset? LastLoginAt);
