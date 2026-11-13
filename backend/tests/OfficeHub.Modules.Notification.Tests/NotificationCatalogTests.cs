using System.Text.RegularExpressions;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Notification.Features;

namespace OfficeHub.Modules.Notification.Tests;

/// <summary>
/// TEST-59: danh mục sự kiện thông báo (<see cref="NotificationCatalog"/>) phải khớp code. Thêm / xoá hằng NotificationCategories, phương thức
/// ITelegramWakeup hay WebhookEvents mà quên sửa danh mục → test này fail.
/// </summary>
public partial class NotificationCatalogTests
{
    private static readonly string Src = FindSrc();
    private static readonly IReadOnlyList<(string Path, string Text)> Files = [.. Directory
        .EnumerateFiles(Src, "*.cs", SearchOption.AllDirectories)
        .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}") && !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}"))
        .Where(f => !f.EndsWith("NotificationCatalog.cs") && !f.Contains($"OfficeHub.Modules.Notification.Contracts{Path.DirectorySeparatorChar}"))
        .Select(f => (f, File.ReadAllText(f)))];

    [Fact]
    public void Events_are_well_formed()
    {
        var keys = NotificationCatalog.Events.Select(e => e.Key).ToList();
        Assert.Equal(keys.Count, keys.Distinct().Count());
        var groups = NotificationCatalog.Groups.Select(g => g.Key).ToHashSet();
        foreach (var e in NotificationCatalog.Events)
        {
            Assert.True(groups.Contains(e.Group), $"{e.Key}: nhóm {e.Group} chưa khai báo trong Groups");
            Assert.StartsWith(e.Group + ".", e.Key);
            Assert.False(string.IsNullOrWhiteSpace(e.Title) || string.IsNullOrWhiteSpace(e.Description), $"{e.Key}: thiếu tiêu đề / mô tả");
            Assert.True(e.Email != EmailMode.Conditional || !string.IsNullOrWhiteSpace(e.EmailNote), $"{e.Key}: email tuỳ trường hợp phải có ghi chú");
            Assert.NotEmpty(NotificationCatalog.ChannelsOf(e));
        }
        Assert.Equal(NotificationCatalog.Events.Count, NotificationCatalog.Grouped().Sum(g => g.Events.Count));
    }

    [Fact]
    public void Every_category_is_in_catalog_and_catalog_has_no_unknown_category()
    {
        var constants = NotificationCatalog.AllCategoryKeys.ToHashSet();
        var inCatalog = NotificationCatalog.Events.Where(e => e.Category is not null).Select(e => e.Category!).ToHashSet();
        var missing = constants.Except(inCatalog).ToList();
        Assert.True(missing.Count == 0, "Thêm vào NotificationCatalog sự kiện cho: " + string.Join(", ", missing));
        var unknown = inCatalog.Except(constants).ToList();
        Assert.True(unknown.Count == 0, "NotificationCatalog dùng category không còn trong NotificationCategories: " + string.Join(", ", unknown));
    }

    [Fact]
    public void Every_category_is_still_used_in_code()
    {
        var used = Files.SelectMany(f => CategoryRef().Matches(f.Text).Select(m => m.Groups[1].Value)).ToHashSet();
        var unused = typeof(NotificationCategories).GetFields().Where(f => f.IsLiteral).Select(f => f.Name).Where(n => !used.Contains(n)).ToList();
        Assert.True(unused.Count == 0, "Không còn nơi nào gửi — xoá hằng NotificationCategories + sự kiện trong NotificationCatalog: " + string.Join(", ", unused));
    }

    [Fact]
    public void Notifications_use_category_constants_not_literals()
    {
        var bad = Files.Where(f => LiteralCategory().IsMatch(f.Text)).Select(f => Path.GetFileName(f.Path)).ToList();
        Assert.True(bad.Count == 0, "Dùng hằng NotificationCategories (khai báo vào NotificationCatalog) thay cho chuỗi: " + string.Join(", ", bad));
    }

    [Fact]
    public void Telegram_events_match_ITelegramWakeup()
    {
        var methods = typeof(ITelegramWakeup).GetMethods().Select(m => m.Name).Where(n => !NotificationCatalog.TechnicalTelegramMethods.Contains(n)).ToHashSet();
        var inCatalog = NotificationCatalog.Events.Where(e => e.Telegram is not null).Select(e => e.Telegram!).ToHashSet();
        Assert.True(methods.SetEquals(inCatalog),
            $"ITelegramWakeup: [{string.Join(", ", methods.Order())}] ≠ NotificationCatalog Telegram: [{string.Join(", ", inCatalog.Order())}]");
        var callers = Files.Where(f => !f.Path.Contains($"OfficeHub.Modules.Notification{Path.DirectorySeparatorChar}")).ToList();
        var uncalled = methods.Where(m => !callers.Any(f => f.Text.Contains($".{m}("))).ToList();
        Assert.True(uncalled.Count == 0, "Không còn module nào gọi — xoá khỏi ITelegramWakeup + NotificationCatalog: " + string.Join(", ", uncalled));
    }

    [Fact]
    public void Webhook_events_match_WebhookEvents()
    {
        var events = NotificationCatalog.ConstantsOf(typeof(WebhookEvents))
            .Where(e => e != WebhookEvents.Notification && !NotificationCatalog.TechnicalWebhookEvents.Contains(e)).ToHashSet();
        var inCatalog = NotificationCatalog.Events.Where(e => e.WebhookEvent is not null).Select(e => e.WebhookEvent!).ToHashSet();
        Assert.True(events.SetEquals(inCatalog),
            $"WebhookEvents: [{string.Join(", ", events.Order())}] ≠ NotificationCatalog webhook: [{string.Join(", ", inCatalog.Order())}]");
        var used = Files.SelectMany(f => WebhookRef().Matches(f.Text).Select(m => m.Groups[1].Value)).ToHashSet();
        var unused = typeof(WebhookEvents).GetFields().Where(f => f.IsLiteral).Select(f => f.Name).Where(n => !used.Contains(n)).ToList();
        Assert.True(unused.Count == 0, "WebhookEvents không còn dùng: " + string.Join(", ", unused));
    }

    [Fact]
    public void Channel_used_by_comes_from_catalog()
    {
        Assert.Equal(NotificationCatalog.Events.Count(e => e.Category is not null), NotificationCatalog.UsedBy(NotificationCatalog.Bell).Count);
        var telegram = NotificationCatalog.UsedBy(NotificationCatalog.TelegramKey).Select(u => u.Key).ToList();
        Assert.Equal(["projects.task_assigned", "projects.task_returned", "projects.task_mention", "projects.task_ready", "chat.mention"], telegram);
        Assert.Contains(NotificationCatalog.UsedBy(NotificationCatalog.Email), u => u.Key == "people.account_security");
        Assert.DoesNotContain(NotificationCatalog.UsedBy(NotificationCatalog.Email), u => u.Key == "projects.task_assigned");
    }

    [GeneratedRegex(@"NotificationCategories\.(\w+)")]
    private static partial Regex CategoryRef();

    [GeneratedRegex(@"WebhookEvents\.(\w+)")]
    private static partial Regex WebhookRef();

    /// <summary>new NotificationRequest(người nhận, "chuỗi", …) — category viết thẳng chuỗi thì danh mục không thấy.</summary>
    [GeneratedRegex(@"NotificationRequest\(\s*(\[[^\]]*\]|[^,\[]+),\s*""")]
    private static partial Regex LiteralCategory();

    private static string FindSrc()
    {
        for (var d = new DirectoryInfo(AppContext.BaseDirectory); d is not null; d = d.Parent)
            if (File.Exists(Path.Combine(d.FullName, "OfficeHub.slnx"))) return Path.Combine(d.FullName, "src");
        throw new DirectoryNotFoundException("Không tìm thấy backend/src (OfficeHub.slnx)");
    }
}
