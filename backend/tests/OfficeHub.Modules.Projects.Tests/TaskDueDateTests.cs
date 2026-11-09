using OfficeHub.Modules.Projects.Domain;

namespace OfficeHub.Modules.Projects.Tests;

/// <summary>Hạn công việc không được trước hôm nay (giữ nguyên hạn cũ đã qua khi sửa thì được).</summary>
public class TaskDueDateTests
{
    private static readonly DateOnly Today = new(2026, 11, 9);

    [Theory]
    [InlineData(null, null, true)]            // không đặt hạn
    [InlineData("2026-11-09", null, true)]    // hôm nay
    [InlineData("2026-11-20", null, true)]    // tương lai
    [InlineData("2026-11-08", null, false)]   // tạo mới với ngày đã qua
    [InlineData("2026-11-01", "2026-11-01", true)]  // sửa việc quá hạn, giữ nguyên hạn
    [InlineData("2026-11-02", "2026-11-01", false)] // đổi sang ngày khác vẫn đã qua
    public void DueDateError(string? due, string? previous, bool ok) =>
        Assert.Equal(ok, EffortRules.DueDateError(due is null ? null : DateOnly.Parse(due), previous is null ? null : DateOnly.Parse(previous), Today) is null);
}
