using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Audit.Domain;
using OfficeHub.Modules.Audit.Infrastructure;

namespace OfficeHub.Modules.Audit.Features;

/// <summary>Khoảng giá trị cho phép của một ngưỡng (FE dùng cho min / max của ô nhập).</summary>
public sealed record AiAlertRange(int Min, int Max);

/// <param name="IsDefault">Chưa ai chỉnh (hoặc đã khôi phục mặc định) — đang dùng giá trị mặc định.</param>
/// <param name="Defaults">Giá trị mặc định (nút "Khôi phục mặc định").</param>
public sealed record AiAlertSettingsDto(int BlockedThreshold, int ErrorsThreshold, int ErrorsPercent, int BurstWritesThreshold, int ChatSpamThreshold,
    int WindowMinutes, int CooldownMinutes, bool IsDefault, DateTimeOffset? UpdatedAt, string? UpdatedByName,
    UpdateAiAlertSettings Defaults, IReadOnlyDictionary<string, AiAlertRange> Ranges, int IntervalMinutes);

public sealed record UpdateAiAlertSettings(int BlockedThreshold, int ErrorsThreshold, int ErrorsPercent, int BurstWritesThreshold, int ChatSpamThreshold,
    int WindowMinutes, int CooldownMinutes)
{
    public AiAlertThresholds ToThresholds() =>
        new(BlockedThreshold, ErrorsThreshold, ErrorsPercent, BurstWritesThreshold, ChatSpamThreshold, WindowMinutes, CooldownMinutes);

    public static UpdateAiAlertSettings From(AiAlertThresholds t) =>
        new(t.Blocked, t.Errors, t.ErrorsPercent, t.BurstWrites, t.ChatSpam, t.WindowMinutes, t.CooldownMinutes);
}

/// <summary>
/// Ngưỡng cảnh báo trợ lý AI bất thường (TEST-232): GET / PUT / DELETE (= khôi phục mặc định) <c>/api/audit/ai-alert-settings</c>.
/// Chỉ quản trị viên đăng nhập web (trang Hệ thống → Cấu hình); token AI 403 (ngoài allowlist <c>AccessTokenAuth</c> + chặn lại ở đây) —
/// bot không tự nới ngưỡng. Job <see cref="AiAlertMonitor"/> đọc lại mỗi lần chạy → áp dụng ở lần quét kế tiếp. Chỉ cảnh báo, không chặn bot.
/// </summary>
internal static class AiAlertSettingsEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        var s = g.MapGroup("/ai-alert-settings").RequireAuthorization(AuthPolicies.Admin);
        s.MapGet("", GetAsync);
        s.MapPut("", UpdateAsync);
        s.MapDelete("", ResetAsync);
    }

    private static readonly IReadOnlyDictionary<string, AiAlertRange> Ranges = new Dictionary<string, AiAlertRange>
    {
        ["blockedThreshold"] = new(AiAlertThresholds.CountMin, AiAlertThresholds.BlockedMax),
        ["errorsThreshold"] = new(AiAlertThresholds.CountMin, AiAlertThresholds.ErrorsMax),
        ["errorsPercent"] = new(AiAlertThresholds.PercentMin, AiAlertThresholds.PercentMax),
        ["burstWritesThreshold"] = new(AiAlertThresholds.CountMin, AiAlertThresholds.WritesMax),
        ["chatSpamThreshold"] = new(AiAlertThresholds.CountMin, AiAlertThresholds.ChatsMax),
        ["windowMinutes"] = new(AiAlertThresholds.WindowMin, AiAlertThresholds.WindowMax),
        ["cooldownMinutes"] = new(AiAlertThresholds.CooldownMin, AiAlertThresholds.CooldownMax),
    };

    private static AiAlertSettingsDto Dto(AiAlertSettings? row)
    {
        var t = row?.ToThresholds() ?? AiAlertThresholds.Default;
        return new AiAlertSettingsDto(t.Blocked, t.Errors, t.ErrorsPercent, t.BurstWrites, t.ChatSpam, t.WindowMinutes, t.CooldownMinutes,
            row is null, row?.UpdatedAt, row?.UpdatedByName, UpdateAiAlertSettings.From(AiAlertThresholds.Default), Ranges,
            (int)AiAlertRules.Interval.TotalMinutes);
    }

    private static ProblemHttpResult TokenForbidden() =>
        TypedResults.Problem("Chỉ quản trị viên chỉnh trên web", statusCode: StatusCodes.Status403Forbidden);

    private static Task<AiAlertSettings?> RowAsync(AuditDbContext db, CancellationToken ct) =>
        db.AiAlertSettings.FirstOrDefaultAsync(x => x.Id == AiAlertSettings.SingletonId, ct);

    private static async Task<Results<Ok<AiAlertSettingsDto>, ProblemHttpResult>> GetAsync(ClaimsPrincipal user, AuditDbContext db, CancellationToken ct)
    {
        if (user.IsAccessToken()) return TokenForbidden();
        return TypedResults.Ok(Dto(await db.AiAlertSettings.AsNoTracking().FirstOrDefaultAsync(x => x.Id == AiAlertSettings.SingletonId, ct)));
    }

    private static async Task<Results<Ok<AiAlertSettingsDto>, ValidationProblem, ProblemHttpResult>> UpdateAsync(UpdateAiAlertSettings r, ClaimsPrincipal user,
        AuditDbContext db, TimeProvider clock, CancellationToken ct)
    {
        if (user.IsAccessToken()) return TokenForbidden();
        var t = r.ToThresholds();
        var errors = t.Validate();
        if (errors.Count > 0)
        {
            var val = new Validation();
            foreach (var (field, msg) in errors) val.Add(field, msg);
            return val.Problem();
        }
        var row = await RowAsync(db, ct);
        if (row is null) db.AiAlertSettings.Add(row = new AiAlertSettings());
        if (row.ToThresholds() != t || db.Entry(row).State == EntityState.Added)
        {
            row.Apply(t);
            row.UpdatedAt = clock.GetUtcNow();
            row.UpdatedByName = user.FindFirstValue(ClaimNames.FullName) ?? user.Identity?.Name;
            await db.SaveChangesAsync(ct);
        }
        return TypedResults.Ok(Dto(row));
    }

    /// <summary>Khôi phục mặc định: xoá dòng cấu hình (lịch sử sửa ghi lại giá trị cũ) → job dùng <see cref="AiAlertThresholds.Default"/>.</summary>
    private static async Task<Results<Ok<AiAlertSettingsDto>, ProblemHttpResult>> ResetAsync(ClaimsPrincipal user, AuditDbContext db, CancellationToken ct)
    {
        if (user.IsAccessToken()) return TokenForbidden();
        var row = await RowAsync(db, ct);
        if (row is not null)
        {
            db.AiAlertSettings.Remove(row);
            await db.SaveChangesAsync(ct);
        }
        return TypedResults.Ok(Dto(null));
    }
}
