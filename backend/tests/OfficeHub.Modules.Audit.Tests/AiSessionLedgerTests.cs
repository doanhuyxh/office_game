using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Ai;
using OfficeHub.Modules.Audit.Domain;
using OfficeHub.Modules.Audit.Infrastructure;

namespace OfficeHub.Modules.Audit.Tests;

/// <summary>Mức dùng AI theo phiên agent (TEST-134): kiểm tra lô, chuẩn hoá, gộp ngày / tháng / năm theo giờ VN, chi phí trống, quyền xem.</summary>
public class AiSessionLedgerTests
{
    private static readonly TimeZoneInfo Vn = TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh");
    private static readonly DateTimeOffset Now = new(2026, 11, 17, 3, 0, 0, TimeSpan.Zero);

    private static AiUsageSession Session(string sourceId, decimal? cost = 0.5m, params AiUsageModel[] models) =>
        new(sourceId, "task", null, null, "TEST-1", "claude", "done", Now.AddMinutes(-10), Now, 5, cost, models);

    // ---------- Validate ----------

    [Fact]
    public void Validate_accepts_minimal_session_and_null_costs()
    {
        Assert.Null(AiUsageRoute.Validate([Session("a", null)], Now));
        Assert.Null(AiUsageRoute.Validate([Session("a", null, new AiUsageModel("m", null, null, null, null, null))], Now));
    }

    [Fact]
    public void Validate_rejects_bad_batches()
    {
        Assert.NotNull(AiUsageRoute.Validate([], Now));
        Assert.NotNull(AiUsageRoute.Validate(null, Now));
        Assert.NotNull(AiUsageRoute.Validate(Enumerable.Range(0, 51).Select(i => (AiUsageSession?)Session($"s{i}")).ToList(), Now));
        Assert.Contains("sourceId", AiUsageRoute.Validate([Session(" ")], Now));
        Assert.Contains("sourceId", AiUsageRoute.Validate([Session(new string('x', 101))], Now));
        Assert.Contains("trùng", AiUsageRoute.Validate([Session("a"), Session("a")], Now));
        Assert.Contains("costUsd", AiUsageRoute.Validate([Session("a", -1m)], Now));
        Assert.Contains("token", AiUsageRoute.Validate([Session("a", 1m, new AiUsageModel("m", -5, 0, 0, 0, 0))], Now));
        Assert.Contains("status", AiUsageRoute.Validate([Session("a") with { Status = "ok" }], Now));
        Assert.Contains("kind", AiUsageRoute.Validate([Session("a") with { Kind = "x" }], Now));
        Assert.Contains("startedAt", AiUsageRoute.Validate([Session("a") with { StartedAt = null }], Now));
        Assert.Contains("finishedAt", AiUsageRoute.Validate([Session("a") with { StartedAt = Now, FinishedAt = Now.AddMinutes(-1) }], Now));
    }

    [Fact]
    public void Validate_allows_one_day_future_skew_only()
    {
        Assert.Null(AiUsageRoute.Validate([Session("a") with { FinishedAt = Now.AddHours(23) }], Now));
        Assert.Contains("tương lai", AiUsageRoute.Validate([Session("a") with { FinishedAt = Now.AddDays(1).AddMinutes(1) }], Now));
    }

    // ---------- Normalize ----------

    [Fact]
    public void Normalize_without_models_adds_unknown_row_with_session_cost()
    {
        var n = AiSessionLedger.Normalize(Session(" src ", 0.25m) with { Kind = null, Executor = " " });
        Assert.Equal("src", n.SourceId);
        Assert.Equal("other", n.Kind);
        Assert.Equal("other", n.Executor);
        var m = Assert.Single(n.Models);
        Assert.Equal(AiUsageRoute.UnknownModel, m.Model);
        Assert.Equal(0.25m, m.CostUsd);
    }

    [Fact]
    public void Normalize_merges_duplicate_models_and_derives_session_cost()
    {
        var n = AiSessionLedger.Normalize(Session("a", null,
            new AiUsageModel("opus", 10, 1, null, null, 0.1m),
            new AiUsageModel(" opus ", 5, null, 2, null, 0.2m),
            new AiUsageModel("haiku", 1, 1, 1, 1, 0.05m)));
        Assert.Equal(2, n.Models.Count);
        var opus = n.Models.Single(m => m.Model == "opus");
        Assert.Equal(15, opus.InputTokens);
        Assert.Equal(1, opus.OutputTokens);
        Assert.Equal(2, opus.CacheReadTokens);
        Assert.Null(opus.CacheWriteTokens);
        Assert.Equal(0.3m, opus.CostUsd);
        Assert.Equal(0.35m, n.CostUsd);
    }

    [Fact]
    public void Normalize_keeps_null_cost_when_some_model_has_none()
    {
        var n = AiSessionLedger.Normalize(Session("a", null, new AiUsageModel("x", 1, 1, 0, 0, 0.1m), new AiUsageModel("y", 1, 1, 0, 0, null)));
        Assert.Null(n.CostUsd);
    }

    // ---------- Range / bucket ----------

    [Fact]
    public void ParseRange_defaults_by_group()
    {
        var today = new DateOnly(2026, 11, 17);
        Assert.Equal((new DateOnly(2026, 10, 19), today), AiSessionLedger.ParseRange(null, null, "day", today, out _));
        Assert.Equal((new DateOnly(2025, 12, 1), today), AiSessionLedger.ParseRange(null, null, "month", today, out _));
        Assert.Equal((new DateOnly(2022, 1, 1), today), AiSessionLedger.ParseRange(null, null, "year", today, out _));
        Assert.Null(AiSessionLedger.ParseRange("2026-11-18", "2026-11-17", "day", today, out var bad));
        Assert.Equal("from", bad);
        Assert.Null(AiSessionLedger.ParseRange(null, "17/11/2026", "day", today, out bad));
        Assert.Equal("to", bad);
        Assert.Null(AiSessionLedger.ParseRange("2000-01-01", null, "year", today, out bad));
    }

    [Fact]
    public void Session_finishing_2330_utc_falls_on_next_vietnam_day()
    {
        var at = new DateTimeOffset(2026, 11, 30, 23, 30, 0, TimeSpan.Zero); // 06:30 1/12 giờ VN
        Assert.Equal("2026-12-01", AiSessionLedger.BucketOf(at, Vn, "day"));
        Assert.Equal("2026-12", AiSessionLedger.BucketOf(at, Vn, "month"));
        var newYear = new DateTimeOffset(2026, 12, 31, 17, 0, 0, TimeSpan.Zero); // 00:00 1/1/2027 giờ VN
        Assert.Equal("2027", AiSessionLedger.BucketOf(newYear, Vn, "year"));
        Assert.Equal("2026", AiSessionLedger.BucketOf(newYear.AddSeconds(-1), Vn, "year"));
    }

    // ---------- Summarize ----------

    private static AiUsageRow Row(Guid id, DateTimeOffset at, decimal? sessionCost, string model, long input, decimal? modelCost) =>
        new(id, at, sessionCost, model, input, input / 2, 0, 0, modelCost);

    [Fact]
    public void Summarize_groups_by_vietnam_day_and_model_with_missing_costs()
    {
        Guid a = Guid.NewGuid(), b = Guid.NewGuid(), c = Guid.NewGuid();
        var d1 = new DateTimeOffset(2026, 11, 16, 23, 30, 0, TimeSpan.Zero); // 17/11 VN
        var d0 = new DateTimeOffset(2026, 11, 16, 10, 0, 0, TimeSpan.Zero);  // 16/11 VN
        var rows = new[]
        {
            Row(a, d1, 1.0m, "opus", 100, 0.8m), Row(a, d1, 1.0m, "haiku", 10, 0.2m), // một phiên hai model
            Row(b, d1, null, "opus", 50, null),                                       // phiên không có chi phí
            Row(c, d0, 0.5m, "opus", 20, 0.5m),
        };
        var s = AiSessionLedger.Summarize(rows, "day", Vn);

        Assert.Equal(["2026-11-16", "2026-11-17"], s.Buckets.Select(x => x.Bucket));
        var opus17 = s.Groups.Single(g => g.Bucket == "2026-11-17" && g.Model == "opus");
        Assert.Equal(2, opus17.Sessions);
        Assert.Equal(150, opus17.InputTokens);
        Assert.Equal(0.8m, opus17.CostUsd);
        Assert.Equal(1, opus17.CostMissing);

        var day17 = s.Buckets.Single(x => x.Bucket == "2026-11-17");
        Assert.Equal(2, day17.Sessions);          // phiên a đếm một lần dù hai model
        Assert.Equal(1.0m, day17.CostUsd);
        Assert.Equal(1, day17.CostMissing);
        Assert.Equal(160, day17.InputTokens);

        Assert.Equal(3, s.Total.Sessions);
        Assert.Equal(1.5m, s.Total.CostUsd);
        Assert.Equal(1, s.Total.CostMissing);
        Assert.Null(s.Total.Bucket);

        var months = AiSessionLedger.Summarize(rows, "month", Vn);
        Assert.Equal("2026-11", Assert.Single(months.Buckets).Bucket);
        Assert.Equal(3, months.Groups.Single(g => g.Model == "opus").Sessions);
    }

    [Fact]
    public void Summarize_empty_returns_zero_total()
    {
        var s = AiSessionLedger.Summarize([], "year", Vn);
        Assert.Empty(s.Groups);
        Assert.Equal(0, s.Total.Sessions);
        Assert.Equal(0m, s.Total.CostUsd);
    }

    // ---------- Quyền ----------

    [Fact]
    public void ResolveScope_self_by_default_others_only_for_admin_hr()
    {
        Guid me = Guid.NewGuid(), other = Guid.NewGuid();
        Assert.Equal(me, AiSessionLedger.ResolveScope(me, false, null).Scope!.UserId);
        Assert.Equal(me, AiSessionLedger.ResolveScope(me, false, me.ToString()).Scope!.UserId);
        Assert.Equal("forbidden", AiSessionLedger.ResolveScope(me, false, other.ToString()).Error);
        Assert.Equal("forbidden", AiSessionLedger.ResolveScope(me, false, "all").Error);
        Assert.Equal("invalid", AiSessionLedger.ResolveScope(me, true, "abc").Error);
        Assert.Equal(other, AiSessionLedger.ResolveScope(me, true, other.ToString()).Scope!.UserId);
        Assert.Null(AiSessionLedger.ResolveScope(me, true, "ALL").Scope!.UserId);
    }

    [Theory]
    [InlineData(null, true, null)]
    [InlineData("  ", true, null)]
    [InlineData("task", true, "task")]
    [InlineData(" Meeting ", true, "meeting")]
    [InlineData("chat", true, "chat")]
    [InlineData("bogus", false, "bogus")]
    public void TryKind_accepts_known_kinds_or_empty(string? input, bool ok, string? value)
    {
        Assert.Equal(ok, AiSessionLedger.TryKind(input, out var v));
        Assert.Equal(value, v);
    }

    [Theory]
    [InlineData(null, true, null)]
    [InlineData("", true, null)]
    [InlineData("done", true, "done")]
    [InlineData(" Failed ", true, "failed")]
    [InlineData("skipped", true, "skipped")]
    [InlineData("abc", false, "abc")]
    public void TryStatus_accepts_known_statuses_or_empty(string? input, bool ok, string? value)
    {
        Assert.Equal(ok, AiSessionLedger.TryStatus(input, out var v));
        Assert.Equal(value, v);
    }

    // ---------- SQL ----------

    [Fact]
    public void Upsert_key_is_unique_per_user_and_source()
    {
        using var db = new AuditDbContext(new DbContextOptionsBuilder<AuditDbContext>().UseNpgsql("Host=localhost;Database=x").Options);
        var ix = db.Model.FindEntityType(typeof(AiSessionUsage))!.GetIndexes().Single(i => i.IsUnique);
        Assert.Equal(["UserId", "SourceId"], ix.Properties.Select(p => p.Name));
        var models = db.Model.FindEntityType(typeof(AiSessionModel))!.GetIndexes().Single(i => i.IsUnique);
        Assert.Equal(["SessionId", "Model"], models.Properties.Select(p => p.Name));
    }
}
