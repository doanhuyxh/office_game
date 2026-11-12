using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Security;

namespace OfficeHub.Modules.Settings.Infrastructure;

/// <summary>Nạp mọi nhóm cấu hình trong DB cho <see cref="RuntimeConfig"/> (đồng bộ — gọi trong lock cache, vài dòng).</summary>
internal sealed class SettingsStore(SettingsDbContext db, IFieldEncryptor enc) : ISystemSettingsStore
{
    public IReadOnlyList<StoredSettingsGroup> LoadAll() =>
        [.. db.Settings.AsNoTracking().ToList().Select(s => new StoredSettingsGroup(
            s.Group,
            JsonNode.Parse(s.ValuesJson) as JsonObject ?? [],
            DecryptSecrets(enc, s.SecretsEncrypted),
            s.UpdatedAt,
            s.UpdatedByName))];

    public static Dictionary<string, string> DecryptSecrets(IFieldEncryptor enc, string? token) =>
        string.IsNullOrEmpty(token) ? [] : JsonSerializer.Deserialize<Dictionary<string, string>>(enc.Decrypt(token)) ?? [];

    public static string? EncryptSecrets(IFieldEncryptor enc, IReadOnlyDictionary<string, string> secrets) =>
        secrets.Count == 0 ? null : enc.Encrypt(JsonSerializer.Serialize(secrets));
}
