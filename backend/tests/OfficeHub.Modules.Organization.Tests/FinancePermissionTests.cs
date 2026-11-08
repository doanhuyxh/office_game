using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Organization.Tests;

public class FinancePermissionTests
{
    [Theory]
    [InlineData(0, FinancePermission.None)]
    [InlineData(1, FinancePermission.View)]
    [InlineData(2, FinancePermission.View | FinancePermission.Record)]    // ghi sổ ⇒ xem
    [InlineData(4, FinancePermission.View | FinancePermission.Approve)]   // duyệt ⇒ xem
    [InlineData(8, FinancePermission.View | FinancePermission.Admin)]     // quản trị ⇒ xem
    [InlineData(15, FinancePermission.View | FinancePermission.Record | FinancePermission.Approve | FinancePermission.Admin)]
    public void Higher_permissions_imply_view(int bits, FinancePermission expected) =>
        Assert.Equal(expected, FinancePermissions.Normalize(bits));

    [Theory]
    [InlineData(0, true)]
    [InlineData(15, true)]
    [InlineData(16, false)]  // bit lạ
    [InlineData(-1, false)]
    public void Only_defined_bits_are_valid(int bits, bool valid) => Assert.Equal(valid, FinancePermissions.IsValid(bits));

    [Fact]
    public void None_never_satisfies_a_requirement() =>
        Assert.False(FinancePermission.View.Has(FinancePermission.None));

    [Fact]
    public void Has_requires_every_requested_bit()
    {
        var accountant = FinancePermissions.Normalize((int)FinancePermission.Record);
        Assert.True(accountant.Has(FinancePermission.View));
        Assert.True(accountant.Has(FinancePermission.Record));
        Assert.False(accountant.Has(FinancePermission.Approve));
        Assert.False(accountant.Has(FinancePermission.Record | FinancePermission.Approve));
    }
}
