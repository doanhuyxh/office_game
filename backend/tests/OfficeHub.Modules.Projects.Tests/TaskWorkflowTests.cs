using OfficeHub.Modules.Projects.Domain;
using static OfficeHub.Modules.Projects.Domain.TaskState;

namespace OfficeHub.Modules.Projects.Tests;

/// <summary>Quy trình trạng thái việc khi dự án bật "Xong cần duyệt" (chủ dự án chốt 2026-11-10): đi lần lượt, quản lý duyệt Xong, lùi phải có lý do.</summary>
public class TaskWorkflowTests
{
    [Theory]
    [InlineData(Todo, Done)]
    [InlineData(Todo, Review)]
    [InlineData(Doing, Done)]
    [InlineData(Done, Todo)]
    [InlineData(Review, Todo)]
    public void Without_review_everything_is_free(TaskState from, TaskState to) =>
        Assert.Null(TaskWorkflow.MoveError(from, to, requireReview: false, canManage: false, hasNote: false));

    [Theory]
    [InlineData(Todo, Doing)]
    [InlineData(Doing, Review)]
    [InlineData(Doing, Todo)]
    public void Member_moves_one_step(TaskState from, TaskState to) =>
        Assert.Null(TaskWorkflow.MoveError(from, to, requireReview: true, canManage: false, hasNote: false));

    [Theory]
    [InlineData(Todo, Review)]
    [InlineData(Todo, Done)]
    [InlineData(Doing, Done)]
    public void Skipping_steps_is_blocked_even_for_manager(TaskState from, TaskState to)
    {
        Assert.Contains("lần lượt", TaskWorkflow.MoveError(from, to, true, canManage: true, hasNote: true));
        Assert.NotNull(TaskWorkflow.MoveError(from, to, true, canManage: false, hasNote: true));
    }

    [Fact]
    public void Only_manager_approves_done()
    {
        Assert.Contains("quản lý", TaskWorkflow.MoveError(Review, Done, true, canManage: false, hasNote: false));
        Assert.Null(TaskWorkflow.MoveError(Review, Done, true, canManage: true, hasNote: false));
    }

    [Fact]
    public void Review_not_passed_goes_back_to_doing_with_reason()
    {
        Assert.Contains("lý do", TaskWorkflow.MoveError(Review, Doing, true, canManage: true, hasNote: false));
        Assert.Null(TaskWorkflow.MoveError(Review, Doing, true, canManage: true, hasNote: true));
        Assert.Null(TaskWorkflow.MoveError(Review, Doing, true, canManage: false, hasNote: true)); // người làm tự rút lại
        Assert.NotNull(TaskWorkflow.MoveError(Review, Todo, true, canManage: true, hasNote: true));
    }

    [Fact]
    public void Reopen_done_is_manager_only_to_doing_with_reason()
    {
        Assert.NotNull(TaskWorkflow.MoveError(Done, Doing, true, canManage: false, hasNote: true));
        Assert.NotNull(TaskWorkflow.MoveError(Done, Review, true, canManage: true, hasNote: true));
        Assert.NotNull(TaskWorkflow.MoveError(Done, Doing, true, canManage: true, hasNote: false));
        Assert.Null(TaskWorkflow.MoveError(Done, Doing, true, canManage: true, hasNote: true));
    }

    [Fact]
    public void Same_state_is_noop() => Assert.Null(TaskWorkflow.MoveError(Review, Review, true, false, false));

    [Theory]
    [InlineData(Todo, true, false)]
    [InlineData(Doing, true, false)]
    [InlineData(Review, true, true)]
    [InlineData(Done, true, true)]
    [InlineData(Done, false, false)]
    public void New_task_state(TaskState s, bool requireReview, bool error) =>
        Assert.Equal(error, TaskWorkflow.CreateStateError(s, requireReview) is not null);

    [Theory]
    [InlineData(Review, Doing, true, true)]
    [InlineData(Done, Doing, true, true)]
    [InlineData(Doing, Todo, true, false)]
    [InlineData(Review, Doing, false, false)]
    public void Needs_note(TaskState from, TaskState to, bool requireReview, bool expected) =>
        Assert.Equal(expected, TaskWorkflow.NeedsNote(from, to, requireReview));
}
