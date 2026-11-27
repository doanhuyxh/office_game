namespace OfficeHub.Modules.Projects.Domain;

/// <summary>
/// TEST-247: việc vừa sang hoàn thành → báo bot người làm + bot theo dõi (Telegram <c>task_closed</c>) để bộ điều phối trên máy agent dọn ngay
/// worktree / transcript của việc. Không phải đánh thức làm việc: không chạy agent, nên gửi cả cho người vừa chuyển và cả khi dự án đã đóng.
/// </summary>
public static class ClosedTaskWakeRules
{
    /// <summary>Có gửi không: việc chuyển từ trạng thái chưa xong (hoặc cột không còn) VÀO trạng thái hoàn thành. Giữa hai trạng thái hoàn thành / đứng yên → không.</summary>
    public static bool ShouldWake(IReadOnlyList<ColumnInfo> columns, Guid from, Guid to) =>
        from != to && columns.FirstOrDefault(c => c.Id == to) is { IsDone: true } && columns.FirstOrDefault(c => c.Id == from) is not { IsDone: true };

    /// <summary>Tài khoản nhận tin: người làm + người theo dõi là bot đang hoạt động, mỗi tài khoản một lần (KHÔNG bỏ người thao tác).</summary>
    public static List<Guid> BotTargets(IEnumerable<FollowerWakeRules.Follower> people) =>
        people.Where(f => f is { IsBot: true, IsActive: true, UserId: not null }).Select(f => f.UserId!.Value).Distinct().ToList();
}
