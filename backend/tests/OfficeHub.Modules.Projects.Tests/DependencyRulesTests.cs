using OfficeHub.Modules.Projects.Domain;

namespace OfficeHub.Modules.Projects.Tests;

public class DependencyRulesTests
{
    private static readonly Guid A = Guid.NewGuid(), B = Guid.NewGuid(), C = Guid.NewGuid(), D = Guid.NewGuid(), Other = Guid.NewGuid();
    private static readonly HashSet<Guid> Project = [A, B, C, D];

    [Fact]
    public void Valid_chain() => Assert.Null(DependencyRules.Error(C, [A, B], Project, [(B, A)]));

    [Fact]
    public void Empty_list_is_valid() => Assert.Null(DependencyRules.Error(A, [], Project, [(B, A)]));

    [Fact]
    public void Self_dependency() => Assert.Equal("Việc không thể chờ chính nó", DependencyRules.Error(A, [A], Project, []));

    [Fact]
    public void Other_project() => Assert.Equal("Chỉ chờ được việc trong cùng dự án", DependencyRules.Error(A, [Other], Project, []));

    [Fact]
    public void Direct_and_indirect_cycles()
    {
        Assert.Contains("vòng", DependencyRules.Error(A, [B], Project, [(B, A)]));               // A→B, B→A
        Assert.Contains("vòng", DependencyRules.Error(A, [C], Project, [(C, B), (B, A)]));       // A→C→B→A
        Assert.Null(DependencyRules.Error(D, [C], Project, [(C, B), (B, A)]));                    // không vòng
    }

    [Fact]
    public void Max_ten()
    {
        var many = Enumerable.Range(0, 11).Select(_ => Guid.NewGuid()).ToList();
        Assert.Equal($"Tối đa {DependencyRules.MaxDependencies} việc phải chờ", DependencyRules.Error(A, many, many.Append(A).ToHashSet(), []));
    }

    [Theory]
    [InlineData(1, true, true, true)]
    [InlineData(0, true, true, false)]
    [InlineData(1, false, true, false)]   // đã bắt đầu rồi (không ở cột đầu)
    [InlineData(1, true, false, false)]   // người thật: chỉ cảnh báo trên giao diện
    public void Bot_cannot_start_waiting_task(int unfinished, bool leaving, bool byBot, bool blocked) =>
        Assert.Equal(blocked, DependencyRules.StartError(unfinished, leaving, byBot) is not null);

    // TEST-198: số việc chưa xong trước / sau thao tác → có báo "Sẵn sàng" không
    [Theory]
    [InlineData(false, 1, 0, true)]    // (a) A chờ B chưa xong → sửa dependsOn thành rỗng; (b) A chờ B → xoá B; việc trước xong
    [InlineData(false, 2, 1, false)]   // (c) A chờ B, C → xoá B, C chưa xong
    [InlineData(false, 0, 0, false)]   // (d) thêm một việc đã xong (trước đó không chờ)
    [InlineData(false, 1, 1, false)]   // sửa mà vẫn còn chờ (thêm việc đã xong / đổi việc chưa xong khác)
    [InlineData(false, 0, 1, false)]   // thêm việc chưa xong
    [InlineData(true, 1, 0, false)]    // việc đã xong rồi
    public void Became_ready_only_on_transition(bool done, int before, int after, bool ready) =>
        Assert.Equal(ready, DependencyRules.BecameReady(done, before, after));

    // TEST-199: cột "Việc sau được bắt đầu từ cột này"
    private static readonly Guid Todo = Guid.NewGuid(), Doing = Guid.NewGuid(), Review = Guid.NewGuid(), Deploy = Guid.NewGuid(), Done = Guid.NewGuid();

    private static List<ColumnInfo> Board(Guid? flagged) =>
    [
        new(Todo, "Cần làm", 0, false, false), new(Doing, "Đang làm", 1, false, false), new(Review, "Chờ review", 2, false, false, UnblocksDependents: flagged == Review),
        new(Deploy, "Deploy", 3, false, false, UnblocksDependents: flagged == Deploy), new(Done, "Xong", 4, true, true),
    ];

    [Fact]
    public void No_flag_only_done_column_is_ready()
    {
        Assert.Equal([Done], DependencyRules.ReadyColumnIds(Board(null), sequential: true));
        Assert.Equal([Done], DependencyRules.ReadyColumnIds(Board(null), sequential: false));
    }

    [Fact]
    public void Sequential_counts_columns_after_first_flag()
    {
        var ready = DependencyRules.ReadyColumnIds(Board(Review), sequential: true);
        Assert.Equal(new HashSet<Guid> { Review, Deploy, Done }, ready);
    }

    [Fact]
    public void Non_sequential_counts_only_flagged_and_done()
    {
        var ready = DependencyRules.ReadyColumnIds(Board(Review), sequential: false);
        Assert.Equal(new HashSet<Guid> { Review, Done }, ready);
    }

    [Fact]
    public void Flag_order_follows_position_not_list_order()
    {
        var cols = Board(Deploy);
        cols.Reverse();
        Assert.Equal(new HashSet<Guid> { Deploy, Done }, DependencyRules.ReadyColumnIds(cols, sequential: true));
    }

    [Theory]
    [InlineData(true, "doing", true)]     // đã xong (CompletedAt) luôn đủ
    [InlineData(false, "deploy", true)]   // cột có cờ
    [InlineData(false, "doing", false)]   // cột trước cờ
    public void Is_ready(bool completed, string column, bool ready) =>
        Assert.Equal(ready, DependencyRules.IsReady(completed, column == "deploy" ? Deploy : Doing, DependencyRules.ReadyColumnIds(Board(Deploy), true)));

    [Theory]
    [InlineData(false, false, true)]   // việc sau đã bắt đầu → báo kiểm tra lại đầu vào
    [InlineData(false, true, false)]   // còn ở cột đầu → chỉ bị chặn
    [InlineData(true, false, false)]   // đã xong → không báo
    public void Warn_regressed_only_started_dependents(bool done, bool inFirst, bool warn) =>
        Assert.Equal(warn, DependencyRules.ShouldWarnRegressed(done, inFirst));
}
