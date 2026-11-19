namespace OfficeHub.Modules.Projects.Domain;

/// <summary>
/// Đánh thức bot theo dõi khi việc vào cột có tick "Đánh thức bot theo dõi" (TEST-178, thay <c>review_requested</c> TEST-161 + <c>task_done</c> TEST-166):
/// việc chỉ còn người làm + người theo dõi; bot theo dõi tự đọc hướng dẫn chức vụ + workGuide dự án để biết ở cột đó mình có việc không
/// (vd bot review làm ở "Chờ review", bot DevOps làm ở "Deploy"). Hàm thuần — test: tests/OfficeHub.Modules.Projects.Tests/FollowerWakeRulesTests.cs.
/// </summary>
public static class FollowerWakeRules
{
    /// <summary>Người theo dõi đã tra tài khoản: <paramref name="UserId"/> null = nhân viên chưa có tài khoản. <paramref name="EmployeeId"/> để so với
    /// danh sách bot của cột (TEST-184).</summary>
    public sealed record Follower(Guid? UserId, bool IsBot, bool IsActive, Guid EmployeeId = default);

    /// <summary>
    /// Có đánh thức không: việc vừa chuyển VÀO cột <see cref="ColumnInfo.WakeFollowers"/> từ một cột khác (đứng yên không bắn; chuyển giữa hai cột có tick vẫn bắn —
    /// mỗi cột là một bước khác nhau). Ai chuyển cũng bắn (người thật hay token AI). Tạo việc / đổi cờ cột / xoá cột không đi qua đây.
    /// </summary>
    public static bool ShouldWake(IReadOnlyList<ColumnInfo> columns, Guid from, Guid to) =>
        from != to && columns.FirstOrDefault(c => c.Id == to) is { WakeFollowers: true };

    /// <summary>
    /// Tài khoản nhận tin: người theo dõi là bot đang hoạt động, mỗi tài khoản một lần, bỏ người vừa thao tác.
    /// <paramref name="wakeBotIds"/> (TEST-184, Id nhân viên chọn ở cột): rỗng / null = mọi bot theo dõi; có phần tử = chỉ bot vừa theo dõi việc vừa nằm trong danh sách —
    /// bot được chọn mà không theo dõi việc thì không đánh thức; không bot nào hợp lệ thì không ai (không quay về "tất cả").
    /// </summary>
    public static List<Guid> BotTargets(IEnumerable<Follower> followers, Guid? actorUserId, IReadOnlyCollection<Guid>? wakeBotIds = null) =>
        followers.Where(f => f is { IsBot: true, IsActive: true, UserId: not null } && f.UserId != actorUserId
                && (wakeBotIds is not { Count: > 0 } || wakeBotIds.Contains(f.EmployeeId)))
            .Select(f => f.UserId!.Value).Distinct().ToList();

    /// <summary>Chuẩn hoá danh sách bot chọn ở cột: bỏ trùng, bỏ Guid rỗng; tắt "Đánh thức bot theo dõi" thì rỗng.</summary>
    public static List<Guid> NormalizeBotIds(IEnumerable<Guid>? ids, bool wakeFollowers) =>
        wakeFollowers ? (ids ?? []).Where(i => i != Guid.Empty).Distinct().ToList() : [];

    /// <summary>Lỗi danh sách bot của cột: mỗi Id phải là thành viên dự án là tài khoản bot (<paramref name="memberBotIds"/>). null = hợp lệ.</summary>
    public static string? BotIdsError(IReadOnlyCollection<Guid> ids, IReadOnlySet<Guid> memberBotIds) =>
        ids.All(memberBotIds.Contains) ? null : "Chỉ chọn được bot là thành viên dự án";
}
