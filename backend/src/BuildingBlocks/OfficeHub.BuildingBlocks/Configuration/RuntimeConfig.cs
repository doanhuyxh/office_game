using System.Net;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace OfficeHub.BuildingBlocks.Configuration;

/// <summary>Nhóm cấu hình hệ thống admin sửa được trên trang Hệ thống → Cấu hình (TEST-41). Tên = khoá dòng trong <c>settings.system_settings</c>.</summary>
public static class SettingsGroups
{
    public const string S3 = "s3", Smtp = "smtp", Fcm = "fcm", OfficeIps = "office_ips";
    public static readonly string[] All = [S3, Smtp, Fcm, OfficeIps];
}

/// <summary>
/// Một nhóm cấu hình đã lưu trong DB. <paramref name="Values"/> = các trường thường (JSON object, khoá camelCase);
/// <paramref name="Secrets"/> = trường bí mật ĐÃ GIẢI MÃ (chỉ dùng trong process, không bao giờ trả ra API).
/// </summary>
public sealed record StoredSettingsGroup(string Group, JsonObject Values, IReadOnlyDictionary<string, string> Secrets, DateTimeOffset UpdatedAt, string? UpdatedBy);

/// <summary>Nguồn cấu hình trong DB — module Settings cài đặt (scoped). Host không có module (Realtime / Mcp) → chỉ đọc .env.</summary>
public interface ISystemSettingsStore
{
    IReadOnlyList<StoredSettingsGroup> LoadAll();
}

/// <summary>FCM: từ DB (service account JSON + project id) hoặc .env (<c>Firebase__CredentialsPath</c>, đường dẫn đã giải).</summary>
public sealed class FcmSettings
{
    public string? ProjectId { get; init; }
    public string? ServiceAccountJson { get; init; }
    public string? CredentialsPath { get; init; }
    public bool Enabled => !string.IsNullOrWhiteSpace(ServiceAccountJson) || !string.IsNullOrWhiteSpace(CredentialsPath);
}

public sealed record OfficeIpRange(string Cidr, string? Note);

/// <summary>Dải IP văn phòng đã phân tích (một đối tượng mới mỗi khi cấu hình đổi).</summary>
public sealed class OfficeIpSettings(IReadOnlyList<OfficeIpRange> ranges)
{
    public IReadOnlyList<OfficeIpRange> Ranges { get; } = ranges;
    public IReadOnlyList<IPNetwork> Networks { get; } = [.. ranges.Select(r => TryParse(r.Cidr)).OfType<IPNetwork>()];

    /// <summary>Nhận CIDR ("1.2.3.0/24") hoặc một IP ("1.2.3.4" → /32, IPv6 → /128). Sai / bit host khác 0 → null.</summary>
    public static IPNetwork? TryParse(string? value)
    {
        var v = value?.Trim();
        if (string.IsNullOrEmpty(v)) return null;
        var slash = v.IndexOf('/');
        if (!IPAddress.TryParse(slash < 0 ? v : v[..slash], out var ip)) return null;
        var max = ip.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork ? 32 : 128;
        var prefix = max;
        if (slash >= 0 && (!int.TryParse(v[(slash + 1)..], out prefix) || prefix < 0 || prefix > max)) return null;
        // Chặt: "10.0.0.1/8" (bit host khác 0) bị từ chối — dễ là gõ nhầm, phải ghi 10.0.0.0/8.
        var bytes = ip.GetAddressBytes();
        for (var bit = prefix; bit < max; bit++)
            if ((bytes[bit / 8] & (0x80 >> (bit % 8))) != 0) return null;
        return new IPNetwork(ip, prefix);
    }
}

/// <summary>
/// Cấu hình S3 / SMTP / FCM / IP văn phòng đang có hiệu lực (TEST-41): nhóm có dòng trong DB → dùng DB, chưa có → .env như cũ.
/// Cache <see cref="CacheFor"/>; lưu trên trang Hệ thống gọi <see cref="Invalidate"/> → lần đọc kế tiếp nạp lại (không cần khởi động lại).
/// Đối tượng cấu hình chỉ đổi (khác tham chiếu) khi nhóm đổi → client S3 / Firebase so tham chiếu để biết lúc tạo lại.
/// </summary>
public sealed class RuntimeConfig(IServiceScopeFactory scopes, IOptions<S3Settings> s3Env, IOptions<SmtpSettings> smtpEnv, IOptions<OfficeSettings> officeEnv,
    IConfiguration config, IHostEnvironment env, TimeProvider clock, ILogger<RuntimeConfig> log)
{
    public static readonly TimeSpan CacheFor = TimeSpan.FromSeconds(30);

    private sealed record Snapshot(IReadOnlyDictionary<string, StoredSettingsGroup> Groups, S3Settings S3, SmtpSettings Smtp, FcmSettings Fcm, OfficeIpSettings OfficeIps);

    private readonly Lock _gate = new();
    private Snapshot? _snap;
    private long _loadedAt; // UtcTicks — đọc ngoài lock bằng Volatile
    private volatile bool _dirty = true;
    private bool _warned;

    public S3Settings S3 => Current.S3;
    public SmtpSettings Smtp => Current.Smtp;
    public FcmSettings Fcm => Current.Fcm;
    public OfficeIpSettings OfficeIps => Current.OfficeIps;

    /// <summary>Nhóm đang lấy từ DB (null = .env).</summary>
    public StoredSettingsGroup? Stored(string group) => Current.Groups.GetValueOrDefault(group);

    /// <summary>Xoá cache — gọi sau khi lưu / xoá cấu hình, hoặc khi migration xong.</summary>
    public void Invalidate() => _dirty = true;

    /// <summary>Giá trị .env của một nhóm, cùng dạng với cấu hình DB (để hiển thị khi nhóm chưa lưu vào DB).</summary>
    public JsonObject EnvValues(string group) => group switch
    {
        SettingsGroups.S3 => S3Values(s3Env.Value),
        SettingsGroups.Smtp => SmtpValues(smtpEnv.Value),
        SettingsGroups.Fcm => new JsonObject { ["projectId"] = null, ["credentialsPath"] = config["Firebase:CredentialsPath"] },
        SettingsGroups.OfficeIps => IpValues(ParseEnvIps(officeEnv.Value.IpRanges)),
        _ => [],
    };

    /// <summary>Bí mật đang có hiệu lực (DB, không có thì .env) — module Settings dùng để giữ giá trị cũ khi ô bí mật để trống.</summary>
    public string? CurrentSecret(string group, string key)
    {
        if (Stored(group) is { } g) return g.Secrets.GetValueOrDefault(key);
        return (group, key) switch
        {
            (SettingsGroups.S3, "secretKey") => NullIfEmpty(s3Env.Value.SecretKey),
            (SettingsGroups.Smtp, "password") => NullIfEmpty(smtpEnv.Value.Password),
            _ => null,
        };
    }

    private Snapshot Current
    {
        get
        {
            var snap = _snap;
            if (snap is not null && !_dirty && Fresh()) return snap;
            lock (_gate)
            {
                if (_snap is not null && !_dirty && Fresh()) return _snap;
                _dirty = false;
                Volatile.Write(ref _loadedAt, clock.GetUtcNow().UtcTicks);
                IReadOnlyList<StoredSettingsGroup> rows = [];
                try
                {
                    using var scope = scopes.CreateScope();
                    if (scope.ServiceProvider.GetService<ISystemSettingsStore>() is { } store) rows = store.LoadAll();
                    _warned = false;
                }
                catch (Exception ex)
                {
                    // Bảng chưa có (migration chưa chạy) / DB tạm lỗi → giữ bản cũ, thử lại sau CacheFor.
                    if (!_warned) log.LogWarning(ex, "Không đọc được cấu hình hệ thống trong DB — tạm dùng bản trước / .env");
                    _warned = true;
                    if (_snap is not null) return _snap;
                }
                _snap = Build(rows.ToDictionary(r => r.Group), _snap);
                return _snap;
            }
        }
    }

    private bool Fresh() => clock.GetUtcNow().UtcTicks - Volatile.Read(ref _loadedAt) < CacheFor.Ticks;

    private Snapshot Build(Dictionary<string, StoredSettingsGroup> groups, Snapshot? prev)
    {
        // Giữ nguyên đối tượng cũ khi nhóm không đổi (cùng nguồn + cùng thời điểm lưu) → client S3 / Firebase không bị tạo lại vô cớ.
        bool Same(string g) => prev is not null && prev.Groups.GetValueOrDefault(g)?.UpdatedAt == groups.GetValueOrDefault(g)?.UpdatedAt;
        var s3 = Same(SettingsGroups.S3) ? prev!.S3 : groups.TryGetValue(SettingsGroups.S3, out var a) ? S3From(a) : s3Env.Value;
        var smtp = Same(SettingsGroups.Smtp) ? prev!.Smtp : groups.TryGetValue(SettingsGroups.Smtp, out var b) ? SmtpFrom(b) : smtpEnv.Value;
        var fcm = Same(SettingsGroups.Fcm) ? prev!.Fcm : groups.TryGetValue(SettingsGroups.Fcm, out var c) ? FcmFrom(c) : FcmEnv();
        var ips = Same(SettingsGroups.OfficeIps) ? prev!.OfficeIps : new OfficeIpSettings(groups.TryGetValue(SettingsGroups.OfficeIps, out var d)
            ? IpsFrom(d.Values) : ParseEnvIps(officeEnv.Value.IpRanges));
        return new Snapshot(groups, s3, smtp, fcm, ips);
    }

    private FcmSettings FcmEnv()
    {
        var path = config["Firebase:CredentialsPath"];
        return new FcmSettings { CredentialsPath = string.IsNullOrWhiteSpace(path) ? null : EnvLoader.ResolvePath(path, env.ContentRootPath) };
    }

    private static S3Settings S3From(StoredSettingsGroup g) => new()
    {
        Region = Str(g.Values, "region") ?? "",
        ServiceUrl = Str(g.Values, "serviceUrl"),
        ForcePathStyle = Bool(g.Values, "forcePathStyle") ?? false,
        AccessKey = Str(g.Values, "accessKey") ?? "",
        SecretKey = g.Secrets.GetValueOrDefault("secretKey") ?? "",
        BucketFiles = Str(g.Values, "bucketFiles") ?? "",
        KeyPrefix = Str(g.Values, "keyPrefix") ?? "",
        PresignMinutes = Int(g.Values, "presignMinutes") ?? 5,
    };

    private static SmtpSettings SmtpFrom(StoredSettingsGroup g) => new()
    {
        Host = Str(g.Values, "host") ?? "",
        Port = Int(g.Values, "port") ?? 587,
        UseSsl = Bool(g.Values, "useSsl") ?? false,
        Username = Str(g.Values, "username"),
        Password = g.Secrets.GetValueOrDefault("password"),
        FromEmail = Str(g.Values, "fromEmail") ?? "",
        FromName = Str(g.Values, "fromName") ?? "OfficeHub",
        CheckCertificateRevocation = Bool(g.Values, "checkCertificateRevocation") ?? true,
    };

    private static FcmSettings FcmFrom(StoredSettingsGroup g) => new()
    {
        ProjectId = Str(g.Values, "projectId"),
        ServiceAccountJson = g.Secrets.GetValueOrDefault("serviceAccountJson"),
    };

    public static List<OfficeIpRange> IpsFrom(JsonObject values) =>
        values["ranges"] is JsonArray arr
            ? [.. arr.OfType<JsonObject>().Select(o => new OfficeIpRange(Str(o, "cidr") ?? "", Str(o, "note")))]
            : [];

    private static List<OfficeIpRange> ParseEnvIps(string? raw) =>
        [.. (raw ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Select(c => new OfficeIpRange(c, null))];

    public static JsonObject S3Values(S3Settings s) => new()
    {
        ["region"] = s.Region, ["serviceUrl"] = s.ServiceUrl, ["forcePathStyle"] = s.ForcePathStyle, ["accessKey"] = s.AccessKey,
        ["bucketFiles"] = s.BucketFiles, ["keyPrefix"] = s.KeyPrefix, ["presignMinutes"] = s.PresignMinutes,
    };

    public static JsonObject SmtpValues(SmtpSettings s) => new()
    {
        ["host"] = s.Host, ["port"] = s.Port, ["useSsl"] = s.UseSsl, ["username"] = s.Username, ["fromEmail"] = s.FromEmail,
        ["fromName"] = s.FromName, ["checkCertificateRevocation"] = s.CheckCertificateRevocation,
    };

    public static JsonObject IpValues(IEnumerable<OfficeIpRange> ranges) =>
        new() { ["ranges"] = new JsonArray([.. ranges.Select(r => (JsonNode)new JsonObject { ["cidr"] = r.Cidr, ["note"] = r.Note })]) };

    private static string? Str(JsonObject o, string k) =>
        o[k] is JsonValue v && v.TryGetValue<string>(out var s) && !string.IsNullOrWhiteSpace(s) ? s.Trim() : null;
    private static bool? Bool(JsonObject o, string k) => o[k] is JsonValue v && v.TryGetValue<bool>(out var b) ? b : null;
    private static int? Int(JsonObject o, string k) => o[k] is JsonValue v && v.TryGetValue<int>(out var i) ? i : null;
    private static string? NullIfEmpty(string? s) => string.IsNullOrEmpty(s) ? null : s;
}
