using OfficeHub.Modules.Projects.Domain;

namespace OfficeHub.Modules.Projects.Tests;

/// <summary>Luật cột trạng thái tự do (chủ dự án chốt 2026-11-11).</summary>
public class TaskColumnRulesTests
{
    private static readonly ColumnInfo Todo = new(Guid.NewGuid(), "Cần làm", 0, false, false);
    private static readonly ColumnInfo Done = new(Guid.NewGuid(), "Xong", 1, true, true);
    private static readonly List<ColumnInfo> Cols = [Todo, Done];

    [Fact]
    public void Defaults_are_four_columns_with_one_done()
    {
        var d = TaskColumnRules.Defaults(Guid.NewGuid());
        Assert.Equal(["Cần làm", "Đang làm", "Chờ review", "Xong"], d.Select(c => c.Name));
        Assert.Equal([0, 1, 2, 3], d.Select(c => c.Position));
        Assert.Single(d, c => c.IsDone && c.ApproverOnly);
        Assert.All(d, c => Assert.True(TaskColumnRules.IsValidColor(c.Color)));
    }

    [Fact]
    public void Name_rules()
    {
        Assert.NotNull(TaskColumnRules.NameError("", Cols, null));
        Assert.NotNull(TaskColumnRules.NameError(new string('a', TaskColumnRules.MaxName + 1), Cols, null));
        Assert.NotNull(TaskColumnRules.NameError("xong", Cols, null));       // trùng, không phân biệt hoa thường
        Assert.Null(TaskColumnRules.NameError("Xong", Cols, Done.Id));        // giữ tên của chính nó
        Assert.Null(TaskColumnRules.NameError("QA", Cols, null));
        Assert.Equal("Chờ QA", TaskColumnRules.NormalizeName("  Chờ   QA "));
    }

    [Theory]
    [InlineData("#22c55e", true)]
    [InlineData("#22C55E", true)]
    [InlineData("22c55e", false)]
    [InlineData("#fff", false)]
    [InlineData("red", false)]
    public void Color(string c, bool ok) => Assert.Equal(ok, TaskColumnRules.IsValidColor(c));

    [Fact]
    public void Max_columns() =>
        Assert.Equal((false, true), (TaskColumnRules.AddError(TaskColumnRules.MaxColumns - 1) is not null, TaskColumnRules.AddError(TaskColumnRules.MaxColumns) is not null));

    [Fact]
    public void Keep_at_least_one_done_column()
    {
        Assert.NotNull(TaskColumnRules.UnsetDoneError(Done, false, Cols));
        Assert.Null(TaskColumnRules.UnsetDoneError(Done, true, Cols));
        Assert.Null(TaskColumnRules.UnsetDoneError(Done, false, [.. Cols, new(Guid.NewGuid(), "Lưu", 2, true, false)]));
    }

    [Fact]
    public void Delete_rules()
    {
        Assert.NotNull(TaskColumnRules.DeleteError(Done, Cols, false, null));               // cột hoàn thành cuối cùng
        Assert.NotNull(TaskColumnRules.DeleteError(Todo, [Todo], false, null));             // cột cuối cùng
        Assert.NotNull(TaskColumnRules.DeleteError(Todo, Cols, true, null));                // còn việc, chưa chọn nơi nhận
        Assert.NotNull(TaskColumnRules.DeleteError(Todo, Cols, true, Todo.Id));             // nhận vào chính nó
        Assert.NotNull(TaskColumnRules.DeleteError(Todo, Cols, true, Guid.NewGuid()));      // cột không thuộc dự án
        Assert.Null(TaskColumnRules.DeleteError(Todo, Cols, true, Done.Id));
        Assert.Null(TaskColumnRules.DeleteError(Todo, Cols, false, null));
    }

    [Fact]
    public void Reorder_must_be_permutation()
    {
        Assert.True(TaskColumnRules.IsPermutation([Done.Id, Todo.Id], Cols));
        Assert.False(TaskColumnRules.IsPermutation([Done.Id], Cols));
        Assert.False(TaskColumnRules.IsPermutation([Done.Id, Done.Id], Cols));
        Assert.False(TaskColumnRules.IsPermutation([Done.Id, Guid.NewGuid()], Cols));
    }
}
