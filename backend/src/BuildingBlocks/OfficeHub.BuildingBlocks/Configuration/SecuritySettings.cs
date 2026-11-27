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

/// <summary>
/// Thời hạn phiên đăng nhập web (nhóm <c>session</c>, TEST-259). Chưa lưu = 7 ngày không hoạt động, không giới hạn tối đa (như trước).
/// </summary>
public sealed class SessionSettings
{
    public const int DefaultIdleHours = 168, MinIdleHours = 1, MaxIdleHours = 720, MaxMaxDays = 365;

    /// <summary>Không có request nào trong khoảng này → phiên hết hạn (cookie trượt).</summary>
    public int IdleHours { get; init; } = DefaultIdleHours;
    /// <summary>Bắt đăng nhập lại sau tối đa N ngày kể từ lúc đăng nhập; 0 = không giới hạn.</summary>
    public int MaxDays { get; init; }

    public TimeSpan Idle => TimeSpan.FromHours(IdleHours);
    public TimeSpan? MaxAge => MaxDays > 0 ? TimeSpan.FromDays(MaxDays) : null;
}
