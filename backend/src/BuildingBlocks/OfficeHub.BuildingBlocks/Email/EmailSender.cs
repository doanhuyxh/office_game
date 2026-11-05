using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Options;
using MimeKit;
using OfficeHub.BuildingBlocks.Configuration;

namespace OfficeHub.BuildingBlocks.Email;

public interface IEmailSender
{
    Task SendAsync(string toEmail, string toName, string subject, string htmlBody, CancellationToken ct = default);
}

public sealed class SmtpEmailSender(IOptions<SmtpSettings> options) : IEmailSender
{
    public static readonly TimeSpan SendTimeout = TimeSpan.FromSeconds(15);

    private readonly SmtpSettings _cfg = options.Value;

    public async Task SendAsync(string toEmail, string toName, string subject, string htmlBody, CancellationToken ct = default)
    {
        var msg = new MimeMessage();
        msg.From.Add(new MailboxAddress(_cfg.FromName, _cfg.FromEmail));
        msg.To.Add(new MailboxAddress(toName, toEmail));
        msg.Subject = subject;
        msg.Body = new BodyBuilder { HtmlBody = htmlBody }.ToMessageBody();

        // Giới hạn tổng thời gian: SMTP sai cấu hình có thể treo kết nối > 1 phút → người dùng chờ vô ích.
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(SendTimeout);
        using var client = new SmtpClient
        {
            Timeout = (int)SendTimeout.TotalMilliseconds,
            CheckCertificateRevocation = _cfg.CheckCertificateRevocation, // mặc định true — xem SmtpSettings
        };
        var security = _cfg.UseSsl ? SecureSocketOptions.SslOnConnect : SecureSocketOptions.StartTlsWhenAvailable;
        await client.ConnectAsync(_cfg.Host, _cfg.Port, security, timeout.Token);
        if (!string.IsNullOrEmpty(_cfg.Username))
            await client.AuthenticateAsync(_cfg.Username, _cfg.Password ?? "", timeout.Token);
        await client.SendAsync(msg, timeout.Token);
        await client.DisconnectAsync(true, timeout.Token);
    }
}
