using System.Security.Cryptography;
using System.Text;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Security;

namespace OfficeHub.Modules.LaborContracts.Tests;

/// <summary>TEST-17: Encryption__Key xoay được — keyId trong token, keyring giải mã khoá cũ, vẫn đọc định dạng v1.</summary>
public class KeyRotationTests
{
    private static string NewKey() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));

    /// <summary>Token định dạng cũ "v1:" (trước keyring, không AAD) — như dữ liệu đang có trong DB.</summary>
    private static string LegacyV1(string base64Key, string plain)
    {
        var data = Encoding.UTF8.GetBytes(plain);
        var buf = new byte[12 + data.Length + 16];
        RandomNumberGenerator.Fill(buf.AsSpan(0, 12));
        using var aes = new AesGcm(Convert.FromBase64String(base64Key), 16);
        aes.Encrypt(buf.AsSpan(0, 12), data, buf.AsSpan(12, data.Length), buf.AsSpan(12 + data.Length, 16));
        return "v1:" + Convert.ToBase64String(buf);
    }

    [Fact]
    public void Reads_legacy_v1_with_current_or_previous_key()
    {
        var k1 = NewKey();
        var v1 = LegacyV1(k1, "15000000");
        Assert.Equal("15000000", new AesGcmFieldEncryptor(k1).Decrypt(v1));
        // Đã xoay: k1 nằm trong PreviousKeys → v1 vẫn đọc được
        var rotated = new AesGcmFieldEncryptor(NewKey(), "k2", $"k1:{k1}");
        Assert.Equal("15000000", rotated.Decrypt(v1));
        Assert.False(rotated.IsCurrent(v1));
    }

    [Fact]
    public void Rotation_decrypts_old_and_encrypts_with_new_key()
    {
        var k1 = NewKey();
        var old = new AesGcmFieldEncryptor(k1).Encrypt("0123456789");
        var rotated = new AesGcmFieldEncryptor(NewKey(), "k2", $"k1:{k1}");
        Assert.Equal("0123456789", rotated.Decrypt(old));
        var fresh = rotated.Encrypt(rotated.Decrypt(old));
        Assert.StartsWith("v2:k2:", fresh);
        Assert.True(rotated.IsCurrent(fresh));
        Assert.False(rotated.IsCurrent(old));
        Assert.Equal("v2:k2:", rotated.CurrentPrefix);
    }

    [Fact]
    public void Missing_previous_key_fails_clearly()
    {
        var old = new AesGcmFieldEncryptor(NewKey()).Encrypt("x");
        var ex = Assert.ThrowsAny<CryptographicException>(() => new AesGcmFieldEncryptor(NewKey(), "k2").Decrypt(old));
        Assert.Contains("PreviousKeys", ex.Message);
    }

    [Theory]
    [InlineData("k1:abc")]                     // khoá không đủ 32 byte
    [InlineData("K1:AAAA")]                    // keyId chữ hoa
    [InlineData("nocolon")]
    public void Invalid_previous_keys_are_rejected(string value) => Assert.Null(EncryptionSettings.ParsePrevious(value));

    [Fact]
    public void Valid_previous_keys_and_duplicates()
    {
        var a = NewKey();
        Assert.Equal(2, EncryptionSettings.ParsePrevious($"k1:{a}; k0:{NewKey()}")!.Count);
        Assert.Empty(EncryptionSettings.ParsePrevious(null)!);
        Assert.Throws<InvalidOperationException>(() => new AesGcmFieldEncryptor(NewKey(), "k1", $"k1:{a}")); // trùng keyId hiện hành
        Assert.Throws<InvalidOperationException>(() => new AesGcmFieldEncryptor(NewKey(), "Bad Id"));
    }
}
