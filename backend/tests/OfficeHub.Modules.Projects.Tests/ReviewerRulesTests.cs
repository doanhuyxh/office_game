using OfficeHub.Modules.Projects.Domain;

namespace OfficeHub.Modules.Projects.Tests;

/// <summary>TEST-161: người review việc + khi nào báo "Cần review".</summary>
public class ReviewerRulesTests
{
    private static readonly Guid Todo = Guid.NewGuid(), Doing = Guid.NewGuid(), Review = Guid.NewGuid(), Qa = Guid.NewGuid(), Done = Guid.NewGuid();
    private static readonly Guid Dev = Guid.NewGuid(), Bot = Guid.NewGuid();

    private static readonly List<ColumnInfo> Cols =
    [
        new(Todo, "Cần làm", 0, false, false), new(Doing, "Đang làm", 1, false, false), new(Review, "Chờ review", 2, false, false, IsReview: true),
        new(Qa, "QA", 3, false, false, IsReview: true), new(Done, "Xong", 4, true, true),
    ];

    [Fact]
    public void No_reviewer_is_valid() => Assert.Null(ReviewerRules.Error(null, Dev, reviewerIsMember: false));

    [Fact]
    public void Member_other_than_assignee_is_valid() => Assert.Null(ReviewerRules.Error(Bot, Dev, reviewerIsMember: true));

    [Fact]
    public void Reviewer_must_be_member() =>
        Assert.Equal("Người review phải là thành viên dự án", ReviewerRules.Error(Bot, Dev, reviewerIsMember: false));

    [Fact]
    public void Reviewer_cannot_be_assignee() => Assert.Equal("Người review phải khác người làm", ReviewerRules.Error(Dev, Dev, reviewerIsMember: true));

    [Fact]
    public void Moving_into_review_column_requests_review() => Assert.True(ReviewerRules.ShouldRequest(Cols, Doing, Review, Bot, Dev));

    [Fact]
    public void Moving_back_into_review_again_requests_again()
    {
        // Lùi Chờ review → Đang làm rồi chuyển lại: lần chuyển vào nào cũng báo
        Assert.False(ReviewerRules.ShouldRequest(Cols, Review, Doing, Bot, Dev));
        Assert.True(ReviewerRules.ShouldRequest(Cols, Doing, Review, Bot, Dev));
    }

    [Theory]
    [InlineData(false)] // không có người review
    [InlineData(true)]  // người review tự chuyển
    public void No_request_without_reviewer_or_when_reviewer_moves(bool reviewerMoves) =>
        Assert.False(ReviewerRules.ShouldRequest(Cols, Doing, Review, reviewerMoves ? Bot : null, reviewerMoves ? Bot : Dev));

    [Fact]
    public void No_request_for_non_review_target_or_same_column_or_between_review_columns()
    {
        Assert.False(ReviewerRules.ShouldRequest(Cols, Todo, Doing, Bot, Dev));
        Assert.False(ReviewerRules.ShouldRequest(Cols, Review, Review, Bot, Dev));
        Assert.False(ReviewerRules.ShouldRequest(Cols, Review, Qa, Bot, Dev));
        Assert.False(ReviewerRules.ShouldRequest(Cols, Review, Done, Bot, Dev));
    }

    [Fact]
    public void Default_columns_mark_waiting_review_as_review_column()
    {
        var defaults = TaskColumnRules.Defaults(Guid.NewGuid());
        Assert.Equal(["Chờ review"], defaults.Where(c => c.IsReview).Select(c => c.Name));
    }
}
