using System.Reflection;
using OfficeHub.Modules.Notification.Contracts;

namespace OfficeHub.Modules.Notification.Features;

/// <summary>Email của một sự kiện: không gửi · gửi (người nhận tắt được ở hồ sơ) · tuỳ trường hợp (xem ghi chú) · luôn gửi kể cả khi đã tắt.</summary>
internal enum EmailMode { None, Optional, Conditional, Always }

/// <summary>Một sự kiện thông báo trong <see cref="NotificationCatalog"/>.</summary>
/// <param name="Key">Mã sự kiện "nhóm.tên" (vd project.task_assigned) — duy nhất.</param>
/// <param name="Category">Hằng <see cref="NotificationCategories"/> khi sự kiện đi qua chuông (→ kèm push + webhook "notification"); null = không có chuông (vd tin nhắn).</param>
/// <param name="EmailNote">Khi nào có email (bắt buộc với <see cref="EmailMode.Conditional"/>).</param>
/// <param name="Telegram">Tên phương thức <see cref="ITelegramWakeup"/> gửi kèm (null = không có Telegram).</param>
/// <param name="Push">Có push riêng ngoài chuông (tin nhắn).</param>
/// <param name="WebhookEvent">Sự kiện webhook riêng ngoài "notification" (<see cref="WebhookEvents"/>).</param>
internal sealed record NotificationEvent(string Key, string Group, string Title, string Description, string? Category,
    EmailMode Email = EmailMode.None, string? EmailNote = null, string? Telegram = null, bool Push = false, string? WebhookEvent = null);

public sealed record EventChannelDto(string Channel, string? Note);
public sealed record NotificationEventDto(string Key, string Title, string Description, string? Category, IReadOnlyList<EventChannelDto> Channels);
public sealed record NotificationEventGroupDto(string Key, string Name, IReadOnlyList<NotificationEventDto> Events);

/// <summary>
/// Danh mục DUY NHẤT các sự kiện thông báo + kênh gửi (TEST-59) — trang Hệ thống → Kênh thông báo hiển thị từ đây (cả chip "Dùng cho").
/// Thêm / xoá hằng <see cref="NotificationCategories"/>, phương thức <see cref="ITelegramWakeup"/> hay <see cref="WebhookEvents"/> → sửa danh mục này
/// trong cùng commit; NotificationCatalogTests fail nếu lệch với code.
/// </summary>
internal static class NotificationCatalog
{
    public const string Bell = "bell", Email = "email", PushKey = "push", Webhook = "webhook", TelegramKey = "telegram";

    public static readonly IReadOnlyList<(string Key, string Name)> Groups =
    [
        ("approval", "Phê duyệt"), ("attendance", "Chấm công"), ("people", "Nhân sự & tài khoản"), ("contracts", "Hợp đồng & lương"),
        ("projects", "Dự án / công việc"), ("meetings", "Lịch họp"), ("documents", "Tài liệu"), ("assets", "Tài sản"), ("news", "Bảng tin"),
        ("sales", "Kinh doanh"), ("finance", "Tài chính"), ("chat", "Tin nhắn"), ("system", "Hệ thống"),
    ];

    public static readonly IReadOnlyList<NotificationEvent> Events =
    [
        // Phê duyệt (đơn nghỉ phép, tăng ca, giải trình, đề nghị chi… đều qua module Approval)
        new("approval.requested", "approval", "Có đơn chờ duyệt", "Người duyệt bước hiện tại (kể cả người duyệt thay) khi có đơn mới hoặc bước trước vừa duyệt.",
            NotificationCategories.ApprovalRequested, EmailMode.Optional),
        new("approval.approved", "approval", "Đơn được duyệt", "Người gửi đơn khi một bước duyệt xong hoặc đơn được duyệt hẳn.",
            NotificationCategories.ApprovalApproved, EmailMode.Conditional, "Chỉ khi duyệt bước cuối; bước trung gian chỉ có chuông"),
        new("approval.rejected", "approval", "Đơn bị từ chối", "Người gửi đơn, kèm lý do từ chối.", NotificationCategories.ApprovalRejected, EmailMode.Optional),
        new("approval.cancelled", "approval", "Đơn bị huỷ", "Người đang phải duyệt khi người gửi huỷ đơn.", NotificationCategories.ApprovalCancelled),
        new("approval.delegation", "approval", "Uỷ quyền duyệt", "Người được uỷ quyền / người uỷ quyền khi uỷ quyền duyệt thay được tạo hoặc thu hồi.",
            NotificationCategories.ApprovalDelegation, EmailMode.Conditional, "Chỉ gửi người được uỷ quyền"),

        new("attendance.reminder", "attendance", "Nhắc chấm công", "Nhân viên quên chấm ra trong ngày / bảng công hôm qua thiếu giờ ra (nhắc gửi giải trình).",
            NotificationCategories.AttendanceReminder, EmailMode.Conditional, "Theo cấu hình nhắc chấm công"),

        new("people.profile_change_requested", "people", "Đề nghị sửa hồ sơ", "HR khi nhân viên đề nghị đổi ngày sinh / CCCD / tài khoản ngân hàng.",
            NotificationCategories.ProfileChangeRequested),
        new("people.profile_change_approved", "people", "Hồ sơ được duyệt", "Nhân viên khi HR duyệt đề nghị sửa hồ sơ.", NotificationCategories.ProfileChangeApproved),
        new("people.profile_change_rejected", "people", "Hồ sơ bị từ chối", "Nhân viên khi HR từ chối đề nghị sửa hồ sơ, kèm lý do.", NotificationCategories.ProfileChangeRejected),
        new("people.account_security", "people", "Bảo mật tài khoản", "Chủ tài khoản khi HR / admin đặt lại mật khẩu hoặc xác thực 2 lớp.",
            NotificationCategories.AccountSecurity, EmailMode.Always),

        new("contracts.expiring", "contracts", "Hợp đồng sắp hết hạn", "HR + quản lý trực tiếp, 30 và 7 ngày trước khi hợp đồng lao động hết hạn.",
            NotificationCategories.ContractExpiring, EmailMode.Optional),
        new("contracts.probation_ending", "contracts", "Sắp hết thử việc", "HR + quản lý trực tiếp khi thử việc sắp hết (7 / 3 ngày) hoặc đã hết mà chưa có hợp đồng tiếp theo.",
            NotificationCategories.ProbationEnding, EmailMode.Optional),
        new("contracts.sign_requested", "contracts", "Chờ ký hợp đồng", "Nhân viên khi HR gửi hợp đồng để ký điện tử.", NotificationCategories.ContractSignRequested, EmailMode.Optional),
        new("contracts.signed", "contracts", "Đã ký hợp đồng", "HR khi nhân viên ký xong hợp đồng điện tử.", NotificationCategories.ContractSigned),
        new("contracts.payslip_ready", "contracts", "Phiếu lương", "Nhân viên khi kỳ lương được chốt, có phiếu lương mới.", NotificationCategories.PayslipReady),

        new("projects.task_assigned", "projects", "Được giao việc", "Người được giao (trừ khi tự giao cho mình), lúc tạo việc hoặc đổi người làm.",
            NotificationCategories.ProjectTask, Telegram: nameof(ITelegramWakeup.TaskAssignedAsync)),
        new("projects.task_returned", "projects", "Việc bị trả lại", "Người làm khi việc bị chuyển lùi kèm lý do (review chưa đạt / mở lại).",
            NotificationCategories.ProjectTask, Telegram: nameof(ITelegramWakeup.TaskReturnedAsync)),
        new("projects.task_awaiting_approval", "projects", "Việc chờ duyệt", "Quản lý dự án khi việc vào trạng thái ngay trước trạng thái cần duyệt.",
            NotificationCategories.ProjectTask),
        new("projects.task_approved", "projects", "Việc đã duyệt", "Người làm khi quản lý chuyển việc vào trạng thái cần duyệt (đã duyệt).", NotificationCategories.ProjectTask),
        new("projects.task_activity", "projects", "Hoạt động việc", "Các thành viên dự án còn lại khi có việc mới, việc đổi trạng thái hoặc có bình luận.",
            NotificationCategories.ProjectTask),
        new("projects.task_comment", "projects", "Bình luận việc", "Người làm khi người khác bình luận việc của họ.", NotificationCategories.ProjectTask),
        new("projects.task_mention", "projects", "Được nhắc trong việc",
            "Thành viên dự án được @mã-nhân-viên trong bình luận (Telegram: chỉ tài khoản bot, kể cả người làm việc; không gửi khi bot tự nhắc mình).",
            NotificationCategories.ProjectTask, Telegram: nameof(ITelegramWakeup.TaskMentionedAsync)),
        new("projects.task_ready", "projects", "Việc sẵn sàng",
            "Người làm (chưa giao thì quản lý dự án) khi mọi việc phải xong trước đã xong; bỏ người vừa thao tác (Telegram: chỉ khi có người làm là tài khoản bot).",
            NotificationCategories.ProjectTask, Telegram: nameof(ITelegramWakeup.TaskReadyAsync)),
        new("projects.task_due", "projects", "Việc đến hạn / quá hạn", "Người làm, một lần khi việc chưa xong đến hạn hoặc quá hạn.", NotificationCategories.ProjectTask),
        new("projects.updated", "projects", "Dự án được cập nhật", "Thành viên dự án khi thông tin chung / hướng dẫn làm việc của dự án đổi.", NotificationCategories.ProjectTask),
        new("projects.member_added", "projects", "Thêm vào dự án", "Nhân viên được thêm vào dự án (mở công việc + kho tài liệu dự án).", NotificationCategories.ProjectMemberAdded),

        new("meetings.invited", "meetings", "Mời họp", "Người được mời khi có lịch họp mới.", NotificationCategories.MeetingInvited, EmailMode.Optional),
        new("meetings.cancelled", "meetings", "Huỷ họp", "Người được mời khi lịch họp bị huỷ.", NotificationCategories.MeetingCancelled, EmailMode.Optional),
        new("meetings.agent_turn", "meetings", "Tới lượt nói trong họp agent",
            "Bot dự họp agent vừa nhận lượt nói: mở họp (bot chủ trì), được bot giữ lượt / người thật @nhắc, được chủ trì chỉ định, lượt quay về chủ trì. " +
            "Chỉ bot vừa nhận lượt; không chuông (Telegram: chỉ tài khoản bot).",
            null, Telegram: nameof(ITelegramWakeup.MeetingTurnAsync), WebhookEvent: WebhookEvents.MeetingTurn),

        new("documents.retention", "documents", "Hạn lưu trữ tài liệu", "HR + người phụ trách khi tài liệu sắp / đã hết hạn lưu trữ.",
            NotificationCategories.DocumentRetention, EmailMode.Optional),
        new("documents.handover", "documents", "Bàn giao tài liệu", "Người nhận phụ trách tài liệu (và dự án) của nhân viên nghỉ việc.",
            NotificationCategories.DocumentHandover, EmailMode.Optional),

        new("assets.assigned", "assets", "Được cấp tài sản", "Nhân viên được cấp thiết bị / tài khoản dịch vụ / Business Manager; nhắc xác nhận biên bản.",
            NotificationCategories.AssetAssigned, EmailMode.Optional),
        new("assets.returned", "assets", "Thu hồi tài sản", "Nhân viên khi thiết bị / tài khoản bị thu hồi hoặc không còn ghi nhận (kiểm kê).", NotificationCategories.AssetReturned),
        new("assets.expiring", "assets", "Tài sản sắp hết hạn", "HR + người quản trị dịch vụ khi thiết bị sắp hết bảo hành / dịch vụ sắp tới hạn gia hạn.",
            NotificationCategories.AssetExpiring, EmailMode.Optional),
        new("assets.offboarding", "assets", "Nghỉ việc còn giữ tài sản", "HR + quản lý cũ khi nhân viên nghỉ việc còn giữ thiết bị / tài khoản.",
            NotificationCategories.AssetOffboarding, EmailMode.Optional),
        new("assets.review", "assets", "Rà soát quyền dịch vụ", "Người rà soát / HR khi mở đợt rà soát quyền truy cập và khi đến hạn mà chưa quyết.",
            NotificationCategories.AssetReview, EmailMode.Optional),
        new("assets.social_post", "assets", "Mạng xã hội", "Người đăng khi đăng bài lên Fanpage thất bại · HR + người giữ BM khi token Business Manager bị từ chối.",
            NotificationCategories.SocialPost, EmailMode.Conditional, "Chỉ khi token BM bị từ chối; đăng bài lỗi chỉ có chuông"),

        new("news.published", "news", "Bài viết mới", "Người xem được bài khi tác giả chọn \"gửi email\" lúc đăng.", NotificationCategories.NewsPublished, EmailMode.Optional),
        new("news.comment", "news", "Bình luận bảng tin", "Tác giả bài / bình luận khi có bình luận hoặc trả lời.", NotificationCategories.NewsComment),
        new("news.mention", "news", "Được nhắc tên", "Người được @nhắc trong bài viết hoặc bình luận.", NotificationCategories.NewsMention),
        new("news.moderated", "news", "Bài bị ẩn / gỡ", "Tác giả khi quản trị ẩn hoặc gỡ bài viết / bình luận.", NotificationCategories.NewsModerated),

        new("sales.receivable_due", "sales", "Đợt thu đến hạn", "Người phụ trách hợp đồng + người có quyền Ghi sổ: đợt thu sắp đến hạn / đến hạn / quá hạn, mốc dự án vừa nghiệm thu.",
            NotificationCategories.ReceivableDue, EmailMode.Conditional, "Không gửi khi mới \"sắp đến hạn\""),
        new("sales.customer_follow_up", "sales", "Chăm sóc khách hàng", "Người phụ trách khi việc chăm sóc khách đến ngày hẹn.", NotificationCategories.CustomerFollowUp),
        new("sales.change_request_approved", "sales", "Yêu cầu thay đổi được duyệt", "Người phụ trách hợp đồng + kế toán khi khách đồng ý CR có tính tiền (lập phụ lục).",
            NotificationCategories.ChangeRequestApproved, EmailMode.Optional),

        new("finance.expense_ready", "finance", "Đề nghị chi chờ chi", "Người có quyền Ghi sổ khi đề nghị chi đã duyệt xong.", NotificationCategories.ExpenseReady),
        new("finance.expense_paid", "finance", "Đã chi tiền", "Người đề nghị khi kế toán đã chi.", NotificationCategories.ExpensePaid),

        new("chat.direct", "chat", "Tin nhắn 1-1", "Người nhận tin nhắn 1-1 (không có chuông).", null, Push: true, WebhookEvent: WebhookEvents.ChatMessage),
        new("chat.room", "chat", "Tin nhắn kênh phòng", "Thành viên kênh phòng / nhóm (không có chuông). Kênh Office toàn công ty không đẩy.", null, Push: true),
        new("chat.mention", "chat", "Được nhắc trong tin nhắn",
            "Người được @mã-nhân-viên trong tin kênh phòng / Toàn văn phòng / nhóm (phải là thành viên; không chuông). Webhook + Telegram: chỉ khi người gửi không phải bot " +
            "(Telegram: chỉ tài khoản bot).",
            null, Telegram: nameof(ITelegramWakeup.ChatMentionedAsync), Push: true, WebhookEvent: WebhookEvents.ChatMention),

        new("system.ai_alert", "system", "Cảnh báo trợ lý AI", "Mọi admin khi trợ lý AI / bot hoạt động bất thường (bị chặn nhiều, lỗi liên tục, ghi dồn dập, bot duyệt đơn).",
            NotificationCategories.AiAlert, EmailMode.Conditional, "Chỉ khi bot duyệt / từ chối đơn"),
    ];

    /// <summary>Webhook kỹ thuật, không phải sự kiện thông báo (nút "Gửi thử").</summary>
    public static readonly IReadOnlySet<string> TechnicalWebhookEvents = new HashSet<string> { WebhookEvents.Ping };

    /// <summary>Phương thức <see cref="ITelegramWakeup"/> không phải sự kiện (nút "Gửi thử").</summary>
    public static readonly IReadOnlySet<string> TechnicalTelegramMethods = new HashSet<string> { nameof(ITelegramWakeup.SendTestAsync) };

    /// <summary>Mọi hằng category khai báo trong <see cref="NotificationCategories"/>.</summary>
    public static IReadOnlyList<string> AllCategoryKeys { get; } = ConstantsOf(typeof(NotificationCategories));

    public static IReadOnlyList<string> ConstantsOf(Type t) =>
        [.. t.GetFields(BindingFlags.Public | BindingFlags.Static).Where(f => f.IsLiteral && f.FieldType == typeof(string)).Select(f => (string)f.GetRawConstantValue()!)];

    /// <summary>
    /// Kênh của một sự kiện theo thứ tự cột: chuông → email → push → webhook → Telegram. Ghi chú chỉ khi khác mặc định (mặc định — FE ghi ở chú thích:
    /// email người nhận tắt được ở hồ sơ, webhook sự kiện "notification", Telegram chỉ khi người làm là bot có "Bot Telegram").
    /// </summary>
    public static IReadOnlyList<EventChannelDto> ChannelsOf(NotificationEvent e)
    {
        var list = new List<EventChannelDto>();
        if (e.Category is not null) list.Add(new(Bell, null));
        switch (e.Email)
        {
            case EmailMode.Optional: list.Add(new(Email, null)); break;
            case EmailMode.Conditional: list.Add(new(Email, e.EmailNote)); break;
            case EmailMode.Always: list.Add(new(Email, "Luôn gửi, kể cả khi người nhận đã tắt email")); break;
        }
        if (e.Category is not null || e.Push) list.Add(new(PushKey, null));
        if (e.Category is not null) list.Add(new(Webhook, null));
        else if (e.WebhookEvent is not null) list.Add(new(Webhook, $"Sự kiện \"{e.WebhookEvent}\""));
        if (e.Telegram is not null) list.Add(new(TelegramKey, null));
        return list;
    }

    /// <summary>Danh mục theo nhóm (thứ tự <see cref="Groups"/>) cho FE.</summary>
    public static IReadOnlyList<NotificationEventGroupDto> Grouped() =>
    [
        .. Groups.Select(g => new NotificationEventGroupDto(g.Key, g.Name,
            [.. Events.Where(e => e.Group == g.Key).Select(e => new NotificationEventDto(e.Key, e.Title, e.Description, e.Category, ChannelsOf(e)))]))
            .Where(g => g.Events.Count > 0),
    ];

    /// <summary>Chip "Dùng cho" của một kênh: các sự kiện gửi qua kênh đó.</summary>
    public static IReadOnlyList<ChannelUseDto> UsedBy(string channel) =>
        [.. Events.Where(e => ChannelsOf(e).Any(c => c.Channel == channel)).Select(e => new ChannelUseDto(e.Key, e.Title))];
}
