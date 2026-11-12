using OfficeHub.Modules.Notification.Features;

namespace OfficeHub.Modules.Notification.Tests;

public class ChannelLabelsTests
{
    [Fact]
    public void Health_rules()
    {
        var now = DateTimeOffset.UnixEpoch.AddDays(10);
        Assert.Equal("off", ChannelLabels.Health(false, false, null, null, now));
        Assert.Equal("off", ChannelLabels.Health(true, false, null, now, now));
        Assert.Equal("ok", ChannelLabels.Health(true, true, null, null, now));
        Assert.Equal("error", ChannelLabels.Health(true, true, now.AddHours(-2), now.AddHours(-1), now));
        Assert.Equal("ok", ChannelLabels.Health(true, true, now.AddHours(-1), now.AddHours(-2), now));
        Assert.Equal("ok", ChannelLabels.Health(true, true, null, now.AddDays(-2), now)); // lỗi cũ hơn 24 giờ
        Assert.Equal("error", ChannelLabels.Health(true, true, now, null, now, initError: true));
        // lỗi với cấu hình cũ (trước lần lưu gần nhất) không tính
        Assert.Equal("ok", ChannelLabels.Health(true, true, null, now.AddHours(-2), now, configChangedAt: now.AddHours(-1)));
        Assert.Equal("error", ChannelLabels.Health(true, true, null, now.AddMinutes(-5), now, configChangedAt: now.AddHours(-1)));
    }
}
