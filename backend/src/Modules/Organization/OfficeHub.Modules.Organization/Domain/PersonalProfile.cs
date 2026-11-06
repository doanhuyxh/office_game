using System.Text.RegularExpressions;

namespace OfficeHub.Modules.Organization.Domain;

/// <summary>Các trường cần HR duyệt. null = không đổi trường đó; chuỗi rỗng = xoá giá trị.</summary>
public sealed record SensitiveChange(
    DateOnly? DateOfBirth = null, bool ClearDateOfBirth = false,
    string? IdNumber = null, DateOnly? IdIssuedOn = null, string? IdIssuedPlace = null,
    string? BankName = null, string? BankAccount = null, string? BankAccountHolder = null)
{
    public bool IsEmpty => DateOfBirth is null && !ClearDateOfBirth && IdNumber is null && IdIssuedOn is null && IdIssuedPlace is null
                           && BankName is null && BankAccount is null && BankAccountHolder is null;
}

/// <summary>
/// Quy tắc thông tin cá nhân (chủ dự án chốt 2026-11-06): liên hệ (điện thoại, địa chỉ, người liên hệ khẩn cấp, ảnh) nhân viên tự sửa,
/// có hiệu lực ngay; ngày sinh / CCCD / tài khoản ngân hàng → yêu cầu, HR duyệt; email chỉ HR đổi.
/// Hàm thuần — test ở tests/OfficeHub.Modules.Organization.Tests.
/// </summary>
public static partial class PersonalProfile
{
    public const int AddressMax = 300;
    public const int NameMax = 200;
    public const int RelationMax = 50;
    public const int AvatarMaxBytes = 2 * 1024 * 1024;
    public static readonly Dictionary<string, string> AvatarTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        ["image/jpeg"] = "jpg", ["image/png"] = "png", ["image/webp"] = "webp",
    };

    [GeneratedRegex(@"^\+?[0-9 .\-()]{8,20}$")] private static partial Regex PhoneRx();
    [GeneratedRegex(@"^[0-9]{12}$")] private static partial Regex IdRx();          // CCCD gắn chip: 12 số
    [GeneratedRegex(@"^[0-9]{6,20}$")] private static partial Regex BankAccountRx();

    /// <summary>Bỏ khoảng trắng / dấu chấm / gạch (người dùng hay gõ "0123 456 789").</summary>
    public static string Digits(string s) => new(s.Where(char.IsDigit).ToArray());

    public static bool ValidPhone(string? s) => string.IsNullOrWhiteSpace(s) || PhoneRx().IsMatch(s.Trim());
    public static bool ValidIdNumber(string? s) => string.IsNullOrEmpty(s) || IdRx().IsMatch(Digits(s));
    public static bool ValidBankAccount(string? s) => string.IsNullOrEmpty(s) || BankAccountRx().IsMatch(Digits(s));

    /// <summary>Che số, giữ 4 số cuối: "079095001234" → "••••••••1234".</summary>
    public static string Mask(string? s) => string.IsNullOrEmpty(s) ? "" : s.Length <= 4 ? new string('•', s.Length) : new string('•', s.Length - 4) + s[^4..];

    /// <summary>Kiểm tra yêu cầu đổi thông tin nhạy cảm. Trả (field camelCase, lỗi).</summary>
    public static IEnumerable<(string Field, string Error)> Validate(SensitiveChange c, DateOnly today)
    {
        if (c.IsEmpty) yield return ("", "Chưa có thay đổi nào");
        if (c.DateOfBirth is { } dob && (dob > today.AddYears(-15) || dob < today.AddYears(-80)))
            yield return ("dateOfBirth", "Ngày sinh không hợp lệ (từ 15 đến 80 tuổi)");
        if (!ValidIdNumber(c.IdNumber)) yield return ("idNumber", "Số CCCD gồm 12 chữ số");
        if (c.IdIssuedOn is { } iss && (iss > today || iss < today.AddYears(-30))) yield return ("idIssuedOn", "Ngày cấp CCCD không hợp lệ");
        if (c.IdIssuedPlace is { Length: > NameMax }) yield return ("idIssuedPlace", $"Nơi cấp tối đa {NameMax} ký tự");
        if (c.BankName is { Length: > 100 }) yield return ("bankName", "Tên ngân hàng tối đa 100 ký tự");
        if (!ValidBankAccount(c.BankAccount)) yield return ("bankAccount", "Số tài khoản gồm 6–20 chữ số");
        if (c.BankAccountHolder is { Length: > NameMax }) yield return ("bankAccountHolder", $"Chủ tài khoản tối đa {NameMax} ký tự");
    }

    /// <summary>Chuẩn hoá trước khi lưu: số CCCD / tài khoản chỉ giữ chữ số; chủ tài khoản viết HOA (giống trên thẻ / sao kê).</summary>
    public static SensitiveChange Normalize(SensitiveChange c) => c with
    {
        IdNumber = c.IdNumber is null ? null : Digits(c.IdNumber),
        IdIssuedPlace = c.IdIssuedPlace?.Trim(),
        BankName = c.BankName?.Trim(),
        BankAccount = c.BankAccount is null ? null : Digits(c.BankAccount),
        BankAccountHolder = c.BankAccountHolder?.Trim().ToUpperInvariant(),
    };
}
