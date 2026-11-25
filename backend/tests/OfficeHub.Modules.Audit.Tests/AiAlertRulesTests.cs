using Microsoft.EntityFrameworkCore;
using OfficeHub.Modules.Audit.Domain;
using OfficeHub.Modules.Audit.Infrastructure;

namespace OfficeHub.Modules.Audit.Tests;

public class AiAlertRulesTests
{
    private static AiWindowStats S(int total = 0, int blocked = 0, int errors = 0, int writes = 0, int approvals = 0, int chats = 0) =>
        new(Guid.Empty, total, blocked, errors, writes, approvals, chats);

    private static string[] Rules(AiWindowStats s, bool isBot = false) => AiAlertRules.Evaluate(s, isBot).Select(h => h.Rule).ToArray();

    [Fact]
    public void Normal_activity_raises_nothing() =>
        Assert.Empty(Rules(S(total: 200, blocked: 9, errors: 19, writes: 59)));

    [Fact]
    public void Blocked_threshold()
    {
        var hits = AiAlertRules.Evaluate(S(total: 12, blocked: 10), false);
        Assert.Equal(AiAlertRules.Blocked, Assert.Single(hits).Rule);
        Assert.Equal(10, hits[0].Count);
    }

    [Fact]
    public void Errors_need_count_and_majority()
    {
        Assert.Equal([AiAlertRules.Errors], Rules(S(total: 30, errors: 20)));
        Assert.Empty(Rules(S(total: 40, errors: 20))); // đúng 50 % → chưa báo
        Assert.Empty(Rules(S(total: 19, errors: 19)));
    }

    [Fact]
    public void Burst_writes_threshold() => Assert.Equal([AiAlertRules.BurstWrites], Rules(S(total: 60, writes: 60)));

    [Fact]
    public void Approval_only_alerts_for_bot_accounts()
    {
        Assert.Equal([AiAlertRules.BotApproval], Rules(S(total: 3, writes: 1, approvals: 1), isBot: true));
        Assert.Empty(Rules(S(total: 3, writes: 1, approvals: 1), isBot: false)); // người thật duyệt qua Claude: hợp lệ
    }

    [Fact]
    public void Chat_spam_threshold()
    {
        Assert.Empty(Rules(S(total: 19, writes: 19, chats: 19)));
        Assert.Equal([AiAlertRules.ChatSpam], Rules(S(total: 20, writes: 20, chats: 20)));
    }

    [Fact]
    public void Several_rules_at_once() =>
        Assert.Equal([AiAlertRules.Blocked, AiAlertRules.Errors, AiAlertRules.BurstWrites, AiAlertRules.BotApproval],
            Rules(S(total: 100, blocked: 15, errors: 60, writes: 80, approvals: 2), isBot: true));

    [Fact]
    public void Cooldown_is_one_hour()
    {
        var now = new DateTimeOffset(2026, 11, 11, 10, 0, 0, TimeSpan.Zero);
        Assert.False(AiAlertRules.InCooldown(null, now));
        Assert.True(AiAlertRules.InCooldown(now.AddMinutes(-59), now));
        Assert.False(AiAlertRules.InCooldown(now.AddMinutes(-60), now));
    }

    // ---- Ngưỡng chỉnh được (TEST-232) ----

    [Fact]
    public void Default_thresholds_match_original_constants()
    {
        var d = AiAlertThresholds.Default;
        Assert.Equal((10, 20, 50, 60, 20, 15, 60), (d.Blocked, d.Errors, d.ErrorsPercent, d.BurstWrites, d.ChatSpam, d.WindowMinutes, d.CooldownMinutes));
        Assert.Empty(d.Validate());
        Assert.Equal(TimeSpan.FromMinutes(15), d.Window);
        Assert.Equal(TimeSpan.FromHours(1), d.Cooldown);
    }

    [Fact]
    public void Custom_thresholds_are_applied()
    {
        var t = AiAlertThresholds.Default with { Blocked = 3, Errors = 5, ErrorsPercent = 20, BurstWrites = 10, ChatSpam = 4 };
        string[] R(AiWindowStats s, bool bot = false) => AiAlertRules.Evaluate(s, bot, t).Select(h => h.Rule).ToArray();
        Assert.Equal([AiAlertRules.Blocked], R(S(total: 3, blocked: 3)));
        Assert.Empty(R(S(total: 3, blocked: 2)));
        Assert.Equal([AiAlertRules.Errors], R(S(total: 20, errors: 5))); // 25 % > 20 %
        Assert.Empty(R(S(total: 25, errors: 5))); // đúng 20 % → chưa báo
        Assert.Equal([AiAlertRules.BurstWrites], R(S(total: 10, writes: 10)));
        Assert.Equal([AiAlertRules.ChatSpam], R(S(total: 4, chats: 4)));
        // Ngưỡng cao hơn mặc định → hoạt động mặc định vốn báo nay không báo.
        var high = AiAlertThresholds.Default with { Blocked = 50 };
        Assert.Empty(AiAlertRules.Evaluate(S(total: 12, blocked: 10), false, high));
    }

    [Fact]
    public void Errors_percent_zero_means_count_only() =>
        Assert.Equal([AiAlertRules.Errors],
            AiAlertRules.Evaluate(S(total: 1000, errors: 20), false, AiAlertThresholds.Default with { ErrorsPercent = 0 }).Select(h => h.Rule));

    [Fact]
    public void Bot_approval_always_on_regardless_of_thresholds()
    {
        var t = new AiAlertThresholds(1000, 1000, 99, 10_000, 1000, 1440, 10_080);
        Assert.Equal([AiAlertRules.BotApproval], AiAlertRules.Evaluate(S(total: 1, approvals: 1), true, t).Select(h => h.Rule));
    }

    [Fact]
    public void Custom_cooldown()
    {
        var now = new DateTimeOffset(2026, 11, 25, 10, 0, 0, TimeSpan.Zero);
        Assert.True(AiAlertRules.InCooldown(now.AddMinutes(-9), now, TimeSpan.FromMinutes(10)));
        Assert.False(AiAlertRules.InCooldown(now.AddMinutes(-10), now, TimeSpan.FromMinutes(10)));
        Assert.True(AiAlertRules.InCooldown(now.AddHours(-3), now, TimeSpan.FromHours(4)));
    }

    [Fact]
    public void Validate_reports_ranges_with_numbers()
    {
        var e = new AiAlertThresholds(0, 1001, 100, 10_001, 0, 4, 10_081).Validate();
        Assert.Equal(["blockedThreshold", "burstWritesThreshold", "chatSpamThreshold", "cooldownMinutes", "errorsPercent", "errorsThreshold", "windowMinutes"],
            e.Keys.Order().ToArray());
        Assert.Equal("Số lệnh bị chặn phải từ 1 đến 1000", e["blockedThreshold"]);
        Assert.Equal("Cửa sổ thời gian (phút) phải từ 5 đến 1440", e["windowMinutes"]);
        Assert.Empty(new AiAlertThresholds(1, 1, 0, 1, 1, 5, 5).Validate());
        Assert.Empty(new AiAlertThresholds(1000, 1000, 99, 10_000, 1000, 1440, 10_080).Validate());
    }

    [Fact]
    public void Settings_row_round_trips_thresholds()
    {
        var t = new AiAlertThresholds(3, 4, 5, 6, 7, 30, 120);
        var row = new AiAlertSettings();
        row.Apply(t);
        Assert.Equal(t, row.ToThresholds());
    }

    [Fact]
    public void Body_uses_alert_window()
    {
        Assert.Contains("trong 15 phút qua", AiAlertRules.Body(AiAlertRules.Blocked, 10, 12));
        Assert.Contains("trong 30 phút qua", AiAlertRules.Body(AiAlertRules.Blocked, 10, 12, 30));
        Assert.Contains("trong 2 giờ qua", AiAlertRules.Body(AiAlertRules.Errors, 10, 12, 120));
        Assert.Contains("trong 1 giờ 30 phút qua", AiAlertRules.Body(AiAlertRules.ChatSpam, 10, 12, 90));
        var a = new AiAlert { WindowStart = DateTimeOffset.UnixEpoch, WindowEnd = DateTimeOffset.UnixEpoch.AddMinutes(45) };
        Assert.Equal(45, AiAlertRules.WindowMinutesOf(a));
    }

    [Fact]
    public void Email_only_for_bot_approval()
    {
        Assert.True(AiAlertRules.SendsEmail(AiAlertRules.BotApproval));
        Assert.All(AiAlertRules.All.Where(r => r != AiAlertRules.BotApproval), r => Assert.False(AiAlertRules.SendsEmail(r)));
    }

    [Fact]
    public void Every_rule_has_vietnamese_text() =>
        Assert.All(AiAlertRules.All, r =>
        {
            Assert.Contains("An", AiAlertRules.Title(r, "An"));
            Assert.Contains("5", AiAlertRules.Body(r, 5, 9));
        });

    [Fact]
    public void Window_stats_translate_to_single_group_by()
    {
        var db = new AuditDbContext(new DbContextOptionsBuilder<AuditDbContext>().UseNpgsql("Host=localhost;Database=x").Options);
        var now = DateTimeOffset.UtcNow;
        var sql = AiAlertMonitor.WindowStats(db.AiRequests, now.AddMinutes(-15), now).ToQueryString();
        Assert.Contains("GROUP BY", sql);
        Assert.Contains("FILTER (WHERE", sql);
    }
}
