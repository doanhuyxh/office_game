using System.Security.Cryptography;
using OfficeHub.BuildingBlocks.Security;
using OfficeHub.Modules.LaborContracts.Domain;

namespace OfficeHub.Modules.LaborContracts.Tests;

public class ContractRulesTests
{
    private static readonly DateOnly Start = new(2026, 1, 1);
    private static DateOnly D(int y, int m, int d) => new(y, m, d);

    [Fact]
    public void Indefinite_has_no_end() =>
        Assert.Contains(ContractRules.ValidateTerm(ContractType.Indefinite, Start, D(2027, 1, 1)), e => e.Field == "endDate");

    [Fact]
    public void Fixed_needs_end_and_max_36_months()
    {
        Assert.Contains(ContractRules.ValidateTerm(ContractType.Fixed, Start, null), e => e.Message.Contains("cần ngày kết thúc"));
        Assert.Empty(ContractRules.ValidateTerm(ContractType.Fixed, Start, D(2028, 12, 31)));         // đúng 36 tháng
        Assert.Contains(ContractRules.ValidateTerm(ContractType.Fixed, Start, D(2029, 1, 1)), e => e.Message.Contains("36 tháng"));
        Assert.Contains(ContractRules.ValidateTerm(ContractType.Fixed, Start, Start), e => e.Message.Contains("sau ngày bắt đầu"));
    }

    [Fact]
    public void Number_format_by_type()
    {
        Assert.Equal("001/2026/HĐLĐ", ContractRules.FormatNumber(1, 2026, ContractType.Fixed));
        Assert.Equal("012/2026/HĐLĐ", ContractRules.FormatNumber(12, 2026, ContractType.Indefinite));
        Assert.Equal("1234/2026/HĐTV", ContractRules.FormatNumber(1234, 2026, ContractType.Probation));
    }

    [Fact]
    public void Next_seq_per_year_ignores_other_formats()
    {
        Assert.Equal(1, ContractRules.NextSeq([], 2026));
        Assert.Equal(13, ContractRules.NextSeq(["012/2026/HĐLĐ", "003/2026/HĐTV", "099/2025/HĐLĐ", "E2E-TV-01", "HD/2026/7"], 2026)); // STT chung mọi loại, năm khác / dạng khác bỏ qua
        Assert.Equal(100, ContractRules.NextSeq(["99/2026/HĐLĐ"], 2026));
    }

    [Fact]
    public void Probation_max_180_days()
    {
        Assert.Empty(ContractRules.ValidateTerm(ContractType.Probation, Start, Start.AddDays(179)));   // 180 ngày tính cả ngày đầu
        Assert.Contains(ContractRules.ValidateTerm(ContractType.Probation, Start, Start.AddDays(180)), e => e.Message.Contains("180 ngày"));
    }

    [Theory]
    [InlineData("2025-12-31", null, null, "Upcoming")]
    [InlineData("2026-03-01", "2026-06-30", null, "Active")]
    [InlineData("2026-03-01", null, null, "Active")]            // vô thời hạn
    [InlineData("2026-06-30", "2026-06-30", null, "Active")]    // ngày cuối vẫn hiệu lực
    [InlineData("2026-07-01", "2026-06-30", null, "Expired")]
    [InlineData("2026-02-01", "2026-06-30", "2026-03-01", "Terminated")]
    public void Status_by_today(string today, string? end, string? terminated, string expected) =>
        Assert.Equal(expected, ContractRules.Status(Start, end is null ? null : DateOnly.Parse(end),
            terminated is null ? null : DateOnly.Parse(terminated), DateOnly.Parse(today)).ToString());

    [Fact]
    public void Overlap_uses_open_end()
    {
        Assert.True(ContractRules.Overlaps(Start, null, D(2030, 1, 1), D(2030, 6, 1)));
        Assert.False(ContractRules.Overlaps(Start, D(2026, 6, 30), D(2026, 7, 1), null));
        Assert.True(ContractRules.Overlaps(Start, D(2026, 6, 30), D(2026, 6, 30), null));
        Assert.Equal(D(2026, 3, 1), ContractRules.EffectiveEnd(D(2026, 6, 30), D(2026, 3, 1)));
    }

    [Theory]
    [InlineData(40, false, false, null)]
    [InlineData(30, false, false, ReminderKind.Days30)]
    [InlineData(20, true, false, null)]
    [InlineData(7, true, false, ReminderKind.Days7)]
    [InlineData(5, false, false, ReminderKind.Days7)]   // tạo khi còn ≤ 7 ngày: chỉ nhắc 7
    [InlineData(0, true, false, ReminderKind.Days7)]    // hết hạn hôm nay
    [InlineData(3, true, true, null)]
    [InlineData(-1, false, false, null)]                // đã hết hạn
    public void Reminder_due(int daysLeft, bool r30, bool r7, ReminderKind? expected)
    {
        var today = D(2026, 11, 5);
        Assert.Equal(expected, ContractRules.DueReminder(today.AddDays(daysLeft), today, r30, r7));
    }

    [Fact]
    public void Effective_salary_follows_latest_amendment()
    {
        (DateOnly, decimal?)[] a = [(D(2026, 4, 1), 15_000_000m), (D(2026, 6, 1), null), (D(2026, 9, 1), 18_000_000m)];
        Assert.Equal(12_000_000m, ContractRules.EffectiveValue(12_000_000m, a, D(2026, 3, 31)));
        Assert.Equal(15_000_000m, ContractRules.EffectiveValue(12_000_000m, a, D(2026, 8, 31)));
        Assert.Equal(18_000_000m, ContractRules.EffectiveValue(12_000_000m, a, D(2026, 9, 1)));
        Assert.Null(ContractRules.EffectiveValue(null, [], D(2026, 9, 1)));
    }
}

public class FieldEncryptorTests
{
    private static readonly string Key = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));

    [Fact]
    public void Roundtrip_and_random_nonce()
    {
        IFieldEncryptor enc = new AesGcmFieldEncryptor(Key);
        var a = enc.EncryptDecimal(12_345_678.90m)!;
        var b = enc.EncryptDecimal(12_345_678.90m)!;
        Assert.StartsWith("v1:", a);
        Assert.NotEqual(a, b);                       // cùng giá trị → chuỗi khác (không đoán được lương bằng so sánh)
        Assert.DoesNotContain("12345678", a);
        Assert.Equal(12_345_678.90m, enc.DecryptDecimal(a));
        Assert.Null(enc.EncryptDecimal(null));
        Assert.Null(enc.DecryptDecimal(null));
    }

    [Fact]
    public void Wrong_key_or_tampered_fails()
    {
        IFieldEncryptor enc = new AesGcmFieldEncryptor(Key);
        var token = enc.Encrypt("15000000");
        var other = new AesGcmFieldEncryptor(Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)));
        Assert.ThrowsAny<CryptographicException>(() => other.Decrypt(token));
        var bytes = Convert.FromBase64String(token[3..]);
        bytes[^1] ^= 1;
        Assert.ThrowsAny<CryptographicException>(() => enc.Decrypt("v1:" + Convert.ToBase64String(bytes)));
    }

    [Theory]
    [InlineData("")]
    [InlineData("không-phải-base64")]
    [InlineData("AAAA")] // 3 byte
    public void Invalid_key_rejected(string key) => Assert.Throws<InvalidOperationException>(() => new AesGcmFieldEncryptor(key));
}
