using OfficeHub.Modules.Assets.Domain;

namespace OfficeHub.Modules.Assets.Tests;

/// <summary>Khấu hao đường thẳng, tệp đính kèm thiết bị, biên bản giao nhận (AssetRules).</summary>
public class DepreciationHandoverTests
{
    private static DateOnly D(int y, int m, int d) => new(y, m, d);

    [Theory]
    [InlineData("2026-01-15", "2026-01-15", 0)]
    [InlineData("2026-01-15", "2026-02-14", 0)]
    [InlineData("2026-01-15", "2026-02-15", 1)]
    [InlineData("2026-01-31", "2026-02-28", 1)] // cuối tháng
    [InlineData("2024-01-31", "2024-02-29", 1)]
    [InlineData("2026-01-31", "2026-03-30", 1)]
    [InlineData("2026-01-31", "2026-03-31", 2)]
    [InlineData("2025-11-09", "2026-11-09", 12)]
    [InlineData("2026-05-01", "2026-04-01", 0)] // ngày mua sau hôm nay
    public void FullMonthsBetween(string from, string to, int expected) =>
        Assert.Equal(expected, AssetRules.FullMonthsBetween(DateOnly.Parse(from), DateOnly.Parse(to)));

    [Fact]
    public void Depreciate_StraightLineMonthly()
    {
        var r = AssetRules.Depreciate(36_000_000m, D(2026, 1, 10), 36, D(2026, 11, 9), DeviceStatus.InUse)!;
        Assert.Equal(9, r.MonthsUsed); // 10/01 → 09/11: 9 tháng trọn
        Assert.Equal(9_000_000m, r.Accumulated);
        Assert.Equal(27_000_000m, r.BookValue);
    }

    [Fact]
    public void Depreciate_RoundsToDong_AndEndsAtZero()
    {
        var r = AssetRules.Depreciate(10_000_000m, D(2026, 1, 1), 36, D(2026, 2, 1), DeviceStatus.InStock)!;
        Assert.Equal(277_778m, r.Accumulated); // 10 000 000 / 36 = 277 777,78
        var end = AssetRules.Depreciate(10_000_000m, D(2020, 1, 1), 36, D(2026, 2, 1), DeviceStatus.InStock)!;
        Assert.Equal(36, end.MonthsUsed);
        Assert.Equal(10_000_000m, end.Accumulated);
        Assert.Equal(0m, end.BookValue);
    }

    [Fact]
    public void Depreciate_MissingData_ReturnsNull()
    {
        Assert.Null(AssetRules.Depreciate(null, D(2026, 1, 1), 36, D(2026, 6, 1), DeviceStatus.InUse));
        Assert.Null(AssetRules.Depreciate(1_000m, null, 36, D(2026, 6, 1), DeviceStatus.InUse));
    }

    [Theory]
    [InlineData(null)]
    [InlineData(0)]
    public void Depreciate_NoMonths_KeepsFullValue(int? months)
    {
        var r = AssetRules.Depreciate(5_000_000m, D(2020, 1, 1), months, D(2026, 6, 1), DeviceStatus.InUse)!;
        Assert.Equal(0m, r.Accumulated);
        Assert.Equal(5_000_000m, r.BookValue);
    }

    [Theory]
    [InlineData(DeviceStatus.Retired)]
    [InlineData(DeviceStatus.Lost)]
    public void Depreciate_RetiredOrLost_BookValueZero(DeviceStatus status)
    {
        Assert.Equal(0m, AssetRules.Depreciate(12_000_000m, D(2026, 1, 1), 24, D(2026, 3, 1), status)!.BookValue);
        Assert.Equal(0m, AssetRules.Depreciate(12_000_000m, D(2026, 1, 1), null, D(2026, 3, 1), status)!.BookValue);
    }

    [Fact]
    public void EffectiveMonths_DeviceOverridesCategory()
    {
        Assert.Equal(24, AssetRules.EffectiveMonths(24, 36));
        Assert.Equal(0, AssetRules.EffectiveMonths(0, 36)); // 0 = thiết bị không khấu hao
        Assert.Equal(36, AssetRules.EffectiveMonths(null, 36));
        Assert.Null(AssetRules.EffectiveMonths(null, null));
    }

    [Theory]
    [InlineData("MT", 36)]
    [InlineData("MH", 36)]
    [InlineData("KH", 36)]
    [InlineData("DT", 24)]
    [InlineData("PK", 24)]
    [InlineData("XX", null)]
    public void DefaultDepreciationMonths(string code, int? expected) => Assert.Equal(expected, AssetRules.DefaultDepreciationMonths(code));

    [Theory]
    [InlineData(AttachmentKind.Photo, "may.jpg", 1000, true)]
    [InlineData(AttachmentKind.Photo, "hoa-don.pdf", 1000, false)]
    [InlineData(AttachmentKind.Invoice, "hoa-don.pdf", 1000, true)]
    [InlineData(AttachmentKind.Invoice, "hddt.XML", 1000, true)]
    [InlineData(AttachmentKind.Invoice, "bang.xlsx", 1000, false)]
    [InlineData(AttachmentKind.Other, "bang.xlsx", 1000, true)]
    [InlineData(AttachmentKind.Other, "virus.exe", 1000, false)]
    [InlineData(AttachmentKind.Photo, "may.jpg", 0, false)]
    [InlineData(AttachmentKind.Photo, "may.jpg", 20 * 1024 * 1024 + 1, false)]
    public void ValidateAttachment(AttachmentKind kind, string name, long size, bool ok) =>
        Assert.Equal(ok, AssetRules.ValidateAttachment(kind, name, size).Count == 0);

    [Fact]
    public void AttachmentKey_IsSafe()
    {
        var dev = Guid.Parse("0196a000-0000-7000-8000-000000000001");
        var id = Guid.Parse("0196a000-0000-7000-8000-000000000002");
        Assert.Equal($"assets/devices/{dev:N}/{id:N}/H_a___n_b_n.pdf", AssetRules.AttachmentKey(dev, id, "Hóa đơn bán.pdf"));
        Assert.EndsWith("/file", AssetRules.AttachmentKey(dev, id, "ảồ"));
    }

    [Fact]
    public void CleanFileName_StripsPath() => Assert.Equal("a.pdf", AssetRules.CleanFileName("C:\\tmp\\a.pdf"));

    [Fact]
    public void HandoverNumber_Pads() => Assert.Equal("BB-2026-00007", AssetRules.HandoverNumber(2026, 7));

    [Theory]
    [InlineData(false, true, false, "Chỉ người nhận / trả thiết bị xác nhận biên bản")]
    [InlineData(true, false, false, "Biên bản này không cần xác nhận")]
    [InlineData(true, true, true, "Biên bản đã được xác nhận")]
    [InlineData(true, true, false, null)]
    public void CannotConfirmHandover(bool owner, bool requires, bool confirmed, string? expected) =>
        Assert.Equal(expected, AssetRules.CannotConfirmHandover(owner, requires, confirmed));

    [Fact]
    public void HandoverReminderDue_AfterThreeDaysOnce()
    {
        var created = new DateTimeOffset(2026, 11, 1, 3, 0, 0, TimeSpan.Zero);
        Assert.False(AssetRules.HandoverReminderDue(true, null, null, created, created.AddDays(2.9)));
        Assert.True(AssetRules.HandoverReminderDue(true, null, null, created, created.AddDays(3)));
        Assert.False(AssetRules.HandoverReminderDue(true, null, created.AddDays(3), created, created.AddDays(5))); // đã nhắc
        Assert.False(AssetRules.HandoverReminderDue(true, created.AddDays(1), null, created, created.AddDays(5))); // đã xác nhận
        Assert.False(AssetRules.HandoverReminderDue(false, null, null, created, created.AddDays(5))); // không cần xác nhận
    }
}
