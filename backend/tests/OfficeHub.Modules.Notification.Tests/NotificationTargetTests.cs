using System.Text.Json;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Notification.Domain;
using OfficeHub.Modules.Notification.Infrastructure;

namespace OfficeHub.Modules.Notification.Tests;

/// <summary>TEST-237 (G1): target → link giữ đúng như link cũ module tự ghép; tách link cũ (backfill); data push FCM.</summary>
public class NotificationTargetTests
{
    private static readonly Guid P = Guid.NewGuid(), T = Guid.NewGuid(), C = Guid.NewGuid(), X = Guid.NewGuid();

    public static TheoryData<string, string> Links()
    {
        var d = new TheoryData<string, string>
        {
            // Link cũ của từng module (trước TEST-237) — client cũ chỉ đọc link phải thấy y như trước.
            { Build(NotificationTarget.ProjectTask(P, T)), $"/projects/{P}?task={T}" },
            { Build(NotificationTarget.ProjectTask(P, T, C)), $"/projects/{P}?task={T}&comment={C}" },
            { Build(NotificationTarget.Project(P)), $"/projects/{P}" },
            { Build(NotificationTarget.Project(P, "guide")), $"/projects/{P}?tab=guide" },
            { Build(NotificationTarget.WikiShare(P, X)), $"/projects/{P}?tab=wiki" },
            { Build(NotificationTarget.WikiShare(P, X, C)), $"/projects/{P}?tab=wiki&page={C}" },
            { Build(NotificationTarget.ApprovalRequest(X)), "/approvals" },
            { Build(NotificationTarget.ApprovalDelegation(X)), "/approvals" },
            { Build(NotificationTarget.ChatConversation(X, C)), $"/chat?c={X}" },
            { Build(NotificationTarget.NewsPost(X)), $"/news/{X}" },
            { Build(NotificationTarget.NewsPost(X, C)), $"/news/{X}?comment={C}" },
            { Build(NotificationTarget.MeetingBooking(X)), "/meetings" },
            { Build(NotificationTarget.LaborContract(X)), "/contracts" },
            { Build(NotificationTarget.Payslip(X)), "/payslips" },
            { Build(NotificationTarget.AssetDevice(X)), "/assets" },
            { Build(NotificationTarget.AssetService(X)), "/assets" },
            { Build(NotificationTarget.AssetReview(X)), "/assets" },
            { Build(NotificationTarget.AssetHandover(X)), "/assets" },
            { Build(NotificationTarget.Employee(X, "assets")), "/assets" },
            { Build(NotificationTarget.SocialAccount(X, "posts")), "/social/facebook" },
            { Build(NotificationTarget.SocialAccount(X)), "/assets?tab=social&platform=facebook" },
            { Build(NotificationTarget.SocialPost(X)), "/social/facebook" },
            { Build(NotificationTarget.DocumentAsset(X)), $"/documents?asset={X}" },
            { Build(NotificationTarget.ExpenseRequest(X)), "/finance" },
            { Build(NotificationTarget.SalesCustomer(X)), $"/sales?customer={X}" },
            { Build(NotificationTarget.SalesContract(X, C)), $"/sales?customer={C}" },
            { Build(NotificationTarget.SalesReceivable(X, C)), "/sales?tab=receivables" },
            { Build(NotificationTarget.ProfileChangeRequest(X)), "/employees" },
            { Build(NotificationTarget.ProfileChangeRequest(X, "profile")), "/profile" },
            { Build(NotificationTarget.Page("attendance")), "/attendance" },
            { Build(NotificationTarget.Page("reports", ("tab", "ai"))), "/reports?tab=ai" },
            { Build(NotificationTarget.Page("profile")), "/profile" },
            { Build(NotificationTarget.Page("documents")), "/documents" },
            { Build(NotificationTarget.Page("news")), "/news" },
        };
        return d;
    }

    private static string Build(NotificationTarget t) => NotificationLinkBuilder.Build(t) ?? "(null)";

    [Theory, MemberData(nameof(Links))]
    public void Link_is_same_as_before(string actual, string expected) => Assert.Equal(expected, actual);

    [Fact]
    public void Unknown_type_or_bad_page_key_has_no_link()
    {
        Assert.Null(NotificationLinkBuilder.Build(new NotificationTarget("khong_co", X)));
        Assert.Null(NotificationLinkBuilder.Build(NotificationTarget.Page("//evil.example")));
        Assert.Null(NotificationLinkBuilder.Build(NotificationTarget.Page("https://evil.example")));
        Assert.Null(NotificationLinkBuilder.Build(new NotificationTarget(NotificationTargetTypes.ProjectTask, T))); // thiếu projectId
    }

    [Fact]
    public void Factories_drop_empty_params()
    {
        Assert.Null(NotificationTarget.ApprovalRequest(X).Params);
        Assert.Null(NotificationTarget.Project(P).Params);
        var t = NotificationTarget.ProjectTask(P, T);
        Assert.Equal(T, t.Id);
        Assert.Equal(new Dictionary<string, string> { ["projectId"] = P.ToString() }, t.Params);
    }

    public static TheoryData<string?, string, Guid?, string?> OldLinks() => new()
    {
        // link cũ → (type, id, params JSON)
        { $"/projects/{P}?task={T}", NotificationTargetTypes.ProjectTask, T, $"{{\"projectId\":\"{P}\"}}" },
        { $"/projects/{P}?task={T}&comment={C}", NotificationTargetTypes.ProjectTask, T, $"{{\"projectId\":\"{P}\",\"commentId\":\"{C}\"}}" },
        { $"/projects/{P}", NotificationTargetTypes.Project, P, null },
        { $"/projects/{P}?tab=guide", NotificationTargetTypes.Project, P, "{\"tab\":\"guide\"}" },
        { $"/projects/{P}?tab=wiki&page={C}", NotificationTargetTypes.Project, P, $"{{\"tab\":\"wiki\",\"page\":\"{C}\"}}" },
        { $"/chat?c={X}", NotificationTargetTypes.ChatConversation, X, null },
        { $"/news/{X}", NotificationTargetTypes.NewsPost, X, null },
        { $"/news/{X}?comment={C}", NotificationTargetTypes.NewsPost, X, $"{{\"commentId\":\"{C}\"}}" },
        { $"/documents?asset={X}", NotificationTargetTypes.DocumentAsset, X, null },
        { $"/sales?customer={X}", NotificationTargetTypes.SalesCustomer, X, null },
        // không khớp mẫu → page + key từ path (+ query)
        { "/approvals", NotificationTargetTypes.Page, null, "{\"key\":\"approvals\"}" },
        { "/reports?tab=ai", NotificationTargetTypes.Page, null, "{\"key\":\"reports\",\"tab\":\"ai\"}" },
        { "/assets?tab=social&platform=facebook", NotificationTargetTypes.Page, null, "{\"key\":\"assets\",\"tab\":\"social\",\"platform\":\"facebook\"}" },
        { "/social/facebook", NotificationTargetTypes.Page, null, "{\"key\":\"social/facebook\"}" },
        { "/sales?tab=receivables", NotificationTargetTypes.Page, null, "{\"key\":\"sales\",\"tab\":\"receivables\"}" },
        { "/projects/khong-phai-guid", NotificationTargetTypes.Page, null, "{\"key\":\"projects/khong-phai-guid\"}" },
        { null, NotificationTargetTypes.Page, null, "{\"key\":\"\"}" },
        { "https://evil.example/x", NotificationTargetTypes.Page, null, "{\"key\":\"\"}" },
    };

    [Theory, MemberData(nameof(OldLinks))]
    public void Backfill_splits_old_link(string? link, string type, Guid? id, string? paramsJson)
    {
        var t = NotificationTargets.FromLink(link);
        Assert.Equal(type, t.Type);
        Assert.Equal(id, t.Id);
        Assert.Equal(paramsJson, NotificationTargets.ParamsJson(t));
    }

    [Theory]
    [InlineData("/approvals")]
    [InlineData("/reports?tab=ai")]
    [InlineData("/assets?tab=social&platform=facebook")]
    [InlineData("/sales?tab=receivables")]
    [InlineData("/attendance")]
    public void Backfilled_page_rebuilds_same_link(string link) =>
        Assert.Equal(link, NotificationLinkBuilder.Build(NotificationTargets.FromLink(link)));

    [Fact]
    public void Backfilled_objects_rebuild_same_link()
    {
        foreach (var link in new[] { $"/projects/{P}?task={T}&comment={C}", $"/projects/{P}?tab=guide", $"/projects/{P}?tab=wiki&page={C}", $"/chat?c={X}",
                     $"/news/{X}?comment={C}", $"/documents?asset={X}", $"/sales?customer={X}" })
            Assert.Equal(link, NotificationLinkBuilder.Build(NotificationTargets.FromLink(link)));
    }

    [Fact]
    public void Params_json_round_trips()
    {
        var t = NotificationTarget.ProjectTask(P, T, C);
        Assert.Equal(t.Params, NotificationTargets.ParseParams(NotificationTargets.ParamsJson(t)));
        Assert.Null(NotificationTargets.ParamsJson(NotificationTarget.ApprovalRequest(X)));
        Assert.Null(NotificationTargets.ParseParams(null));
    }

    [Fact]
    public void Push_data_carries_target_and_link()
    {
        var d = PushSender.Data(NotificationTarget.ProjectTask(P, T, C))!;
        Assert.Equal(NotificationTargetTypes.ProjectTask, d["targetType"]);
        Assert.Equal(T.ToString(), d["targetId"]);
        Assert.Equal(C.ToString(), JsonSerializer.Deserialize<Dictionary<string, string>>(d["targetParams"])!["commentId"]);
        Assert.Equal($"/projects/{P}?task={T}&comment={C}", d["link"]);
        var page = PushSender.Data(NotificationTarget.Page("attendance"))!;
        Assert.False(page.ContainsKey("targetId"));
        Assert.Equal("/attendance", page["link"]);
        Assert.Null(PushSender.Data(null));
    }
}
