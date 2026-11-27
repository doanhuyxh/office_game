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
        Assert.Equal(["projects.task_assigned", "projects.task_returned", "projects.task_mention", "projects.task_ready", "projects.task_column_entered", "projects.task_closed", "meetings.agent_turn", "chat.mention"], telegram);
        Assert.Contains(NotificationCatalog.UsedBy(NotificationCatalog.Email), u => u.Key == "people.account_security");
        Assert.DoesNotContain(NotificationCatalog.UsedBy(NotificationCatalog.Email), u => u.Key == "projects.task_assigned");
    }

    // ---------------- TEST-237: target (type / id / params) ----------------

    [Fact]
    public void Every_category_declares_target_types_and_every_type_has_link()
    {
        var types = NotificationCatalog.ConstantsOf(typeof(NotificationTargetTypes)).ToHashSet();
        var missing = NotificationCatalog.AllCategoryKeys.Where(c => !NotificationCatalog.CategoryTargets.ContainsKey(c)).ToList();
        Assert.True(missing.Count == 0, "Khai báo targetType được phép trong NotificationCatalog.CategoryTargets cho: " + string.Join(", ", missing));
        var unknownCategory = NotificationCatalog.CategoryTargets.Keys.Except(NotificationCatalog.AllCategoryKeys).ToList();
        Assert.True(unknownCategory.Count == 0, "CategoryTargets có category không còn: " + string.Join(", ", unknownCategory));
        var declared = NotificationCatalog.CategoryTargets.Values.SelectMany(v => v).Concat(NotificationCatalog.ChatPushTargets).ToHashSet();
        var unknownType = declared.Except(types).ToList();
        Assert.True(unknownType.Count == 0, "Loại không có trong NotificationTargetTypes: " + string.Join(", ", unknownType));
        // Mọi loại có factory + NotificationLinkBuilder sinh được link (gọi factory với tham số mẫu).
        var noLink = Factories().Where(f => NotificationLinkBuilder.Build(f.Sample) is null).Select(f => f.Sample.Type).ToList();
        Assert.True(noLink.Count == 0, "NotificationLinkBuilder chưa xử lý loại: " + string.Join(", ", noLink));
        var noFactory = types.Except(Factories().Select(f => f.Sample.Type)).ToList();
        Assert.True(noFactory.Count == 0, "Thiếu factory NotificationTarget cho loại: " + string.Join(", ", noFactory));
        Assert.True(types.SetEquals(declared), "Loại khai báo nhưng không category nào dùng: " + string.Join(", ", types.Except(declared)));
    }

    [Fact]
    public void Target_factory_name_matches_type()
    {
        foreach (var (name, sample) in Factories())
            Assert.Equal(Snake(name), sample.Type);
    }

    /// <summary>Câu lệnh có cả NotificationCategories.X và NotificationTarget.Y(…) → loại Y phải nằm trong danh mục của X (bắt gửi sai loại lúc build test).</summary>
    [Fact]
    public void Notifications_send_allowed_target_type()
    {
        var bad = new List<string>();
        var checkedCount = 0;
        foreach (var (path, text) in Files.Where(f => !f.Path.Contains($"OfficeHub.Modules.Notification{Path.DirectorySeparatorChar}")))
            foreach (var stmt in text.Split(';'))
            {
                var cats = CategoryRef().Matches(stmt).Select(m => m.Groups[1].Value).Distinct().ToList();
                var targets = TargetRef().Matches(stmt).Select(m => Snake(m.Groups[1].Value)).Distinct().ToList();
                if (cats.Count != 1 || targets.Count == 0) continue;
                var cat = (string)typeof(NotificationCategories).GetField(cats[0])!.GetValue(null)!;
                checkedCount++;
                bad.AddRange(targets.Where(t => !NotificationCatalog.AllowsTarget(cat, t)).Select(t => $"{Path.GetFileName(path)}: {cats[0]} → {t}"));
            }
        Assert.True(bad.Count == 0, "Gửi targetType ngoài danh mục NotificationCatalog.CategoryTargets: " + string.Join("; ", bad));
        Assert.True(checkedCount > 30, $"Chỉ quét được {checkedCount} chỗ gửi — regex lệch code?");
    }

    [Fact]
    public void Business_modules_do_not_build_web_links_for_notifications()
    {
        // Module nghiệp vụ không tự ghép URL cho thông báo (link sinh ở NotificationLinkBuilder) — chặn quay lại kiểu cũ.
        var bad = Files.Where(f => !f.Path.Contains($"OfficeHub.Modules.Notification{Path.DirectorySeparatorChar}"))
            .Where(f => OldLinkArg().IsMatch(f.Text)).Select(f => Path.GetFileName(f.Path)).ToList();
        Assert.True(bad.Count == 0, "Truyền NotificationTarget thay cho chuỗi link: " + string.Join(", ", bad));
    }

    [Fact]
    public void Notifications_carry_target_only_no_link()
    {
        // TEST-238 (G2): target là nguồn duy nhất — không còn Link trên yêu cầu / dòng lưu / API chuông; URL chỉ dựng lúc gửi email.
        Assert.Null(typeof(NotificationRequest).GetProperty("Link"));
        var target = typeof(NotificationRequest).GetProperty(nameof(NotificationRequest.Target))!;
        Assert.Equal(System.Reflection.NullabilityState.NotNull, new System.Reflection.NullabilityInfoContext().Create(target).ReadState); // Target bắt buộc
        Assert.Null(typeof(Domain.Notification).GetProperty("Link"));
        Assert.Null(typeof(NotificationDto).GetProperty("Link"));
        var push = typeof(IPushSender).GetMethod(nameof(IPushSender.PushAsync))!.GetParameters().Select(p => p.Name).ToList();
        Assert.DoesNotContain("link", push);

        // Không chỗ nào còn gán / đọc Link của thông báo: nơi gọi NotificationRequest (mọi module) và module Notification (trừ migration +
        // NotificationMigrator — backfill đọc cột Link cũ bằng SQL thô trước khi migration xoá cột).
        var callers = Files.Where(f => LinkInit().IsMatch(f.Text)).Select(f => Path.GetFileName(f.Path)).ToList();
        Assert.True(callers.Count == 0, "Còn truyền Link vào NotificationRequest: " + string.Join(", ", callers));
        var sep = Path.DirectorySeparatorChar;
        var module = Directory.EnumerateFiles(Path.Combine(Src, "Modules", "Notification"), "*.cs", SearchOption.AllDirectories)
            .Where(f => !f.Contains($"{sep}obj{sep}") && !f.Contains($"{sep}bin{sep}") && !f.Contains($"{sep}Migrations{sep}") && !f.EndsWith("NotificationMigrator.cs"))
            .Where(f => LinkMember().IsMatch(File.ReadAllText(f))).Select(Path.GetFileName).ToList();
        Assert.True(module.Count == 0, "Module Notification còn tham chiếu Link của thông báo: " + string.Join(", ", module));
    }

    private static IEnumerable<(string Name, NotificationTarget Sample)> Factories() =>
        typeof(NotificationTarget).GetMethods(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static)
            .Where(m => m.ReturnType == typeof(NotificationTarget))
            .Select(m => (m.Name, (NotificationTarget)m.Invoke(null, [.. m.GetParameters().Select(SampleArg)])!));

    private static object? SampleArg(System.Reflection.ParameterInfo p) =>
        p.ParameterType == typeof(Guid) ? Guid.NewGuid()
        : p.ParameterType == typeof(Guid?) ? null
        : p.ParameterType == typeof(string) ? (p.HasDefaultValue ? null : "attendance")
        : p.ParameterType.IsArray ? Array.CreateInstance(p.ParameterType.GetElementType()!, 0)
        : null;

    private static string Snake(string pascal) => Regex.Replace(pascal, "(?<=[a-z0-9])([A-Z])", "_$1").ToLowerInvariant();

    [GeneratedRegex(@"NotificationTarget\.(\w+)\(")]
    private static partial Regex TargetRef();

    /// <summary>Chuỗi đường dẫn web truyền vào NotificationRequest / PushAsync (kiểu trước TEST-237).</summary>
    [GeneratedRegex(@"(NotificationRequest|PushAsync)\([^;]*,\s*\$?""/[a-z]")]
    private static partial Regex OldLinkArg();

    /// <summary>new NotificationRequest(…) { Link = … } — kiểu G1 (TEST-237), bỏ ở TEST-238.</summary>
    [GeneratedRegex(@"NotificationRequest\([^;]*\)\s*\{[^;}]*Link\s*=")]
    private static partial Regex LinkInit();

    /// <summary>Thuộc tính / cột Link của thông báo (n.Link, Link = …, string? Link, "link" trong payload).</summary>
    [GeneratedRegex(@"\.Link|Link\s*=|string\??\s+Link|[\s,{]link\s*=|""link""")]
    private static partial Regex LinkMember();

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
