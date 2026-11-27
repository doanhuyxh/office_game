using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.Modules.Organization.Features.Employees;

namespace OfficeHub.Modules.Organization.Tests;

/// <summary>TEST-260: mật khẩu tạm HR cấp luôn đạt chính sách mật khẩu đang áp dụng.</summary>
public class TempPasswordTests
{
    [Fact]
    public void Default_policy_ten_chars_with_lower_upper_digit()
    {
        for (var i = 0; i < 50; i++)
        {
            var p = AccountEndpoints.GenerateTempPassword(new PasswordPolicySettings());
            Assert.Equal(10, p.Length);
            Assert.Contains(p, char.IsAsciiLetterLower);
            Assert.Contains(p, char.IsAsciiLetterUpper);
            Assert.Contains(p, char.IsAsciiDigit);
        }
    }

    [Fact]
    public void Strict_policy_longer_with_special_char()
    {
        for (var i = 0; i < 50; i++)
        {
            var p = AccountEndpoints.GenerateTempPassword(new PasswordPolicySettings { MinLength = 16, RequireNonAlphanumeric = true });
            Assert.Equal(16, p.Length);
            Assert.Contains(p, c => !char.IsLetterOrDigit(c));
        }
    }
}
