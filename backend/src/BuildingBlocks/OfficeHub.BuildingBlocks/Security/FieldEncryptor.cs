using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Configuration;

namespace OfficeHub.BuildingBlocks.Security;

/// <summary>
/// Mã hoá một giá trị để lưu vào một cột DB (AES-256-GCM, nonce ngẫu nhiên mỗi lần). Chuỗi lưu: "v1:" + base64(nonce|ciphertext|tag).
/// Dùng cho dữ liệu cá nhân nhạy cảm (NĐ 13/2023): lương, phụ cấp… Không tìm kiếm / sắp xếp được trên cột đã mã hoá.
/// </summary>
public interface IFieldEncryptor
{
    string Encrypt(string plain);
    /// <summary>Ném <see cref="CryptographicException"/> nếu sai khoá / dữ liệu bị sửa.</summary>
    string Decrypt(string token);

    string? EncryptDecimal(decimal? value) => value is { } v ? Encrypt(v.ToString(CultureInfo.InvariantCulture)) : null;
    decimal? DecryptDecimal(string? token) => token is null ? null : decimal.Parse(Decrypt(token), CultureInfo.InvariantCulture);
}

public sealed class AesGcmFieldEncryptor : IFieldEncryptor
{
    private const string Version = "v1:";
    private const int NonceSize = 12, TagSize = 16;
    private readonly byte[] _key;

    public AesGcmFieldEncryptor(IOptions<EncryptionSettings> options) : this(options.Value.Key) { }

    public AesGcmFieldEncryptor(string base64Key) =>
        _key = TryParseKey(base64Key) ?? throw new InvalidOperationException(KeyError);

    public const string KeyError = "Encryption__Key trong .env phải là base64 của đúng 32 byte (tạo bằng: openssl rand -base64 32)";

    public static byte[]? TryParseKey(string? base64)
    {
        try { return Convert.FromBase64String(base64 ?? "") is { Length: 32 } k ? k : null; }
        catch (FormatException) { return null; }
    }

    public string Encrypt(string plain)
    {
        var data = Encoding.UTF8.GetBytes(plain);
        var buf = new byte[NonceSize + data.Length + TagSize];
        var nonce = buf.AsSpan(0, NonceSize);
        RandomNumberGenerator.Fill(nonce);
        using var aes = new AesGcm(_key, TagSize);
        aes.Encrypt(nonce, data, buf.AsSpan(NonceSize, data.Length), buf.AsSpan(NonceSize + data.Length, TagSize));
        return Version + Convert.ToBase64String(buf);
    }

    public string Decrypt(string token)
    {
        if (!token.StartsWith(Version, StringComparison.Ordinal)) throw new CryptographicException("Dữ liệu mã hoá không đúng định dạng");
        var buf = Convert.FromBase64String(token[Version.Length..]);
        if (buf.Length < NonceSize + TagSize) throw new CryptographicException("Dữ liệu mã hoá không đúng định dạng");
        var len = buf.Length - NonceSize - TagSize;
        var plain = new byte[len];
        using var aes = new AesGcm(_key, TagSize);
        aes.Decrypt(buf.AsSpan(0, NonceSize), buf.AsSpan(NonceSize, len), buf.AsSpan(NonceSize + len, TagSize), plain);
        return Encoding.UTF8.GetString(plain);
    }
}

public static class FieldEncryptionExtensions
{
    /// <summary>Đăng ký <see cref="IFieldEncryptor"/>; kiểm tra Encryption__Key ngay khi khởi động. Gọi nhiều lần không sao.</summary>
    public static IServiceCollection AddFieldEncryption(this IServiceCollection services, IConfiguration config)
    {
        if (services.Any(d => d.ServiceType == typeof(IFieldEncryptor))) return services;
        services.AddValidatedOptions<EncryptionSettings>(config, EncryptionSettings.Section)
            .Validate(s => AesGcmFieldEncryptor.TryParseKey(s.Key) is not null, AesGcmFieldEncryptor.KeyError);
        services.TryAddSingleton<IFieldEncryptor, AesGcmFieldEncryptor>();
        return services;
    }
}
