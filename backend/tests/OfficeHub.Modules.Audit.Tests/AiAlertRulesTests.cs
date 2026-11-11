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
