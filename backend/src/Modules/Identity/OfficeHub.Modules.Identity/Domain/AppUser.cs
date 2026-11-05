using Microsoft.AspNetCore.Identity;

namespace OfficeHub.Modules.Identity.Domain;

/// <summary>
/// Tài khoản đăng nhập. Hồ sơ nhân sự (phòng ban, hợp đồng...) nằm ở module Organization,
/// liên kết qua <c>employees.user_id</c>.
/// UserName = mã nhân viên hoặc email. Email có thể trống (HR tạo tài khoản không email).
/// </summary>
public sealed class AppUser : IdentityUser<Guid>
{
    public string FullName { get; set; } = "";
    /// <summary>true khi HR tạo tài khoản với mật khẩu tạm: bắt buộc đổi ở lần đăng nhập đầu.</summary>
    public bool MustChangePassword { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? LastLoginAt { get; set; }
}
