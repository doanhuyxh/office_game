using OfficeHub.Modules.Projects.Domain;

namespace OfficeHub.Modules.Projects.Tests;

/// <summary>
/// Quy trình chuyển việc giữa các cột tự do (chủ dự án chốt 2026-11-11): đi lần lượt (tiến 1 cột, lùi có lý do) + cột "Cần người duyệt" (chỉ quản lý).
/// Cột mặc định: Cần làm (0) · Đang làm (1) · Chờ review (2) · Xong (3, hoàn thành + cần người duyệt).
/// </summary>
public class TaskWorkflowTests
{
    private static readonly List<ColumnInfo> Cols =
    [
        new(Guid.NewGuid(), "Cần làm", 0, false, false),
        new(Guid.NewGuid(), "Đang làm", 1, false, false),
        new(Guid.NewGuid(), "Chờ review", 2, false, false),
        new(Guid.NewGuid(), "Xong", 3, true, true),
    ];

    private static Guid C(int i) => Cols[i].Id;

    private static string? Move(int from, int to, bool sequential = true, bool canApprove = false, bool hasNote = false) =>
        TaskWorkflow.MoveError(Cols, C(from), C(to), sequential, canApprove, hasNote);

    [Theory]
    [InlineData(0, 2)]
    [InlineData(2, 0)]
    [InlineData(1, 0)]
    public void Not_sequential_is_free_outside_approver_columns(int from, int to) => Assert.Null(Move(from, to, sequential: false));

    [Fact]
    public void Approver_column_applies_even_when_not_sequential()
    {
        Assert.NotNull(Move(0, 3, sequential: false));
        Assert.Null(Move(0, 3, sequential: false, canApprove: true));
        Assert.NotNull(Move(3, 1, sequential: false)); // mở lại việc đã xong: chỉ quản lý
    }

    [Theory]
    [InlineData(0, 1)]
    [InlineData(1, 2)]
    public void Member_moves_forward_one_step(int from, int to) => Assert.Null(Move(from, to));

    [Theory]
    [InlineData(0, 2)]
    [InlineData(1, 3)]
    public void Skipping_steps_is_blocked_even_for_manager(int from, int to)
    {
        Assert.Contains("lần lượt", Move(from, to)!);
        Assert.Contains("lần lượt", Move(from, to, canApprove: true)!);
    }

    [Fact]
    public void Only_manager_moves_into_approver_column()
    {
        Assert.Contains("Chỉ quản lý", Move(2, 3)!);
        Assert.Null(Move(2, 3, canApprove: true));
    }

    [Fact]
    public void Moving_back_needs_note_when_sequential()
    {
        Assert.NotNull(Move(1, 0));
        Assert.Null(Move(1, 0, hasNote: true));
        Assert.Null(Move(2, 0, hasNote: true)); // lùi nhiều bước được, miễn có lý do
    }

    [Fact]
    public void Reopen_from_approver_column_only_manager_with_note()
    {
        Assert.Contains("Chỉ quản lý", Move(3, 1, hasNote: true)!);
        Assert.NotNull(Move(3, 1, canApprove: true));
        Assert.Null(Move(3, 1, canApprove: true, hasNote: true));
    }

    [Fact]
    public void Same_column_and_unknown_target()
    {
        Assert.Null(Move(2, 2));
        Assert.NotNull(TaskWorkflow.MoveError(Cols, C(0), Guid.NewGuid(), true, true, true));
    }

    [Theory]
    [InlineData(0, true, false, false)]
    [InlineData(2, true, false, false)]
    [InlineData(3, true, true, true)]   // đi lần lượt: không tạo thẳng ở cột cần duyệt / hoàn thành, kể cả quản lý
    [InlineData(3, false, false, true)] // không đi lần lượt: cột cần duyệt vẫn chỉ quản lý
    [InlineData(3, false, true, false)]
    public void Create_column(int col, bool sequential, bool canApprove, bool error) =>
        Assert.Equal(error, TaskWorkflow.CreateError(Cols, C(col), sequential, canApprove) is not null);

    [Fact]
    public void Create_before_first_done_column_without_approver()
    {
        List<ColumnInfo> cols = [new(Guid.NewGuid(), "Mới", 0, false, false), new(Guid.NewGuid(), "Xong", 1, true, false), new(Guid.NewGuid(), "Lưu", 2, false, false)];
        Assert.Null(TaskWorkflow.CreateError(cols, cols[0].Id, true, false));
        Assert.NotNull(TaskWorkflow.CreateError(cols, cols[2].Id, true, true));
        Assert.Null(TaskWorkflow.CreateError(cols, cols[2].Id, false, false));
    }

    [Theory]
    [InlineData(1, 2, false, MoveNotice.AwaitingApproval)]
    [InlineData(2, 3, false, MoveNotice.Approved)]
    [InlineData(3, 1, true, MoveNotice.SentBack)]
    [InlineData(1, 0, false, MoveNotice.None)]
    [InlineData(0, 1, false, MoveNotice.None)]
    public void Notice(int from, int to, bool hasNote, MoveNotice expected) => Assert.Equal(expected, TaskWorkflow.Notice(Cols, C(from), C(to), hasNote));

    [Fact]
    public void Needs_note() =>
        Assert.Equal((true, false, false), (TaskWorkflow.NeedsNote(Cols, C(2), C(1), true), TaskWorkflow.NeedsNote(Cols, C(2), C(1), false),
            TaskWorkflow.NeedsNote(Cols, C(1), C(2), true)));
}
