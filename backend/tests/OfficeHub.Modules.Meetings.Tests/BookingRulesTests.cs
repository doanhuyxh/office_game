using OfficeHub.Modules.Meetings.Domain;

namespace OfficeHub.Modules.Meetings.Tests;

public class BookingRulesTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 6, 2, 0, 0, TimeSpan.Zero); // 09:00 giờ VN
    private static DateTimeOffset Vn(int day, int h, int m = 0) => new(2026, 11, day, h, m, 0, TimeSpan.FromHours(7));

    [Fact]
    public void Valid_booking_has_no_errors() => Assert.Empty(BookingRules.Validate(Vn(6, 10), Vn(6, 11), Now));

    [Theory]
    [InlineData(10, 0, 10, 0, "endAt")]   // kết thúc = bắt đầu
    [InlineData(10, 0, 10, 10, "endAt")]  // < 15 phút
    [InlineData(9, 0, 17, 30, "endAt")]   // > 8 giờ
    [InlineData(8, 0, 8, 30, "startAt")]  // quá khứ (> 5 phút)
    public void Invalid_ranges(int sh, int sm, int eh, int em, string field) =>
        Assert.Contains(BookingRules.Validate(Vn(6, sh, sm), Vn(6, eh, em), Now), e => e.Field == field);

    [Fact]
    public void Allows_booking_that_started_a_few_minutes_ago() =>
        Assert.Empty(BookingRules.Validate(Vn(6, 8, 57), Vn(6, 10), Now));

    [Fact]
    public void Rejects_far_future() =>
        Assert.Contains(BookingRules.Validate(Now.AddDays(61), Now.AddDays(61).AddHours(1), Now), e => e.Field == "startAt");

    [Fact]
    public void Overlap_is_half_open()
    {
        Assert.True(BookingRules.Overlaps(Vn(6, 9), Vn(6, 10), Vn(6, 9, 30), Vn(6, 10, 30)));
        Assert.True(BookingRules.Overlaps(Vn(6, 9), Vn(6, 12), Vn(6, 10), Vn(6, 11)));
        Assert.False(BookingRules.Overlaps(Vn(6, 9), Vn(6, 10), Vn(6, 10), Vn(6, 11)));   // sát nhau không trùng
        // Cùng thời điểm nhưng khác cách viết múi giờ vẫn so đúng
        Assert.True(BookingRules.Overlaps(Vn(6, 9), Vn(6, 10), new DateTimeOffset(2026, 11, 6, 2, 30, 0, TimeSpan.Zero), Vn(6, 11)));
    }
}
