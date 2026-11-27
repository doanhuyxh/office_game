using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.Modules.Identity.Domain;

namespace OfficeHub.Modules.Identity.Infrastructure;

/// <summary>
/// UserManager (scoped) áp chính sách mật khẩu + khoá đang có hiệu lực (Hệ thống → Cấu hình → Bảo mật → Mật khẩu, TEST-260):
/// <c>IOptions&lt;IdentityOptions&gt;</c> là singleton cố định lúc khởi động, nên mỗi request dựng một bản <see cref="UserManager{TUser}.Options"/>
/// riêng với Password / Lockout lấy từ <see cref="RuntimeConfig.Password"/>. PasswordValidator mặc định và AccessFailedAsync đọc Options của manager.
/// </summary>
public sealed class AppUserManager : UserManager<AppUser>
{
    public AppUserManager(
        IUserStore<AppUser> store, IOptions<IdentityOptions> optionsAccessor, IPasswordHasher<AppUser> passwordHasher,
        IEnumerable<IUserValidator<AppUser>> userValidators, IEnumerable<IPasswordValidator<AppUser>> passwordValidators,
        ILookupNormalizer keyNormalizer, IdentityErrorDescriber errors, IServiceProvider services, ILogger<UserManager<AppUser>> logger,
        RuntimeConfig runtime)
        : base(store, optionsAccessor, passwordHasher, userValidators, passwordValidators, keyNormalizer, errors, services, logger) =>
        Options = WithPolicy(optionsAccessor.Value, runtime.Password);

    /// <summary>Bản sao nông của <paramref name="b"/> (giữ ClaimsIdentity, User, Tokens…) với Password / Lockout theo <paramref name="p"/>.</summary>
    public static IdentityOptions WithPolicy(IdentityOptions b, PasswordPolicySettings p)
    {
        var o = new IdentityOptions();
        foreach (var prop in typeof(IdentityOptions).GetProperties())
            if (prop is { CanRead: true, CanWrite: true }) prop.SetValue(o, prop.GetValue(b));
        o.Password = new PasswordOptions
        {
            RequiredLength = p.MinLength, RequiredUniqueChars = b.Password.RequiredUniqueChars,
            RequireDigit = p.RequireDigit, RequireLowercase = p.RequireLowercase, RequireUppercase = p.RequireUppercase,
            RequireNonAlphanumeric = p.RequireNonAlphanumeric,
        };
        o.Lockout = new LockoutOptions
        {
            AllowedForNewUsers = b.Lockout.AllowedForNewUsers, MaxFailedAccessAttempts = p.MaxFailures, DefaultLockoutTimeSpan = p.BlockFor,
        };
        return o;
    }
}

/// <summary>Thông báo lỗi mật khẩu tiếng Việt (mặc định của Identity là tiếng Anh).</summary>
public sealed class ViIdentityErrorDescriber : IdentityErrorDescriber
{
    public override IdentityError PasswordTooShort(int length) => new() { Code = nameof(PasswordTooShort), Description = $"Mật khẩu phải có ít nhất {length} ký tự" };
    public override IdentityError PasswordRequiresDigit() => new() { Code = nameof(PasswordRequiresDigit), Description = "Mật khẩu phải có ít nhất một chữ số (0–9)" };
    public override IdentityError PasswordRequiresLower() => new() { Code = nameof(PasswordRequiresLower), Description = "Mật khẩu phải có ít nhất một chữ thường (a–z)" };
    public override IdentityError PasswordRequiresUpper() => new() { Code = nameof(PasswordRequiresUpper), Description = "Mật khẩu phải có ít nhất một chữ hoa (A–Z)" };
    public override IdentityError PasswordRequiresNonAlphanumeric() =>
        new() { Code = nameof(PasswordRequiresNonAlphanumeric), Description = "Mật khẩu phải có ít nhất một ký tự đặc biệt (vd ! @ # $)" };
    public override IdentityError PasswordRequiresUniqueChars(int uniqueChars) =>
        new() { Code = nameof(PasswordRequiresUniqueChars), Description = $"Mật khẩu phải có ít nhất {uniqueChars} ký tự khác nhau" };
    public override IdentityError PasswordMismatch() => new() { Code = nameof(PasswordMismatch), Description = "Mật khẩu hiện tại không đúng" };
    public override IdentityError InvalidToken() => new() { Code = nameof(InvalidToken), Description = "Link không hợp lệ hoặc đã hết hạn" };
}
