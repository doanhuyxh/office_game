using OfficeHub.Modules.Projects.Domain;

namespace OfficeHub.Modules.Projects.Tests;

public class BotWaitRulesTests
{
    private static readonly DateTimeOffset T0 = new(2026, 11, 16, 3, 0, 0, TimeSpan.Zero);
    private static readonly Guid BotA = Guid.NewGuid(), BotB = Guid.NewGuid(), Human = Guid.NewGuid();

    private static WaitEvent Bot(int min, Guid? actor = null, bool counts = true) => new(T0.AddMinutes(min), true, actor ?? BotA, counts);
    private static WaitEvent Person(int min) => new(T0.AddMinutes(min), false, Human, false);

    [Fact]
    public void Bot_comment_last_is_waiting_since_that_comment()
    {
        Assert.Equal(T0.AddMinutes(5), BotWaitRules.WaitingSince([Person(1), Bot(2), Bot(5)], BotA));
        Assert.Null(BotWaitRules.WaitingSince([], BotA));
    }

    [Fact]
    public void Human_event_after_bot_stops_waiting()
    {
        Assert.Null(BotWaitRules.WaitingSince([Bot(1), Person(2)], BotA));
        // người thật sửa nội dung / đổi hạn / xoá bình luận cũng tính là đã xem (Counts = false nhưng !ByBot)
        Assert.Null(BotWaitRules.WaitingSince([Bot(1), new WaitEvent(T0.AddMinutes(3), false, Human, false)], BotA));
    }

    [Fact]
    public void Other_bot_assigning_task_is_not_waiting()
    {
        Assert.Null(BotWaitRules.WaitingSince([Bot(1, BotB)], BotA));
        Assert.Null(BotWaitRules.WaitingSince([Bot(1, BotA), Bot(2, BotB)], BotA));
    }

    [Fact]
    public void Bot_non_counting_events_are_ignored()
    {
        // bot sửa nội dung / đổi hạn sau khi bình luận → vẫn chờ, tính từ bình luận
        Assert.Equal(T0.AddMinutes(1), BotWaitRules.WaitingSince([Bot(1), Bot(4, counts: false), Bot(6, BotB, counts: false)], BotA));
        // chỉ có sự kiện bot không tính (tạo việc, phụ thuộc) → không chờ
        Assert.Null(BotWaitRules.WaitingSince([Bot(0, counts: false), Bot(1, counts: false)], BotA));
    }

    [Fact]
    public void Counts_only_moves_and_assignments()
    {
        Assert.True(BotWaitRules.Counts(TaskActivityKind.Moved));
        Assert.True(BotWaitRules.Counts(TaskActivityKind.Assigned));
        foreach (var k in new[] { TaskActivityKind.Created, TaskActivityKind.Edited, TaskActivityKind.DueChanged, TaskActivityKind.Depends, TaskActivityKind.CommentDeleted })
            Assert.False(BotWaitRules.Counts(k));
    }

    [Fact]
    public void Column_before_approver_column_is_approval_otherwise_reply()
    {
        var pid = Guid.NewGuid();
        TaskColumn Col(string name, int pos, bool approver = false) => new() { ProjectId = pid, Name = name, Position = pos, ApproverOnly = approver };
        var todo = Col("Cần làm", 0); var doing = Col("Đang làm", 1); var review = Col("Chờ review", 2); var done = Col("Xong", 3, true);
        var cols = new[] { done, todo, review, doing }; // không theo thứ tự — hàm tự sắp theo Position
        Assert.True(BotWaitRules.AwaitingApproval(cols, review.Id));
        Assert.False(BotWaitRules.AwaitingApproval(cols, doing.Id));
        Assert.False(BotWaitRules.AwaitingApproval(cols, todo.Id));
        Assert.False(BotWaitRules.AwaitingApproval(cols, done.Id));
        Assert.False(BotWaitRules.AwaitingApproval(cols, Guid.NewGuid()));
    }

    [Fact]
    public void Awaiting_human_for_tasks_mine()
    {
        // người thật vừa giao việc cho bot → chưa chờ
        Assert.False(BotWaitRules.AwaitingHuman([Person(0)], BotA, true));
        // bot bình luận / chuyển sang Chờ review → chờ
        Assert.True(BotWaitRules.AwaitingHuman([Person(0), Bot(5)], BotA, true));
        // sau đó người thật bình luận hoặc trả việc về → hết chờ
        Assert.False(BotWaitRules.AwaitingHuman([Person(0), Bot(5), Person(9)], BotA, true));
        // bot khác giao việc cho bot này → không chờ
        Assert.False(BotWaitRules.AwaitingHuman([Bot(1, BotB)], BotA, true));
        // người làm là người thật (thao tác qua token AI vẫn ByBot) → luôn false
        Assert.False(BotWaitRules.AwaitingHuman([Bot(5, Human)], Human, false));
    }
}
