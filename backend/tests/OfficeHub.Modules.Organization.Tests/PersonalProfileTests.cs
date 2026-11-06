using OfficeHub.Modules.Organization.Domain;

namespace OfficeHub.Modules.Organization.Tests;

public class PersonalProfileTests
{
    private static readonly DateOnly Today = new(2026, 11, 6);

    [Theory]
    [InlineData(null, true)]
    [InlineData("0901 234 567", true)]
    [InlineData("+84 901-234-567", true)]
    [InlineData("12345", false)]
    [InlineData("090abc4567", false)]
    public void Phone(string? s, bool ok) => Assert.Equal(ok, PersonalProfile.ValidPhone(s));

    [Theory]
    [InlineData("079095001234", true)]
    [InlineData("079 095 001 234", true)]     // gõ có dấu cách vẫn nhận (chuẩn hoá còn số)
    [InlineData("07909500123", false)]        // 11 số
    [InlineData("", true)]                    // rỗng = xoá
    public void Id_number(string s, bool ok) => Assert.Equal(ok, PersonalProfile.ValidIdNumber(s));

    [Fact]
    public void Normalize_keeps_digits_and_uppercases_holder()
    {
        var n = PersonalProfile.Normalize(new SensitiveChange(IdNumber: "079 095-001.234", BankAccount: "0123 4567 89", BankAccountHolder: " nguyễn văn an "));
        Assert.Equal(("079095001234", "0123456789", "NGUYỄN VĂN AN"), (n.IdNumber, n.BankAccount, n.BankAccountHolder));
    }

    [Fact]
    public void Validate_reports_each_bad_field()
    {
        var errs = PersonalProfile.Validate(new SensitiveChange(DateOfBirth: Today.AddYears(-10), IdNumber: "123", IdIssuedOn: Today.AddDays(1), BankAccount: "12ab"), Today)
            .Select(e => e.Field).ToList();
        Assert.Equal(["dateOfBirth", "idNumber", "idIssuedOn", "bankAccount"], errs);
        Assert.Contains(PersonalProfile.Validate(new SensitiveChange(), Today), e => e.Error.Contains("Chưa có thay đổi"));
        Assert.Empty(PersonalProfile.Validate(new SensitiveChange(DateOfBirth: new DateOnly(1995, 8, 15), BankName: "Vietcombank", BankAccount: "0123456789"), Today));
    }

    [Theory]
    [InlineData("079095001234", "••••••••1234")]
    [InlineData("123", "•••")]
    [InlineData(null, "")]
    public void Mask_keeps_last_four(string? s, string expected) => Assert.Equal(expected, PersonalProfile.Mask(s));
}
