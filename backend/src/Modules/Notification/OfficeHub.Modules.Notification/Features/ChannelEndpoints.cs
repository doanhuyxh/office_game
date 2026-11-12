using System.Reflection;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Notification.Domain;
using OfficeHub.Modules.Notification.Infrastructure;

namespace OfficeHub.Modules.Notification.Features;

public sealed record ChannelUseDto(string Key, string Label);

/// <param name="Source">"builtin" (luôn có) · "db" (cấu hình lưu trên trang) · "env" (.env) · "user" (mỗi người tự cài) · "none" (chưa cấu hình).</param>
/// <param name="ConfigGroup">Nhóm ở tab Hệ thống → Cấu hình (s3 / smtp / fcm / telegram) để FE dẫn link; null = không có khung cấu hình chung.</param>
/// <param name="Health">ok · error (lỗi gần nhất mới hơn lần thành công gần nhất, trong 24 giờ) · off (chưa cấu hình / đang tắt).</param>
/// <param name="StatsSince">Số liệu gửi tính từ lúc nào (null = theo dữ liệu lưu trong DB; có giá trị = từ lúc Api khởi động, chỉ trong RAM).</param>
public sealed record ChannelDto(string Key, string Name, string Description, bool Configured, bool Enabled, string Source, string? ConfigGroup,
    string Health, IReadOnlyList<ChannelUseDto> UsedBy, DateTimeOffset? LastSuccessAt, DateTimeOffset? LastFailureAt, string? LastError, string? Detail,
    DateTimeOffset? StatsSince = null);

/// <summary>
/// Một kênh thông báo (TEST-43). Thêm kênh mới: cài interface này trong module Notification + đăng ký ở <see cref="NotificationModule"/>
/// → trang Hệ thống → Kênh thông báo tự có (FE chỉ hiển thị). KHÔNG BAO GIỜ trả giá trị bí mật.
/// </summary>
internal interface INotificationChannel
{
    int Order { get; }
    Task<ChannelDto> DescribeAsync(CancellationToken ct);
}

/// <summary>Nhãn tiếng Việt của loại thông báo (<see cref="NotificationCategories"/>) — test bắt buộc mỗi hằng có nhãn.</summary>
internal static class ChannelLabels
{
    public static readonly IReadOnlyDictionary<string, string> Categories = new Dictionary<string, string>
    {
        [NotificationCategories.ApprovalRequested] = "Có đơn chờ duyệt",
        [NotificationCategories.ApprovalApproved] = "Đơn được duyệt",
        [NotificationCategories.ApprovalRejected] = "Đơn bị từ chối",
        [NotificationCategories.ApprovalCancelled] = "Đơn bị huỷ",
        [NotificationCategories.ApprovalDelegation] = "Uỷ quyền duyệt",
        [NotificationCategories.ContractExpiring] = "Hợp đồng sắp hết hạn",
        [NotificationCategories.ProbationEnding] = "Sắp hết thử việc",
        [NotificationCategories.MeetingInvited] = "Mời họp",
        [NotificationCategories.MeetingCancelled] = "Huỷ họp",
        [NotificationCategories.AttendanceReminder] = "Nhắc chấm công",
        [NotificationCategories.PayslipReady] = "Phiếu lương",
        [NotificationCategories.ContractSignRequested] = "Chờ ký hợp đồng",
        [NotificationCategories.ContractSigned] = "Đã ký hợp đồng",
        [NotificationCategories.ProfileChangeRequested] = "Đề nghị sửa hồ sơ",
        [NotificationCategories.ProfileChangeApproved] = "Hồ sơ được duyệt",
        [NotificationCategories.ProfileChangeRejected] = "Hồ sơ bị từ chối",
        [NotificationCategories.DocumentRetention] = "Hạn lưu trữ tài liệu",
        [NotificationCategories.DocumentHandover] = "Bàn giao tài liệu",
        [NotificationCategories.ProjectMemberAdded] = "Thêm vào dự án",
        [NotificationCategories.AccountSecurity] = "Bảo mật tài khoản",
        [NotificationCategories.NewsPublished] = "Bài viết mới",
        [NotificationCategories.NewsComment] = "Bình luận bảng tin",
        [NotificationCategories.NewsMention] = "Được nhắc tên",
        [NotificationCategories.NewsModerated] = "Bài bị ẩn",
        [NotificationCategories.AssetAssigned] = "Được cấp tài sản",
        [NotificationCategories.AssetReturned] = "Thu hồi tài sản",
        [NotificationCategories.AssetExpiring] = "Tài sản sắp hết hạn",
        [NotificationCategories.AssetOffboarding] = "Nghỉ việc còn giữ tài sản",
        [NotificationCategories.AssetReview] = "Rà soát quyền dịch vụ",
        [NotificationCategories.SocialPost] = "Đăng bài mạng xã hội",
        [NotificationCategories.ExpenseReady] = "Đề nghị chi chờ chi",
        [NotificationCategories.ExpensePaid] = "Đã chi tiền",
        [NotificationCategories.ReceivableDue] = "Đợt thu đến hạn",
        [NotificationCategories.CustomerFollowUp] = "Chăm sóc khách hàng",
        [NotificationCategories.ProjectTask] = "Việc dự án",
        [NotificationCategories.ChangeRequestApproved] = "Yêu cầu thay đổi được duyệt",
        [NotificationCategories.AiAlert] = "Cảnh báo trợ lý AI",
    };

    /// <summary>Mọi hằng category khai báo trong <see cref="NotificationCategories"/>.</summary>
    public static IReadOnlyList<string> AllCategoryKeys { get; } = [.. typeof(NotificationCategories)
        .GetFields(BindingFlags.Public | BindingFlags.Static).Where(f => f.IsLiteral && f.FieldType == typeof(string)).Select(f => (string)f.GetRawConstantValue()!)];

    public static ChannelUseDto Use(string key) => new(key, Categories.GetValueOrDefault(key) ?? key);
    public static IReadOnlyList<ChannelUseDto> AllCategories() => [.. AllCategoryKeys.Select(Use)];

    /// <param name="configChangedAt">Lần lưu cấu hình gần nhất: lỗi xảy ra trước đó (cấu hình cũ) không tính.</param>
    public static string Health(bool configured, bool enabled, DateTimeOffset? lastOk, DateTimeOffset? lastFail, DateTimeOffset now, bool initError = false,
        DateTimeOffset? configChangedAt = null)
    {
        if (!configured || !enabled) return "off";
        if (initError) return "error";
        return lastFail is { } f && f > (lastOk ?? DateTimeOffset.MinValue) && f > (configChangedAt ?? DateTimeOffset.MinValue) && now - f < TimeSpan.FromHours(24)
            ? "error" : "ok";
    }
}

internal sealed class BellChannel(NotificationDbContext db) : INotificationChannel
{
    public int Order => 0;

    public async Task<ChannelDto> DescribeAsync(CancellationToken ct)
    {
        var last = await db.Notifications.AsNoTracking().MaxAsync(n => (DateTimeOffset?)n.CreatedAt, ct);
        return new("bell", "Chuông trong ứng dụng", "Thông báo hiện ở biểu tượng chuông và trang Thông báo; luôn bật, mọi loại thông báo đều đi qua kênh này.",
            true, true, "builtin", null, "ok", ChannelLabels.AllCategories(), last, null, null, null);
    }
}

internal sealed class EmailChannel(NotificationDbContext db, RuntimeConfig runtime, TimeProvider clock) : INotificationChannel
{
    public int Order => 1;

    public async Task<ChannelDto> DescribeAsync(CancellationToken ct)
    {
        var smtp = runtime.Smtp;
        var configured = !string.IsNullOrWhiteSpace(smtp.Host) && !string.IsNullOrWhiteSpace(smtp.FromEmail);
        var q = db.Notifications.AsNoTracking();
        var lastOk = await q.MaxAsync(n => n.EmailSentAt, ct);
        var lastFail = await q.Where(n => n.EmailError != null).OrderByDescending(n => n.CreatedAt).Select(n => new { n.CreatedAt, n.EmailError }).FirstOrDefaultAsync(ct);
        var since = clock.GetUtcNow().AddDays(-30);
        var used = await q.Where(n => n.CreatedAt >= since && n.EmailStatus != EmailStatus.None).Select(n => n.Category).Distinct().ToListAsync(ct);
        var pending = await q.CountAsync(n => n.EmailStatus == EmailStatus.Pending, ct);
        var failed = await q.CountAsync(n => n.EmailStatus == EmailStatus.Failed && n.CreatedAt >= since, ct);
        return new("email", "Email (SMTP)",
            "Gửi kèm chuông khi nơi gửi chọn gửi email (người nhận tắt được ở hồ sơ). Hàng đợi trong DB, tự thử lại. Thư mời / quên mật khẩu gửi trực tiếp, không tính ở đây.",
            configured, configured, runtime.Stored(SettingsGroups.Smtp) is null ? "env" : "db", SettingsGroups.Smtp,
            ChannelLabels.Health(configured, configured, lastOk, lastFail?.CreatedAt, clock.GetUtcNow(),
                configChangedAt: runtime.Stored(SettingsGroups.Smtp)?.UpdatedAt),
            [.. used.Order().Select(ChannelLabels.Use)], lastOk, lastFail?.CreatedAt, lastFail?.EmailError,
            $"{smtp.Host}:{smtp.Port} · {pending} thư chờ gửi · {failed} thư lỗi (30 ngày)");
    }
}

internal sealed class PushChannel(NotificationDbContext db, RuntimeConfig runtime, FirebaseProvider firebase, TimeProvider clock) : INotificationChannel
{
    public int Order => 2;

    public async Task<ChannelDto> DescribeAsync(CancellationToken ct)
    {
        var fcm = runtime.Fcm;
        var (_, initError) = firebase.Get();
        var s = firebase.Stats;
        var devices = await db.PushTokens.AsNoTracking().CountAsync(ct);
        List<ChannelUseDto> used = [.. ChannelLabels.AllCategories(), new("chat_direct", "Tin nhắn 1-1"), new("chat_room", "Tin nhắn kênh phòng")];
        return new("push", "Thông báo đẩy (FCM)",
            "Đẩy tới trình duyệt / điện thoại đã bật \"thông báo đẩy\" cho mọi thông báo chuông + tin nhắn 1-1 / kênh phòng. Trống cấu hình = tắt, chuông / email vẫn chạy.",
            fcm.Enabled, fcm.Enabled && initError is null, runtime.Stored(SettingsGroups.Fcm) is null ? (fcm.Enabled ? "env" : "none") : "db", SettingsGroups.Fcm,
            ChannelLabels.Health(fcm.Enabled, fcm.Enabled, s.LastSuccessAt, s.LastFailureAt, clock.GetUtcNow(), initError is not null,
                runtime.Stored(SettingsGroups.Fcm)?.UpdatedAt),
            used, s.LastSuccessAt, s.LastFailureAt, initError is not null ? $"Không khởi tạo được Firebase: {initError}" : s.LastError,
            $"{devices} thiết bị đã đăng ký", s.Since);
    }
}

internal sealed class WebhookChannel(NotificationDbContext db, TimeProvider clock) : INotificationChannel
{
    public int Order => 3;

    public async Task<ChannelDto> DescribeAsync(CancellationToken ct)
    {
        var total = await db.Webhooks.AsNoTracking().CountAsync(ct);
        var enabled = await db.Webhooks.AsNoTracking().CountAsync(w => w.Enabled, ct);
        var d = db.WebhookDeliveries.AsNoTracking();
        var lastOk = await d.MaxAsync(x => x.SentAt, ct);
        var lastFail = await d.Where(x => x.Error != null).OrderByDescending(x => x.CreatedAt).Select(x => new { x.CreatedAt, x.Error }).FirstOrDefaultAsync(ct);
        var pending = await d.CountAsync(x => x.Status == WebhookStatus.Pending, ct);
        return new("webhook", "Webhook trợ lý AI",
            "Mỗi người tự cài ở trang Kết nối AI: đẩy thông báo + tin nhắn 1-1 tới agent của mình (ký HMAC, thử lại).",
            total > 0, enabled > 0, "user", null,
            ChannelLabels.Health(total > 0, enabled > 0, lastOk, lastFail?.CreatedAt, clock.GetUtcNow()),
            [new("notification", "Mọi thông báo chuông của người cài"), new("chat.message", "Tin nhắn 1-1")], lastOk, lastFail?.CreatedAt, lastFail?.Error,
            $"{enabled}/{total} webhook đang bật · {pending} sự kiện chờ gửi");
    }
}

internal sealed class TelegramChannel(NotificationDbContext db, RuntimeConfig runtime, TimeProvider clock) : INotificationChannel
{
    public int Order => 4;

    public async Task<ChannelDto> DescribeAsync(CancellationToken ct)
    {
        var tg = runtime.Telegram;
        var configured = !string.IsNullOrWhiteSpace(tg.ChatId) && !string.IsNullOrWhiteSpace(tg.BotToken);
        var m = db.TelegramMessages.AsNoTracking();
        var lastOk = await m.MaxAsync(x => x.SentAt, ct);
        var lastFail = await m.Where(x => x.Error != null).OrderByDescending(x => x.CreatedAt).Select(x => new { x.CreatedAt, x.Error }).FirstOrDefaultAsync(ct);
        var pending = await m.CountAsync(x => x.Status == TelegramStatus.Pending, ct);
        return new("telegram", "Telegram (đánh thức agent)",
            "Giao việc cho tài khoản bot có \"Bot Telegram\" → một tin vào nhóm Telegram để bộ điều phối trên máy agent bắt đầu làm.",
            configured, tg.Ready, runtime.Stored(SettingsGroups.Telegram) is null ? "none" : "db", SettingsGroups.Telegram,
            ChannelLabels.Health(configured, tg.Ready, lastOk, lastFail?.CreatedAt, clock.GetUtcNow(),
                configChangedAt: runtime.Stored(SettingsGroups.Telegram)?.UpdatedAt),
            [new("task_assigned", "Giao việc cho tài khoản bot")], lastOk, lastFail?.CreatedAt, lastFail?.Error,
            configured ? $"Chat {tg.ChatId} · {pending} tin chờ gửi" : null);
    }
}

/// <summary>GET /api/system/notification-channels — chỉ admin, ngoài allowlist token AI (TEST-43).</summary>
internal static class ChannelEndpoints
{
    public static void Map(RouteGroupBuilder g) => g.MapGet("/", ListAsync);

    private static async Task<Ok<List<ChannelDto>>> ListAsync(IEnumerable<INotificationChannel> channels, CancellationToken ct)
    {
        var list = new List<ChannelDto>();
        foreach (var c in channels.OrderBy(c => c.Order)) list.Add(await c.DescribeAsync(ct)); // cùng DbContext → tuần tự
        return TypedResults.Ok(list);
    }
}
