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

/// <summary>
/// Chính sách mật khẩu + chặn khi nhập sai (nhóm <c>password</c>, TEST-260). Mặc định = quy tắc trước đây:
/// ≥ 8 ký tự, có chữ số + chữ thường; sai 5 lần → chặn 15 phút.
/// </summary>
public sealed class PasswordPolicySettings
{
    public const int DefaultMinLength = 8, MinMinLength = 8, MaxMinLength = 64;
    public const int DefaultMaxFailures = 5, MinMaxFailures = 3, MaxMaxFailures = 20;
    public const int DefaultBlockMinutes = 15, MinBlockMinutes = 1, MaxBlockMinutes = 1440;

    public int MinLength { get; init; } = DefaultMinLength;
    public bool RequireDigit { get; init; } = true;
    public bool RequireLowercase { get; init; } = true;
    public bool RequireUppercase { get; init; }
    public bool RequireNonAlphanumeric { get; init; }
    /// <summary>Số lần sai liên tiếp (mật khẩu theo tài khoản + IP; mã 2FA / mật khẩu hiện tại theo tài khoản) trước khi chặn.</summary>
    public int MaxFailures { get; init; } = DefaultMaxFailures;
    public int BlockMinutes { get; init; } = DefaultBlockMinutes;

    public TimeSpan BlockFor => TimeSpan.FromMinutes(BlockMinutes);

    /// <summary>"15 phút" / "2 giờ" / "1 giờ 30 phút" — dùng trong thông báo lỗi.</summary>
    public string BlockText => FormatDuration(BlockFor);

    public static string FormatDuration(TimeSpan d)
    {
        var m = (int)Math.Round(d.TotalMinutes);
        return m switch
        {
            < 60 => $"{m} phút",
            _ when m % 60 == 0 => $"{m / 60} giờ",
            _ => $"{m / 60} giờ {m % 60} phút",
        };
    }

    /// <summary>Mô tả quy tắc cho người dùng: "tối thiểu 8 ký tự, có chữ số, chữ thường".</summary>
    public string Describe()
    {
        var parts = new List<string>();
        if (RequireDigit) parts.Add("chữ số");
        if (RequireLowercase) parts.Add("chữ thường");
        if (RequireUppercase) parts.Add("chữ hoa");
        if (RequireNonAlphanumeric) parts.Add("ký tự đặc biệt");
        return parts.Count == 0 ? $"tối thiểu {MinLength} ký tự" : $"tối thiểu {MinLength} ký tự, có {string.Join(", ", parts)}";
    }
}

/// <summary>
/// Thông tin công ty hiển thị chung (nhóm <c>company</c>, TEST-261). Chưa lưu → tên = <c>App__Name</c>, không logo.
/// <see cref="LogoKey"/> chỉ do endpoint tải logo đặt (tiền tố <see cref="LogoPrefix"/>), không nhận từ body lưu cấu hình.
/// </summary>
public sealed class CompanySettings
{
    public const string LogoPrefix = "settings/company/";
    public const long LogoMaxBytes = 1024 * 1024;

    public string Name { get; init; } = "OfficeHub";
    public string? LegalName { get; init; }
    public string? TaxCode { get; init; }
    public string? Address { get; init; }
    public string? Phone { get; init; }
    public string? Email { get; init; }
    public string? Website { get; init; }
    public string? LogoKey { get; init; }
    /// <summary>Lần lưu gần nhất (đổi link logo để trình duyệt tải lại).</summary>
    public DateTimeOffset? UpdatedAt { get; init; }

    public static bool IsLogoKey(string? key) => key is not null && key.StartsWith(LogoPrefix, StringComparison.Ordinal) && !key.Contains("..");
}
