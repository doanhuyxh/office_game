using OfficeHub.Modules.LaborContracts.Domain;

namespace OfficeHub.Modules.LaborContracts.Tests;

public class SignRulesTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 6, 3, 0, 0, TimeSpan.Zero);
    private static SignRequest Req() => new() { Status = SignStatus.Pending, ExpiresAt = Now.AddDays(7) };

    [Fact]
    public void Otp_is_six_digits_and_bound_to_request()
    {
        var otp = SignRules.NewOtp();
        Assert.Matches("^[0-9]{6}$", otp);
        var a = Req(); var b = Req();
        a.OtpHash = SignRules.HashOtp(a.Id, otp); a.OtpExpiresAt = Now.AddMinutes(10);
        b.OtpHash = SignRules.HashOtp(b.Id, otp); b.OtpExpiresAt = Now.AddMinutes(10);
        Assert.NotEqual(a.OtpHash, b.OtpHash);                    // cùng mã, khác yêu cầu → hash khác
        Assert.True(SignRules.OtpMatches(a, otp, Now));
        Assert.False(SignRules.OtpMatches(a, otp == "000000" ? "111111" : "000000", Now));
        Assert.False(SignRules.OtpMatches(a, otp, Now.AddMinutes(11)));   // hết hạn
        Assert.False(SignRules.OtpMatches(a, "12345", Now));              // sai độ dài
        Assert.False(SignRules.OtpMatches(Req(), otp, Now));               // chưa gửi mã
    }

    [Fact]
    public void Otp_send_limits()
    {
        var r = Req();
        Assert.Null(SignRules.CannotSendOtp(r, Now));
        r.OtpSentAt = Now.AddSeconds(-20);
        Assert.Contains("40 giây", SignRules.CannotSendOtp(r, Now));
        r.OtpSentAt = Now.AddMinutes(-2); r.OtpSends = SignRules.MaxOtpSends;
        Assert.Contains("quá số lần", SignRules.CannotSendOtp(r, Now));
        var expired = Req();
        expired.ExpiresAt = Now.AddSeconds(-1);
        Assert.Contains("hết hạn", SignRules.CannotSendOtp(expired, Now));
        Assert.Contains("không còn hiệu lực", SignRules.CannotSendOtp(new SignRequest { Status = SignStatus.Signed, ExpiresAt = Now.AddDays(1) }, Now));
    }

    [Fact]
    public void Signature_must_be_png_data_url_within_size()
    {
        var png = new byte[200];
        new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }.CopyTo(png, 0);
        Assert.NotNull(SignRules.ParseSignaturePng("data:image/png;base64," + Convert.ToBase64String(png)));
        Assert.Null(SignRules.ParseSignaturePng("data:image/jpeg;base64," + Convert.ToBase64String(png)));
        Assert.Null(SignRules.ParseSignaturePng("data:image/png;base64," + Convert.ToBase64String(new byte[200])));   // không phải PNG
        Assert.Null(SignRules.ParseSignaturePng("data:image/png;base64,@@@"));
        Assert.Null(SignRules.ParseSignaturePng(null));
        var big = new byte[SignRules.MaxSignatureBytes + 1];
        png.AsSpan(0, 8).CopyTo(big);
        Assert.Null(SignRules.ParseSignaturePng("data:image/png;base64," + Convert.ToBase64String(big)));
    }
}
