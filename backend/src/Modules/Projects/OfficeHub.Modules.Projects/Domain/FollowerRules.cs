namespace OfficeHub.Modules.Projects.Domain;

/// <summary>Người theo dõi việc (TEST-160). Hàm thuần — test: tests/OfficeHub.Modules.Projects.Tests/FollowerRulesTests.cs.</summary>
public static class FollowerRules
{
    /// <summary>Số người theo dõi tối đa của một việc (đủ cho cả nhóm + vài bot, chặn spam).</summary>
    public const int MaxFollowers = 30;

    /// <summary>
    /// Lỗi khi thêm người theo dõi (null = được thêm). Đã theo dõi rồi → không lỗi (thêm lại là no-op).
    /// <paramref name="isMember"/> = người được thêm là thành viên dự án; <paramref name="currentCount"/> = số người đang theo dõi.
    /// </summary>
    public static string? AddError(bool isMember, bool alreadyFollowing, int currentCount)
    {
        if (alreadyFollowing) return null;
        if (!isMember) return "Người theo dõi phải là thành viên dự án";
        return currentCount >= MaxFollowers ? $"Tối đa {MaxFollowers} người theo dõi một việc" : null;
    }
}
