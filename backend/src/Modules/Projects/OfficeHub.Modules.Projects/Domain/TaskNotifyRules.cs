namespace OfficeHub.Modules.Projects.Domain;

/// <summary>
/// Chuông chung cho cả dự án khi việc được tạo / đổi cột / có bình luận (TEST-32, 2026-11-12).
/// Hàm thuần — test: tests/OfficeHub.Modules.Projects.Tests/TaskNotifyRulesTests.cs.
/// </summary>
public static class TaskNotifyRules
{
    public const int MaxBody = 300;

    /// <summary>
    /// Tài khoản nhận chuông chung: thành viên còn làm, có tài khoản, không phải người thao tác, chưa nhận chuông riêng
    /// (giao việc, chờ duyệt, @nhắc…) cho cùng sự kiện — mỗi người tối đa một chuông / sự kiện.
    /// </summary>
    public static List<Guid> Recipients(IEnumerable<(Guid? UserId, bool IsActive)> members, Guid actorUserId, IEnumerable<Guid> alreadyNotified)
    {
        var skip = alreadyNotified.Append(actorUserId).ToHashSet();
        return members.Where(m => m.IsActive && m.UserId is { } u && !skip.Contains(u)).Select(m => m.UserId!.Value).Distinct().ToList();
    }

    public static string Body(string s) => s.Length > MaxBody ? s[..MaxBody] + "…" : s;
}
