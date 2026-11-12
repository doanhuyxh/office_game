using System.Security.Claims;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Email;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.BuildingBlocks.Office;
using OfficeHub.BuildingBlocks.Security;
using OfficeHub.BuildingBlocks.Storage;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Settings.Domain;
using OfficeHub.Modules.Settings.Infrastructure;

namespace OfficeHub.Modules.Settings.Features;

/// <param name="Source">"db" = đang dùng cấu hình lưu trên trang; "env" = chưa lưu, đang đọc .env.</param>
/// <param name="Secrets">Khoá bí mật → đã đặt hay chưa. KHÔNG BAO GIỜ có giá trị.</param>
public sealed record SettingsGroupDto(string Group, string Name, string Source, DateTimeOffset? UpdatedAt, string? UpdatedBy,
    JsonObject Values, IReadOnlyDictionary<string, bool> Secrets);

/// <param name="Secrets">Bí mật mới; để trống / null = giữ giá trị cũ.</param>
/// <param name="ClearSecrets">Khoá bí mật muốn xoá hẳn (vd SMTP không cần mật khẩu).</param>
public sealed record SaveSettingsRequest(JsonObject? Values, Dictionary<string, string?>? Secrets, string[]? ClearSecrets);

public sealed record SettingsTestResult(bool Ok, string Message);

/// <param name="To">SMTP: email nhận thư thử (trống = email của admin đang đăng nhập). Nhóm khác bỏ qua.</param>
public sealed record SettingsTestRequest(string? To);

/// <summary>
/// Cấu hình hệ thống (TEST-41): GET / PUT / DELETE <c>/api/system/settings/{group}</c> + POST <c>/{group}/test</c>. Chỉ admin (AuthPolicies.Admin);
/// prefix /api/system nằm NGOÀI allowlist token AI. Lưu / xoá → <see cref="RuntimeConfig.Invalidate"/> → có hiệu lực ngay, không khởi động lại.
/// </summary>
internal static class SettingsEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/", ListAsync);
        g.MapGet("/{group}", GetAsync);
        g.MapPut("/{group}", SaveAsync);
        g.MapDelete("/{group}", ResetAsync);
        g.MapPost("/{group}/test", TestAsync);
    }

    private static Ok<List<SettingsGroupDto>> ListAsync(RuntimeConfig runtime) =>
        TypedResults.Ok(SettingsRules.Groups.Select(d => ToDto(d, runtime)).ToList());

    private static Results<Ok<SettingsGroupDto>, ProblemHttpResult> GetAsync(string group, RuntimeConfig runtime) =>
        SettingsRules.Find(group) is { } def ? TypedResults.Ok(ToDto(def, runtime)) : Problems.NotFound("Nhóm cấu hình");

    private static SettingsGroupDto ToDto(SettingsGroupDef def, RuntimeConfig runtime)
    {
        if (runtime.Stored(def.Group) is { } s)
            return new(def.Group, def.Name, "db", s.UpdatedAt, s.UpdatedBy, (JsonObject)s.Values.DeepClone(),
                def.SecretKeys.ToDictionary(k => k, k => s.Secrets.ContainsKey(k)));
        var secrets = def.SecretKeys.ToDictionary(k => k, k => runtime.CurrentSecret(def.Group, k) is not null);
        if (def.Group == SettingsGroups.Fcm) secrets["serviceAccountJson"] = runtime.Fcm.Enabled; // .env: file service account
        return new(def.Group, def.Name, "env", null, null, runtime.EnvValues(def.Group), secrets);
    }

    private static async Task<Results<Ok<SettingsGroupDto>, ValidationProblem, ProblemHttpResult>> SaveAsync(string group, SaveSettingsRequest req,
        ClaimsPrincipal user, SettingsDbContext db, IFieldEncryptor enc, RuntimeConfig runtime, TimeProvider clock, CancellationToken ct)
    {
        if (SettingsRules.Find(group) is not { } def) return Problems.NotFound("Nhóm cấu hình");
        var v = new Validation();
        foreach (var (k, val) in req.Secrets ?? [])
            v.When(!def.SecretKeys.Contains(k), k, "Trường bí mật không thuộc nhóm này").MaxLength(val, 20_000, k, "Giá trị bí mật");
        var n = SettingsRules.Normalize(def, req.Values, req.Secrets, req.ClearSecrets, k => runtime.CurrentSecret(group, k), v);
        if (v.Failed) return v.Problem();

        var row = await db.Settings.FirstOrDefaultAsync(s => s.Group == group, ct);
        if (row is null)
        {
            row = new SystemSetting { Group = group, Name = def.Name, ValuesJson = "{}" };
            db.Settings.Add(row);
        }
        var valuesJson = n.Values.ToJsonString();
        // Không đổi bí mật → giữ token cũ (lịch sử sửa không ghi "đã đổi" giả).
        var oldSecrets = string.IsNullOrEmpty(row.SecretsEncrypted) ? [] : SettingsStore.DecryptSecrets(enc, row.SecretsEncrypted);
        if (!SameSecrets(oldSecrets, n.Secrets) || db.Entry(row).State == EntityState.Added)
            row.SecretsEncrypted = SettingsStore.EncryptSecrets(enc, n.Secrets);
        row.ValuesJson = valuesJson;
        row.Name = def.Name;
        row.UpdatedAt = clock.GetUtcNow();
        row.UpdatedById = user.GetUserId();
        row.UpdatedByName = user.FindFirstValue(ClaimNames.FullName) ?? user.Identity?.Name;
        await db.SaveChangesAsync(ct);
        runtime.Invalidate();
        return TypedResults.Ok(ToDto(def, runtime));
    }

    private static bool SameSecrets(Dictionary<string, string> a, Dictionary<string, string> b) =>
        a.Count == b.Count && a.All(kv => b.TryGetValue(kv.Key, out var x) && x == kv.Value);

    /// <summary>Xoá cấu hình trong DB → quay về đọc .env.</summary>
    private static async Task<Results<Ok<SettingsGroupDto>, ProblemHttpResult>> ResetAsync(string group, SettingsDbContext db, RuntimeConfig runtime, CancellationToken ct)
    {
        if (SettingsRules.Find(group) is not { } def) return Problems.NotFound("Nhóm cấu hình");
        var row = await db.Settings.FirstOrDefaultAsync(s => s.Group == group, ct);
        if (row is not null)
        {
            db.Settings.Remove(row);
            await db.SaveChangesAsync(ct);
        }
        runtime.Invalidate();
        return TypedResults.Ok(ToDto(def, runtime));
    }

    /// <summary>Thử cấu hình ĐANG CÓ HIỆU LỰC (lưu trước rồi mới kiểm tra). Luôn 200 kèm ok / thông điệp; SMTP: email nhận sai → 400 (trường <c>to</c>).</summary>
    private static async Task<Results<Ok<SettingsTestResult>, ValidationProblem, ProblemHttpResult>> TestAsync(string group, SettingsTestRequest? req,
        HttpContext http, ClaimsPrincipal user, IFileStorage files, IEmailSender email, IPushSender push, ITelegramWakeup telegram, OfficeNetwork network,
        RuntimeConfig runtime, TimeProvider clock, CancellationToken ct)
    {
        if (SettingsRules.Find(group) is null) return Problems.NotFound("Nhóm cấu hình");
        var to = req?.To?.Trim();
        if (group == SettingsGroups.Smtp && !string.IsNullOrEmpty(to))
        {
            var v = new Validation().Email(to, "to").MaxLength(to, 200, "to", "Email nhận thư thử");
            if (v.Failed) return v.Problem();
        }
        SettingsTestResult result;
        try
        {
            result = group switch
            {
                SettingsGroups.S3 => await TestS3Async(files, runtime, ct),
                SettingsGroups.Smtp => await TestSmtpAsync(to, user, email, runtime, clock, ct),
                SettingsGroups.Fcm => await TestFcmAsync(push, ct),
                SettingsGroups.Telegram => await TestTelegramAsync(telegram, ct),
                _ => TestIp(http, network, runtime),
            };
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            result = new(false, $"Lỗi: {ex.Message}");
        }
        return TypedResults.Ok(result);
    }

    private static async Task<SettingsTestResult> TestS3Async(IFileStorage files, RuntimeConfig runtime, CancellationToken ct)
    {
        var key = $"_config-check/{Guid.CreateVersion7():N}.txt";
        await files.UploadAsync(key, new MemoryStream(Encoding.UTF8.GetBytes("OfficeHub config check")), "text/plain", ct);
        await files.DeleteAsync(key, ct);
        var s3 = runtime.S3;
        return new(true, $"Ghi và xoá file thử thành công ở s3://{s3.BucketFiles}/{s3.FilesPrefix}");
    }

    private static async Task<SettingsTestResult> TestSmtpAsync(string? requested, ClaimsPrincipal user, IEmailSender email, RuntimeConfig runtime,
        TimeProvider clock, CancellationToken ct)
    {
        var to = string.IsNullOrEmpty(requested) ? user.FindFirstValue(ClaimTypes.Email) : requested;
        if (string.IsNullOrWhiteSpace(to)) return new(false, "Nhập email nhận thư thử (tài khoản của bạn chưa có email)");
        var smtp = runtime.Smtp;
        await email.SendAsync(to, string.IsNullOrEmpty(requested) ? user.FindFirstValue(ClaimNames.FullName) ?? to : to, "OfficeHub — thư thử cấu hình SMTP",
            $"<p>Thư thử từ trang Hệ thống → Cấu hình lúc {clock.GetUtcNow():yyyy-MM-dd HH:mm:ss} UTC.</p><p>Máy chủ: {System.Net.WebUtility.HtmlEncode(smtp.Host)}:{smtp.Port}</p>", ct);
        return new(true, $"Đã gửi thư thử tới {to} qua {smtp.Host}:{smtp.Port}");
    }

    private static async Task<SettingsTestResult> TestFcmAsync(IPushSender push, CancellationToken ct)
    {
        var (ok, message) = await push.DryRunAsync(ct);
        return new(ok, message);
    }

    private static async Task<SettingsTestResult> TestTelegramAsync(ITelegramWakeup telegram, CancellationToken ct)
    {
        var (ok, message) = await telegram.SendTestAsync(ct);
        return new(ok, message);
    }

    private static SettingsTestResult TestIp(HttpContext http, OfficeNetwork network, RuntimeConfig runtime)
    {
        var ip = http.Connection.RemoteIpAddress;
        if (ip is { IsIPv4MappedToIPv6: true }) ip = ip.MapToIPv4();
        var ranges = runtime.OfficeIps.Ranges.Count;
        if (ranges == 0) return new(false, $"IP của bạn: {ip}. Chưa khai báo dải IP văn phòng — mọi lần chấm công đều tính Remote.");
        return network.IsOnsite(ip)
            ? new(true, $"IP của bạn: {ip} — KHỚP dải IP văn phòng (chấm công tính tại văn phòng).")
            : new(false, $"IP của bạn: {ip} — KHÔNG khớp {ranges} dải IP văn phòng (chấm công tính Remote).");
    }
}
