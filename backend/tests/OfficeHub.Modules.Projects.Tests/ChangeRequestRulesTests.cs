using OfficeHub.Modules.Projects.Domain;
using static OfficeHub.Modules.Projects.Domain.ChangeRequestRules;

namespace OfficeHub.Modules.Projects.Tests;

public class ChangeRequestRulesTests
{
    [Fact]
    public void Code_uses_project_code_and_number() => Assert.Equal("APP-CR3", Code("APP", 3));

    [Theory]
    [InlineData(ChangeRequestStatus.Draft, ChangeRequestStatus.Sent, true)]
    [InlineData(ChangeRequestStatus.Draft, ChangeRequestStatus.Approved, true)]   // khách đồng ý miệng
    [InlineData(ChangeRequestStatus.Sent, ChangeRequestStatus.Draft, true)]       // sửa lại rồi gửi
    [InlineData(ChangeRequestStatus.Sent, ChangeRequestStatus.Rejected, true)]
    [InlineData(ChangeRequestStatus.Sent, ChangeRequestStatus.Cancelled, true)]
    [InlineData(ChangeRequestStatus.Approved, ChangeRequestStatus.Cancelled, false)] // đã cộng ngân sách / có thể đã có phụ lục
    [InlineData(ChangeRequestStatus.Rejected, ChangeRequestStatus.Sent, false)]
    [InlineData(ChangeRequestStatus.Cancelled, ChangeRequestStatus.Draft, false)]
    [InlineData(ChangeRequestStatus.Draft, ChangeRequestStatus.Draft, false)]
    public void Transitions(ChangeRequestStatus from, ChangeRequestStatus to, bool ok) => Assert.Equal(ok, CanMove(from, to));

    [Fact]
    public void Budget_grows_only_when_project_has_budget_and_estimate()
    {
        Assert.Equal(5m, BudgetAddition(60, 5));
        Assert.Null(BudgetAddition(null, 5));
        Assert.Null(BudgetAddition(60, null));
        Assert.Null(BudgetAddition(60, 0));
    }
}
