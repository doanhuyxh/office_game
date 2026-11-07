using OfficeHub.Modules.Assets.Domain;

namespace OfficeHub.Modules.Assets.Tests;

public class AssetRulesTests
{
    [Fact]
    public void DeviceCode_PadsSequence() => Assert.Equal("TB-MT-00042", AssetRules.DeviceCode("MT", 42));

    [Theory]
    [InlineData(DeviceStatus.InStock, true, null)]
    [InlineData(DeviceStatus.InUse, true, "Thiết bị đang có người dùng, hãy thu hồi trước")]
    [InlineData(DeviceStatus.Repair, true, "Thiết bị đang bảo trì")]
    [InlineData(DeviceStatus.Retired, true, "Thiết bị đã thanh lý hoặc mất")]
    [InlineData(DeviceStatus.Lost, true, "Thiết bị đã thanh lý hoặc mất")]
    [InlineData(DeviceStatus.InStock, false, "Nhân viên đã nghỉ việc hoặc không tồn tại")]
    public void CannotAssign(DeviceStatus status, bool active, string? expected) => Assert.Equal(expected, AssetRules.CannotAssign(status, active));

    [Theory]
    [InlineData(DeviceStatus.InStock, DeviceStatus.Repair, null, null)]
    [InlineData(DeviceStatus.Repair, DeviceStatus.InStock, null, null)]
    [InlineData(DeviceStatus.InStock, DeviceStatus.Retired, "hỏng", null)]
    [InlineData(DeviceStatus.InUse, DeviceStatus.Lost, "mất máy", null)]
    [InlineData(DeviceStatus.InStock, DeviceStatus.Retired, " ", "Cần nhập lý do")]
    [InlineData(DeviceStatus.InStock, DeviceStatus.Lost, null, "Cần nhập lý do")]
    [InlineData(DeviceStatus.InUse, DeviceStatus.Repair, null, "Thiết bị đang có người dùng, hãy thu hồi trước")]
    [InlineData(DeviceStatus.InUse, DeviceStatus.Retired, "x", "Thiết bị đang có người dùng, hãy thu hồi trước")]
    [InlineData(DeviceStatus.Retired, DeviceStatus.InStock, null, "Thiết bị đã thanh lý hoặc mất, không đổi trạng thái được")]
    [InlineData(DeviceStatus.Lost, DeviceStatus.Repair, null, "Thiết bị đã thanh lý hoặc mất, không đổi trạng thái được")]
    [InlineData(DeviceStatus.InStock, DeviceStatus.InUse, null, "Dùng chức năng \"Cấp phát\" để giao thiết bị")]
    [InlineData(DeviceStatus.InStock, DeviceStatus.InStock, null, "Thiết bị đang ở trạng thái này")]
    public void CannotChangeStatus(DeviceStatus from, DeviceStatus to, string? reason, string? expected) =>
        Assert.Equal(expected, AssetRules.CannotChangeStatus(from, to, reason));

    [Theory]
    [InlineData(ServiceStatus.Active, null, 100, null)]
    [InlineData(ServiceStatus.Active, 5, 4, null)]
    [InlineData(ServiceStatus.Active, 5, 5, "Đã hết ghế")]
    [InlineData(ServiceStatus.Cancelled, null, 0, "Dịch vụ đã huỷ")]
    public void CannotGrantSeat(ServiceStatus status, int? limit, int used, string? expected) =>
        Assert.Equal(expected, AssetRules.CannotGrantSeat(status, limit, used));

    private static readonly DateOnly Today = new(2026, 11, 8);

    [Theory]
    [InlineData(null, false, false, 0)]
    [InlineData(31, false, false, 0)]    // chưa tới 30 ngày
    [InlineData(-1, false, false, 0)]    // đã qua hạn: không nhắc
    [InlineData(30, false, false, 30)]
    [InlineData(30, true, false, 0)]     // đã nhắc 30
    [InlineData(10, false, false, 30)]
    [InlineData(10, true, false, 0)]
    [InlineData(7, false, false, 7)]
    [InlineData(7, true, false, 7)]      // đã nhắc 30 nhưng chưa nhắc 7
    [InlineData(7, true, true, 0)]
    [InlineData(0, false, false, 7)]
    public void DueReminder(int? daysLeft, bool r30, bool r7, int expected) =>
        Assert.Equal(expected, AssetRules.DueReminder(daysLeft is { } n ? Today.AddDays(n) : null, Today, r30, r7));

    [Fact]
    public void MonthlyCost_ConvertsYearly()
    {
        Assert.Equal(100_000m, AssetRules.MonthlyCost(BillingCycle.Monthly, 100_000m));
        Assert.Equal(100_000m, AssetRules.MonthlyCost(BillingCycle.Yearly, 1_200_000m));
        Assert.Equal(0m, AssetRules.MonthlyCost(BillingCycle.None, 999m));
        Assert.Equal(0m, AssetRules.MonthlyCost(BillingCycle.Monthly, null));
    }
}
