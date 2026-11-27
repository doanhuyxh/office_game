namespace OfficeHub.BuildingBlocks.Configuration;

/// <summary>Phạm vi bắt buộc xác thực 2 lớp (nhóm <c>two_factor</c>, TEST-258). Admin + HR luôn bắt buộc ở mọi phạm vi.</summary>
public static class TwoFactorScopes
{
    /// <summary>Chỉ admin + HR (mặc định, như trước TEST-258).</summary>
    public const string AdminHr = "admin_hr";
    /// <summary>Admin + HR + quản lý (vai trò manager).</summary>
    public const string Managers = "managers";
    /// <summary>Mọi tài khoản người thật (bot vẫn chỉ bắt buộc khi có vai trò admin / HR).</summary>
    public const string All = "all";
    public static readonly string[] Values = [AdminHr, Managers, All];
}

/// <summary>Chính sách bắt buộc 2FA đang có hiệu lực. Chưa lưu trên trang → <see cref="TwoFactorScopes.AdminHr"/>.</summary>
public sealed class TwoFactorSettings
{
    public string Scope { get; init; } = TwoFactorScopes.AdminHr;
}
