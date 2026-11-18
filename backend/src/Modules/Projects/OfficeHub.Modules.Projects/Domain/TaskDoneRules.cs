namespace OfficeHub.Modules.Projects.Domain;

/// <summary>
/// Đánh thức <c>task_done</c> cho bot theo dõi việc (TEST-166): vd bot DevOps theo dõi việc của dev, việc được NGƯỜI THẬT duyệt Xong → bot deploy.
/// Hàm thuần — test: tests/OfficeHub.Modules.Projects.Tests/TaskDoneRulesTests.cs.
/// </summary>
public static class TaskDoneRules
{
    /// <summary>Người theo dõi đã tra tài khoản: <paramref name="UserId"/> null = nhân viên chưa có tài khoản.</summary>
    public sealed record Follower(Guid? UserId, bool IsBot, bool IsActive);

    /// <summary>
    /// Có đánh thức không: việc chuyển từ chưa xong → xong ở lần này (đã xong chuyển giữa hai cột hoàn thành không bắn lại)
    /// và người thao tác là người thật (token AI / MCP không bắn — bot không thể tự "duyệt" để kích hoạt deploy).
    /// </summary>
    public static bool ShouldWake(bool wasDone, bool isDone, bool byAccessToken) => !wasDone && isDone && !byAccessToken;

    /// <summary>Tài khoản nhận tin: người theo dõi là bot đang hoạt động, mỗi tài khoản một lần, bỏ người vừa thao tác.</summary>
    public static List<Guid> BotTargets(IEnumerable<Follower> followers, Guid? actorUserId) =>
        followers.Where(f => f is { IsBot: true, IsActive: true, UserId: not null } && f.UserId != actorUserId)
            .Select(f => f.UserId!.Value).Distinct().ToList();
}
