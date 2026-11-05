using OfficeHub.Modules.Notification.Domain;

namespace OfficeHub.Modules.Notification.Tests;

public class EmailPolicyTests
{
    [Theory]
    [InlineData("nhanvien@gmail.com", true)]
    [InlineData("a.b@company.vn", true)]
    [InlineData("giamdoc@officehub.test", false)]  // tài khoản thử nghiệm
    [InlineData("admin@example.com", false)]       // admin seed mặc định
    [InlineData("x@mail.example.org", false)]
    [InlineData("x@host.invalid", false)]
    [InlineData("x@pc.local", false)]
    [InlineData("x@localhost", false)]
    [InlineData("khong-co-a-cong", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void Deliverable_only_for_real_domains(string? email, bool expected) =>
        Assert.Equal(expected, EmailPolicy.IsDeliverable(email));

    [Fact]
    public void Retry_backoff_then_give_up()
    {
        var now = new DateTimeOffset(2026, 11, 5, 10, 0, 0, TimeSpan.Zero);
        Assert.Equal(now.AddMinutes(1), EmailPolicy.NextAttempt(1, now));
        Assert.Equal(now.AddMinutes(5), EmailPolicy.NextAttempt(2, now));
        Assert.Equal(now.AddMinutes(15), EmailPolicy.NextAttempt(3, now));
        Assert.Equal(now.AddMinutes(60), EmailPolicy.NextAttempt(4, now));
        Assert.Null(EmailPolicy.NextAttempt(EmailPolicy.MaxAttempts, now));
    }
}
