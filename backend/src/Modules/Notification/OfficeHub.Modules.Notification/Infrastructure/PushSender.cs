using FirebaseAdmin;
using FirebaseAdmin.Messaging;
using Google.Apis.Auth.OAuth2;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.Modules.Notification.Contracts;
using FbNotification = FirebaseAdmin.Messaging.Notification;

namespace OfficeHub.Modules.Notification.Infrastructure;

/// <summary>Firebase Cloud Messaging — tuỳ chọn, trống <see cref="CredentialsPath"/> thì tắt push (không ảnh hưởng chuông / email).</summary>
public sealed class FirebaseSettings
{
    public const string Section = "Firebase";
    /// <summary>Đường dẫn file service-account JSON (tải từ Firebase Console, không commit — xem env.md).</summary>
    public string? CredentialsPath { get; set; }
    public bool Enabled => !string.IsNullOrWhiteSpace(CredentialsPath);
}

/// <summary>
/// Gửi push qua FCM tới các thiết bị đã đăng ký (<see cref="Domain.PushToken"/>). Best-effort: lỗi SDK/mạng chỉ log, không ném;
/// token bị FCM báo không còn tồn tại thì xoá luôn. Không khởi tạo Firebase nếu <see cref="FirebaseSettings.Enabled"/> = false.
/// </summary>
internal sealed class PushSender : IPushSender
{
    private readonly NotificationDbContext _db;
    private readonly ILogger<PushSender> _log;
    private readonly FirebaseMessaging? _messaging;

    public PushSender(NotificationDbContext db, IOptions<FirebaseSettings> options, IHostEnvironment env, ILogger<PushSender> log)
    {
        _db = db;
        _log = log;
        if (!options.Value.Enabled) return;
        try
        {
            var path = EnvLoader.ResolvePath(options.Value.CredentialsPath!, env.ContentRootPath);
            var app = FirebaseApp.DefaultInstance ?? FirebaseApp.Create(new AppOptions
            {
                Credential = CredentialFactory.FromFile<ServiceAccountCredential>(path).ToGoogleCredential(),
            });
            _messaging = FirebaseMessaging.GetMessaging(app);
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Không khởi tạo được Firebase — kiểm tra Firebase__CredentialsPath; push bị tắt cho tới khi khởi động lại");
        }
    }

    public async Task PushAsync(IEnumerable<Guid> recipientUserIds, string title, string body, string? link, CancellationToken ct = default)
    {
        if (_messaging is null) return;
        var ids = recipientUserIds.Distinct().ToList();
        if (ids.Count == 0) return;

        var tokens = await _db.PushTokens.Where(t => ids.Contains(t.UserId)).Select(t => t.Token).ToListAsync(ct);
        if (tokens.Count == 0) return;

        const int batchSize = 500; // giới hạn multicast của FCM
        for (var i = 0; i < tokens.Count; i += batchSize)
        {
            var batch = tokens.GetRange(i, Math.Min(batchSize, tokens.Count - i));
            await SendBatchAsync(batch, title, body, link, ct);
        }
    }

    private async Task SendBatchAsync(List<string> batch, string title, string body, string? link, CancellationToken ct)
    {
        // Tokens (không phải Fids — FID là Firebase Installation ID, khác khái niệm với registration token mà web FCM trả về) bị đánh [Obsolete]
        // nhưng vẫn là API đúng cho token từ getToken() ở trình duyệt.
#pragma warning disable CS0618
        var message = new MulticastMessage
        {
            Tokens = batch,
            Notification = new FbNotification { Title = title, Body = body },
            Data = link is null ? null : new Dictionary<string, string> { ["link"] = link },
        };
#pragma warning restore CS0618
        try
        {
            var result = await _messaging!.SendEachForMulticastAsync(message, ct);
            var dead = new List<string>();
            for (var i = 0; i < result.Responses.Count; i++)
            {
                var r = result.Responses[i];
                if (!r.IsSuccess && r.Exception is FirebaseMessagingException { MessagingErrorCode: MessagingErrorCode.Unregistered or MessagingErrorCode.InvalidArgument })
                    dead.Add(batch[i]);
            }
            if (dead.Count > 0)
                await _db.PushTokens.Where(t => dead.Contains(t.Token)).ExecuteDeleteAsync(ct);
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            _log.LogWarning(ex, "Gửi FCM push lỗi ({Count} thiết bị)", batch.Count);
        }
    }
}
