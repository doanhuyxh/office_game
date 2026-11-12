using FirebaseAdmin;
using FirebaseAdmin.Messaging;
using Google.Apis.Auth.OAuth2;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.Modules.Notification.Contracts;
using FbNotification = FirebaseAdmin.Messaging.Notification;

namespace OfficeHub.Modules.Notification.Infrastructure;

/// <summary>
/// FirebaseMessaging theo cấu hình FCM đang có hiệu lực (<see cref="RuntimeConfig.Fcm"/>: DB, chưa có thì <c>Firebase__CredentialsPath</c>).
/// Cấu hình đổi → tạo FirebaseApp mới (tên riêng), xoá app cũ. Lỗi khởi tạo → log một lần cho mỗi cấu hình, push tắt tới khi sửa cấu hình.
/// </summary>
internal sealed class FirebaseProvider(RuntimeConfig config, TimeProvider clock, ILogger<FirebaseProvider> log)
{
    /// <summary>Lần gửi push thành công / lỗi gần nhất (RAM, tính từ lúc Api khởi động) — trang Hệ thống → Kênh thông báo (TEST-43).</summary>
    public sealed record PushStats(DateTimeOffset Since, DateTimeOffset? LastSuccessAt, DateTimeOffset? LastFailureAt, string? LastError);
    private PushStats _stats = new(clock.GetUtcNow(), null, null, null);
    public PushStats Stats => _stats;
    public void RecordSuccess() => _stats = _stats with { LastSuccessAt = clock.GetUtcNow() };
    public void RecordFailure(string error) => _stats = _stats with { LastFailureAt = clock.GetUtcNow(), LastError = error.Length > 500 ? error[..500] : error };

    private readonly Lock _gate = new();
    private FcmSettings? _settings;
    private FirebaseApp? _app;
    private FirebaseMessaging? _messaging;
    private string? _error;
    private int _seq;

    /// <summary>(messaging, lỗi khởi tạo). Cả hai null = chưa cấu hình FCM.</summary>
    public (FirebaseMessaging? Messaging, string? Error) Get()
    {
        var cfg = config.Fcm;
        lock (_gate)
        {
            if (ReferenceEquals(cfg, _settings)) return (_messaging, _error);
            _app?.Delete();
            (_settings, _app, _messaging, _error) = (cfg, null, null, null);
            if (!cfg.Enabled) return (null, null);
            try
            {
                var credential = cfg.ServiceAccountJson is { Length: > 0 } json
                    ? CredentialFactory.FromJson<ServiceAccountCredential>(json)
                    : CredentialFactory.FromFile<ServiceAccountCredential>(cfg.CredentialsPath!);
                _app = FirebaseApp.Create(new AppOptions
                {
                    Credential = credential.ToGoogleCredential(),
                    ProjectId = string.IsNullOrWhiteSpace(cfg.ProjectId) ? null : cfg.ProjectId,
                }, $"officehub-{++_seq}");
                _messaging = FirebaseMessaging.GetMessaging(_app);
            }
            catch (Exception ex)
            {
                _error = ex.Message;
                log.LogError(ex, "Không khởi tạo được Firebase — kiểm tra cấu hình FCM (trang Hệ thống → Cấu hình / Firebase__CredentialsPath); push bị tắt");
            }
            return (_messaging, _error);
        }
    }
}

/// <summary>
/// Gửi push qua FCM tới các thiết bị đã đăng ký (<see cref="Domain.PushToken"/>). Best-effort: lỗi SDK/mạng chỉ log, không ném;
/// token bị FCM báo không còn tồn tại thì xoá luôn. Chưa cấu hình FCM → không làm gì.
/// </summary>
internal sealed class PushSender(NotificationDbContext db, FirebaseProvider firebase, ILogger<PushSender> log) : IPushSender
{
    private readonly NotificationDbContext _db = db;
    private readonly ILogger<PushSender> _log = log;
    private FirebaseMessaging? _messaging;

    public async Task<(bool Ok, string Message)> DryRunAsync(CancellationToken ct = default)
    {
        var (messaging, error) = firebase.Get();
        if (messaging is null) return (false, error is null ? "Chưa cấu hình FCM" : $"Không khởi tạo được Firebase: {error}");
        try
        {
            var id = await messaging.SendAsync(new Message
            {
                Topic = "officehub-config-check",
                Notification = new FbNotification { Title = "OfficeHub", Body = "Kiểm tra cấu hình FCM" },
            }, dryRun: true, ct);
            return (true, $"FCM chấp nhận tin thử (dry run, không gửi tới thiết bị nào): {id}");
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            return (false, $"FCM từ chối: {ex.Message}");
        }
    }

    public async Task PushAsync(IEnumerable<Guid> recipientUserIds, string title, string body, string? link, CancellationToken ct = default)
    {
        _messaging = firebase.Get().Messaging;
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
            if (result.SuccessCount > 0) firebase.RecordSuccess();
            if (result.FailureCount > 0 && result.Responses.FirstOrDefault(r => !r.IsSuccess)?.Exception is { } fx) firebase.RecordFailure(fx.Message);
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
            firebase.RecordFailure(ex.Message);
        }
    }
}
