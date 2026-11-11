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
}
