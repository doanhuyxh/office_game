namespace OfficeHub.Modules.Projects.Domain;

/// <summary>
/// Đánh thức bot theo dõi khi việc vào cột có tick "Đánh thức bot theo dõi" (TEST-178, thay <c>review_requested</c> TEST-161 + <c>task_done</c> TEST-166):
/// việc chỉ còn người làm + người theo dõi; bot theo dõi tự đọc hướng dẫn chức vụ + workGuide dự án để biết ở cột đó mình có việc không
/// (vd bot review làm ở "Chờ review", bot DevOps làm ở "Deploy"). Hàm thuần — test: tests/OfficeHub.Modules.Projects.Tests/FollowerWakeRulesTests.cs.
/// </summary>
public static class FollowerWakeRules
{
    /// <summary>Người theo dõi đã tra tài khoản: <paramref name="UserId"/> null = nhân viên chưa có tài khoản.</summary>
    public sealed record Follower(Guid? UserId, bool IsBot, bool IsActive);

    /// <summary>
    /// Có đánh thức không: việc vừa chuyển VÀO cột <see cref="ColumnInfo.WakeFollowers"/> từ một cột khác (đứng yên không bắn; chuyển giữa hai cột có tick vẫn bắn —
    /// mỗi cột là một bước khác nhau). Ai chuyển cũng bắn (người thật hay token AI). Tạo việc / đổi cờ cột / xoá cột không đi qua đây.
    /// </summary>
    public static bool ShouldWake(IReadOnlyList<ColumnInfo> columns, Guid from, Guid to) =>
        from != to && columns.FirstOrDefault(c => c.Id == to) is { WakeFollowers: true };

    /// <summary>Tài khoản nhận tin: người theo dõi là bot đang hoạt động, mỗi tài khoản một lần, bỏ người vừa thao tác.</summary>
    public static List<Guid> BotTargets(IEnumerable<Follower> followers, Guid? actorUserId) =>
        followers.Where(f => f is { IsBot: true, IsActive: true, UserId: not null } && f.UserId != actorUserId)
            .Select(f => f.UserId!.Value).Distinct().ToList();
}
