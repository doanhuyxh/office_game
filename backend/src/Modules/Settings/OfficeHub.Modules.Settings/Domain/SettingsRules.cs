using System.Text.Json;
using System.Text.Json.Nodes;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Http;

namespace OfficeHub.Modules.Settings.Domain;

/// <summary>Định nghĩa nhóm: tên hiển thị + khoá bí mật (không bao giờ trả ra API).</summary>
public sealed record SettingsGroupDef(string Group, string Name, string[] SecretKeys);

/// <summary>Kết quả chuẩn hoá một lần lưu: giá trị thường + bí mật cuối cùng (đã gộp giá trị cũ khi ô bí mật để trống).</summary>
public sealed record NormalizedSettings(JsonObject Values, Dictionary<string, string> Secrets);

/// <summary>Kiểm tra + chuẩn hoá cấu hình admin gửi lên (TEST-41). Hàm thuần — test ở OfficeHub.Modules.Settings.Tests.</summary>
public static class SettingsRules
{
    public static readonly IReadOnlyList<SettingsGroupDef> Groups =
    [
        new(SettingsGroups.S3, "Lưu trữ file (S3)", ["secretKey"]),
        new(SettingsGroups.Smtp, "Gửi mail (SMTP)", ["password"]),
        new(SettingsGroups.Fcm, "Thông báo đẩy (FCM)", ["serviceAccountJson"]),
        new(SettingsGroups.OfficeIps, "IP văn phòng", []),
    ];

    public static SettingsGroupDef? Find(string group) => Groups.FirstOrDefault(g => g.Group == group);

    public const int MaxIpRanges = 100;

    /// <param name="currentSecret">Bí mật đang có hiệu lực (DB / .env) — ô bí mật để trống thì giữ giá trị này.</param>
    public static NormalizedSettings Normalize(SettingsGroupDef def, JsonObject? input, IReadOnlyDictionary<string, string?>? secretsIn,
        IReadOnlyCollection<string>? clear, Func<string, string?> currentSecret, Validation v)
    {
        input ??= [];
        var secrets = new Dictionary<string, string>();
        foreach (var key in def.SecretKeys)
        {
            var typed = secretsIn?.GetValueOrDefault(key);
            if (!string.IsNullOrWhiteSpace(typed)) secrets[key] = typed.Trim();
            else if (clear?.Contains(key) != true && currentSecret(key) is { Length: > 0 } old) secrets[key] = old;
        }
        var values = def.Group switch
        {
            SettingsGroups.S3 => S3(input, secrets, v),
            SettingsGroups.Smtp => Smtp(input, v),
            SettingsGroups.Fcm => Fcm(input, secrets, v),
            SettingsGroups.OfficeIps => OfficeIps(input, v),
            _ => [],
        };
        return new(values, secrets);
    }

    private static JsonObject S3(JsonObject i, Dictionary<string, string> secrets, Validation v)
    {
        var region = Str(i, "region"); var bucket = Str(i, "bucketFiles"); var access = Str(i, "accessKey");
        var serviceUrl = Str(i, "serviceUrl"); var prefix = Str(i, "keyPrefix") ?? "";
        var presign = Int(i, "presignMinutes") ?? 5;
        v.Required(region, "region", "Region").MaxLength(region, 50, "region", "Region");
        v.Required(bucket, "bucketFiles", "Bucket").MaxLength(bucket, 100, "bucketFiles", "Bucket");
        v.Required(access, "accessKey", "Access key").MaxLength(access, 200, "accessKey", "Access key");
        v.When(!secrets.ContainsKey("secretKey"), "secretKey", "Secret key không được để trống");
        v.When(serviceUrl is not null && !(Uri.TryCreate(serviceUrl, UriKind.Absolute, out var u) && u.Scheme is "http" or "https"),
            "serviceUrl", "Endpoint phải là URL http(s), vd https://s3.example.com");
        v.When(prefix.Contains("..") || prefix.Length > 200, "keyPrefix", "Thư mục gốc không hợp lệ (tối đa 200 ký tự, không có \"..\")");
        v.When(presign is < 1 or > 1440, "presignMinutes", "Hạn link tạm từ 1 đến 1440 phút");
        return new()
        {
            ["region"] = region, ["serviceUrl"] = serviceUrl, ["forcePathStyle"] = Bool(i, "forcePathStyle") ?? false, ["accessKey"] = access,
            ["bucketFiles"] = bucket, ["keyPrefix"] = prefix, ["presignMinutes"] = presign,
        };
    }

    private static JsonObject Smtp(JsonObject i, Validation v)
    {
        var host = Str(i, "host"); var from = Str(i, "fromEmail"); var user = Str(i, "username");
        var port = Int(i, "port") ?? 587;
        v.Required(host, "host", "Máy chủ SMTP").MaxLength(host, 200, "host", "Máy chủ SMTP");
        v.When(port is < 1 or > 65535, "port", "Cổng từ 1 đến 65535");
        v.Required(from, "fromEmail", "Email người gửi").Email(from, "fromEmail");
        v.MaxLength(user, 200, "username", "Tài khoản");
        var name = Str(i, "fromName") ?? "OfficeHub";
        v.MaxLength(name, 100, "fromName", "Tên người gửi");
        return new()
        {
            ["host"] = host, ["port"] = port, ["useSsl"] = Bool(i, "useSsl") ?? false, ["username"] = user, ["fromEmail"] = from,
            ["fromName"] = name, ["checkCertificateRevocation"] = Bool(i, "checkCertificateRevocation") ?? true,
        };
    }

    private static JsonObject Fcm(JsonObject i, Dictionary<string, string> secrets, Validation v)
    {
        var projectId = Str(i, "projectId");
        string? jsonProject = null;
        if (!secrets.TryGetValue("serviceAccountJson", out var json))
            v.Add("serviceAccountJson", "Chưa có service account JSON (Firebase Console → Project settings → Service accounts → Generate new private key)");
        else
        {
            try
            {
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;
                string? Prop(string n) => root.ValueKind == JsonValueKind.Object && root.TryGetProperty(n, out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null;
                if (Prop("type") != "service_account" || string.IsNullOrWhiteSpace(Prop("private_key")) || string.IsNullOrWhiteSpace(Prop("client_email")))
                    v.Add("serviceAccountJson", "Không phải file service account của Firebase (thiếu type = service_account / private_key / client_email)");
                jsonProject = Prop("project_id");
            }
            catch (JsonException) { v.Add("serviceAccountJson", "Service account không phải JSON hợp lệ"); }
        }
        projectId ??= jsonProject;
        v.MaxLength(projectId, 100, "projectId", "Project ID");
        return new() { ["projectId"] = projectId };
    }

    private static JsonObject OfficeIps(JsonObject i, Validation v)
    {
        var ranges = new JsonArray();
        var items = i["ranges"] as JsonArray ?? [];
        if (items.Count > MaxIpRanges) { v.Add("ranges", $"Tối đa {MaxIpRanges} dải IP"); return new() { ["ranges"] = ranges }; }
        for (var k = 0; k < items.Count; k++)
        {
            var o = items[k] as JsonObject ?? [];
            var cidr = Str(o, "cidr"); var note = Str(o, "note");
            var net = OfficeIpSettings.TryParse(cidr);
            if (net is null)
                v.Add($"ranges[{k}].cidr", string.IsNullOrEmpty(cidr) ? "Nhập IP hoặc dải CIDR" : $"\"{cidr}\" không phải IP / CIDR hợp lệ (vd 203.0.113.10 hoặc 203.0.113.0/24)");
            v.MaxLength(note, 200, $"ranges[{k}].note", "Ghi chú");
            ranges.Add(new JsonObject { ["cidr"] = net?.ToString() ?? cidr, ["note"] = note });
        }
        return new() { ["ranges"] = ranges };
    }

    private static string? Str(JsonObject o, string k) =>
        o[k] is JsonValue val && val.GetValueKind() == JsonValueKind.String && val.GetValue<string>() is { } s && !string.IsNullOrWhiteSpace(s) ? s.Trim() : null;
    private static bool? Bool(JsonObject o, string k) =>
        o[k] is JsonValue val && val.GetValueKind() is JsonValueKind.True or JsonValueKind.False ? val.GetValue<bool>() : null;
    private static int? Int(JsonObject o, string k) =>
        o[k] is JsonValue val && val.GetValueKind() == JsonValueKind.Number && val.TryGetValue<int>(out var n) ? n : null;
}
