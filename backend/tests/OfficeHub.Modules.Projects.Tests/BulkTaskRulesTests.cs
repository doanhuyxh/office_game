using OfficeHub.Modules.Projects.Domain;

namespace OfficeHub.Modules.Projects.Tests;

/// <summary>Thao tác hàng loạt trên việc: kiểm tra cấu trúc yêu cầu, chữ xác nhận xoá, dời hạn.</summary>
public class BulkTaskRulesTests
{
    private static string? Err(string? action, int ids = 3, bool column = false, bool follower = false, string? dueMode = null, int shift = 0, bool dueOn = false, string? confirm = null) =>
        BulkTaskRules.RequestError(action, ids, column, follower, dueMode, shift, dueOn, confirm);

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("archive")]
    [InlineData("MOVE")]
    public void Unknown_action_is_rejected(string? action) => Assert.NotNull(Err(action));

    [Fact]
    public void Needs_between_1_and_100_tasks()
    {
        Assert.NotNull(Err(BulkTaskActions.Assign, ids: 0));
        Assert.Null(Err(BulkTaskActions.Assign, ids: BulkTaskRules.MaxIds));
        Assert.NotNull(Err(BulkTaskActions.Assign, ids: BulkTaskRules.MaxIds + 1));
    }

    [Fact]
    public void Move_needs_column() { Assert.NotNull(Err(BulkTaskActions.Move)); Assert.Null(Err(BulkTaskActions.Move, column: true)); }

    [Theory]
    [InlineData(BulkTaskActions.Follow)]
    [InlineData(BulkTaskActions.Unfollow)]
    public void Follow_needs_person(string action) { Assert.NotNull(Err(action)); Assert.Null(Err(action, follower: true)); }

    [Fact]
    public void Assign_has_no_extra_requirement_null_means_unassign() => Assert.Null(Err(BulkTaskActions.Assign));

    [Fact]
    public void Due_modes()
    {
        Assert.NotNull(Err(BulkTaskActions.Due));
        Assert.NotNull(Err(BulkTaskActions.Due, dueMode: "later"));
        Assert.NotNull(Err(BulkTaskActions.Due, dueMode: BulkDueModes.Set));
        Assert.Null(Err(BulkTaskActions.Due, dueMode: BulkDueModes.Set, dueOn: true));
        Assert.Null(Err(BulkTaskActions.Due, dueMode: BulkDueModes.Clear));
        Assert.NotNull(Err(BulkTaskActions.Due, dueMode: BulkDueModes.Shift, shift: 0));
        Assert.Null(Err(BulkTaskActions.Due, dueMode: BulkDueModes.Shift, shift: 7));
        Assert.Null(Err(BulkTaskActions.Due, dueMode: BulkDueModes.Shift, shift: -7));
        Assert.NotNull(Err(BulkTaskActions.Due, dueMode: BulkDueModes.Shift, shift: BulkTaskRules.MaxShiftDays + 1));
    }

    [Theory]
    [InlineData("delete", true)]
    [InlineData("  Delete ", true)]
    [InlineData("DELETE", true)]
    [InlineData("xoá", false)]
    [InlineData("delet", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void Delete_needs_typed_word(string? typed, bool ok)
    {
        Assert.Equal(ok, BulkTaskRules.IsDeleteConfirmed(typed));
        Assert.Equal(ok, Err(BulkTaskActions.Delete, confirm: typed) is null);
    }

    [Fact]
    public void Shift_due_moves_forward_back_and_skips_tasks_without_due()
    {
        var d = new DateOnly(2026, 11, 30);
        Assert.Equal(new DateOnly(2026, 12, 7), BulkTaskRules.ShiftDue(d, 7));
        Assert.Equal(new DateOnly(2026, 11, 23), BulkTaskRules.ShiftDue(d, -7));
        Assert.Null(BulkTaskRules.ShiftDue(null, 7));
    }
}
