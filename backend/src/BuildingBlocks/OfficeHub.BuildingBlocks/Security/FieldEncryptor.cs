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
/// Mã hoá một giá trị để lưu vào một cột DB (AES-256-GCM, nonce ngẫu nhiên mỗi lần). Dùng cho dữ liệu cá nhân nhạy cảm (NĐ 13/2023):
/// lương, phụ cấp, CCCD, số tài khoản, token… Không tìm kiếm / sắp xếp được trên cột đã mã hoá.
/// Định dạng (TEST-17): "v2:{keyId}:" + base64(nonce|ciphertext|tag), keyId là dữ liệu xác thực kèm (AAD) → xoay khoá được: khoá cũ để trong
/// <c>Encryption__PreviousKeys</c> chỉ để giải mã, <see cref="FieldReEncryptionJob"/> mã hoá lại dần sang khoá hiện hành. Vẫn đọc "v1:" (bản cũ, không keyId).
/// </summary>
public interface IFieldEncryptor
{
    string Encrypt(string plain);
    /// <summary>Ném <see cref="CryptographicException"/> nếu sai khoá / dữ liệu bị sửa.</summary>
    string Decrypt(string token);

    /// <summary>Token đã mã hoá bằng khoá hiện hành (không cần mã hoá lại).</summary>
    bool IsCurrent(string token) => true;
    /// <summary>Tiền tố token của khoá hiện hành ("v2:{keyId}:") — job mã hoá lại tìm các giá trị KHÔNG bắt đầu bằng chuỗi này.</summary>
    string CurrentPrefix => "";

    string? EncryptDecimal(decimal? value) => value is { } v ? Encrypt(v.ToString(CultureInfo.InvariantCulture)) : null;
    decimal? DecryptDecimal(string? token) => token is null ? null : decimal.Parse(Decrypt(token), CultureInfo.InvariantCulture);
}

public sealed class AesGcmFieldEncryptor : IFieldEncryptor
{
    private const string V1 = "v1:", V2 = "v2:";
    private const int NonceSize = 12, TagSize = 16;
    private readonly string _currentId;
    private readonly byte[] _current;
    /// <summary>Mọi khoá giải mã được: hiện hành trước, rồi các khoá cũ theo thứ tự khai báo.</summary>
    private readonly List<(string Id, byte[] Key)> _ring;

    public AesGcmFieldEncryptor(IOptions<EncryptionSettings> options) : this(options.Value.Key, options.Value.KeyId, options.Value.PreviousKeys) { }

    public AesGcmFieldEncryptor(string base64Key, string? keyId = null, string? previousKeys = null)
    {
        _current = TryParseKey(base64Key) ?? throw new InvalidOperationException(KeyError);
        _currentId = string.IsNullOrWhiteSpace(keyId) ? EncryptionSettings.DefaultKeyId : keyId.Trim();
        if (!EncryptionSettings.IsValidKeyId(_currentId)) throw new InvalidOperationException(EncryptionSettings.KeyIdError);
        _ring = [(_currentId, _current)];
        foreach (var (id, key) in EncryptionSettings.ParsePrevious(previousKeys) ?? throw new InvalidOperationException(EncryptionSettings.PreviousError))
        {
            if (_ring.Any(r => r.Id == id)) throw new InvalidOperationException($"Encryption__PreviousKeys trùng keyId '{id}' với khoá khác");
            _ring.Add((id, key));
        }
    }

    public const string KeyError = "Encryption__Key trong .env phải là base64 của đúng 32 byte (tạo bằng: openssl rand -base64 32)";

    public static byte[]? TryParseKey(string? base64)
    {
        try { return Convert.FromBase64String(base64 ?? "") is { Length: 32 } k ? k : null; }
        catch (FormatException) { return null; }
    }

    public string CurrentPrefix => $"{V2}{_currentId}:";
    public bool IsCurrent(string token) => token.StartsWith(CurrentPrefix, StringComparison.Ordinal);

    public string Encrypt(string plain)
    {
        var data = Encoding.UTF8.GetBytes(plain);
        var buf = new byte[NonceSize + data.Length + TagSize];
        var nonce = buf.AsSpan(0, NonceSize);
        RandomNumberGenerator.Fill(nonce);
        using var aes = new AesGcm(_current, TagSize);
        aes.Encrypt(nonce, data, buf.AsSpan(NonceSize, data.Length), buf.AsSpan(NonceSize + data.Length, TagSize), Encoding.ASCII.GetBytes(_currentId));
        return CurrentPrefix + Convert.ToBase64String(buf);
    }

    public string Decrypt(string token)
    {
        if (token.StartsWith(V2, StringComparison.Ordinal))
        {
            var sep = token.IndexOf(':', V2.Length);
            if (sep < 0) throw new CryptographicException("Dữ liệu mã hoá không đúng định dạng");
            var id = token[V2.Length..sep];
            var key = _ring.FirstOrDefault(r => r.Id == id).Key
                ?? throw new CryptographicException($"Không có khoá '{id}' — thêm khoá cũ vào Encryption__PreviousKeys");
            return Open(key, Payload(token[(sep + 1)..]), Encoding.ASCII.GetBytes(id));
        }
        if (token.StartsWith(V1, StringComparison.Ordinal))
        {
            // Bản cũ không ghi keyId → thử lần lượt (khoá đúng thì tag GCM khớp, khoá sai thì ném).
            var buf = Payload(token[V1.Length..]);
            foreach (var (_, key) in _ring)
                try { return Open(key, buf, null); } catch (CryptographicException) { }
            throw new CryptographicException("Không giải mã được dữ liệu v1 bằng khoá nào trong keyring");
        }
        throw new CryptographicException("Dữ liệu mã hoá không đúng định dạng");
    }

    private static byte[] Payload(string b64)
    {
        var buf = Convert.FromBase64String(b64);
        if (buf.Length < NonceSize + TagSize) throw new CryptographicException("Dữ liệu mã hoá không đúng định dạng");
        return buf;
    }

    private static string Open(byte[] key, byte[] buf, byte[]? aad)
    {
        var len = buf.Length - NonceSize - TagSize;
        var plain = new byte[len];
        using var aes = new AesGcm(key, TagSize);
        aes.Decrypt(buf.AsSpan(0, NonceSize), buf.AsSpan(NonceSize, len), buf.AsSpan(NonceSize + len, TagSize), plain, aad);
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
            .Validate(s => AesGcmFieldEncryptor.TryParseKey(s.Key) is not null, AesGcmFieldEncryptor.KeyError)
            .Validate(s => EncryptionSettings.IsValidKeyId(string.IsNullOrWhiteSpace(s.KeyId) ? EncryptionSettings.DefaultKeyId : s.KeyId.Trim()),
                EncryptionSettings.KeyIdError)
            .Validate(s => EncryptionSettings.ParsePrevious(s.PreviousKeys) is not null, EncryptionSettings.PreviousError);
        services.TryAddSingleton<IFieldEncryptor, AesGcmFieldEncryptor>();
        services.TryAddEnumerable(ServiceDescriptor.Singleton<Microsoft.Extensions.Hosting.IHostedService, FieldReEncryptionJob>());
        return services;
    }

    /// <summary>
    /// Khai báo cột mã hoá của một entity để <see cref="FieldReEncryptionJob"/> mã hoá lại sang khoá hiện hành sau khi xoay khoá.
    /// Mỗi module tự khai báo cột của mình (không vi phạm ranh giới module).
    /// </summary>
    public static IServiceCollection AddEncryptedColumns<TContext, TEntity>(this IServiceCollection services, params string[] properties)
        where TContext : Microsoft.EntityFrameworkCore.DbContext where TEntity : class
    {
        foreach (var p in properties) services.AddSingleton(new EncryptedColumn(typeof(TContext), typeof(TEntity), p));
        return services;
    }
}
