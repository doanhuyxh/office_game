using OfficeHub.BuildingBlocks.Auditing;

namespace OfficeHub.Modules.Audit.Domain;

/// <summary>
/// Một cảnh báo hoạt động AI bất thường đã gửi (job <c>AiAlertMonitor</c>). Vừa là lịch sử xem trên trang Báo cáo,
/// vừa để chống gửi lặp: cùng (người, luật) tối đa 1 cảnh báo / thời gian chống lặp (<see cref="AiAlertThresholds.Cooldown"/>).
/// </summary>
public sealed class AiAlert
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public DateTimeOffset CreatedAt { get; set; }
    /// <summary>Tài khoản dùng token AI có hoạt động bất thường.</summary>
    public Guid UserId { get; set; }
    /// <summary><see cref="AiAlertRules"/>: blocked | errors | burst_writes | bot_approval | chat_spam.</summary>
    public string Rule { get; set; } = "";
    public DateTimeOffset WindowStart { get; set; }
    public DateTimeOffset WindowEnd { get; set; }
    /// <summary>Số lệnh khớp luật trong cửa sổ.</summary>
    public int Count { get; set; }
    /// <summary>Tổng lệnh của người đó trong cửa sổ (để hiện tỉ lệ).</summary>
    public int Total { get; set; }
}

/// <summary>Thống kê một người trong cửa sổ quét (GROUP BY trên audit.ai_requests).</summary>
/// <param name="Chats">Tin chat gửi bằng token (POST /api/chat/conversations/{id}/messages).</param>
public sealed record AiWindowStats(Guid UserId, int Total, int Blocked, int Errors, int Writes, int Approvals, int Chats = 0);

public sealed record AiAlertHit(string Rule, int Count);

/// <summary>
/// Ngưỡng cảnh báo đang áp dụng: mặc định <see cref="Default"/> (giá trị gốc), quản trị viên chỉnh ở trang Hệ thống → Cấu hình
/// (bảng <c>audit.ai_alert_settings</c>, TEST-232). <paramref name="ErrorsPercent"/>: lỗi phải chiếm HƠN số % này trên tổng lệnh.
/// </summary>
public sealed record AiAlertThresholds(int Blocked, int Errors, int ErrorsPercent, int BurstWrites, int ChatSpam, int WindowMinutes, int CooldownMinutes)
{
    public static readonly AiAlertThresholds Default = new(10, 20, 50, 60, 20, 15, 60);

    public TimeSpan Window => TimeSpan.FromMinutes(WindowMinutes);
    public TimeSpan Cooldown => TimeSpan.FromMinutes(CooldownMinutes);

    public const int CountMin = 1;
    public const int BlockedMax = 1000;
    public const int ErrorsMax = 1000;
    public const int PercentMin = 0;
    public const int PercentMax = 99;
    public const int WritesMax = 10_000;
    public const int ChatsMax = 1000;
    /// <summary>Cửa sổ ≥ chu kỳ job (5 phút) để không bỏ sót lệnh giữa hai lần quét; tối đa 1 ngày.</summary>
    public const int WindowMin = 5;
    public const int WindowMax = 1440;
    public const int CooldownMin = 5;
    /// <summary>Tối đa 7 ngày.</summary>
    public const int CooldownMax = 10_080;

    /// <summary>Lỗi kiểm tra khoảng giá trị: field (camelCase như request) → thông báo ghi số cụ thể. Rỗng = hợp lệ.</summary>
    public Dictionary<string, string> Validate()
    {
        var e = new Dictionary<string, string>();
        void Check(string field, string label, int v, int min, int max)
        {
            if (v < min || v > max) e[field] = $"{label} phải từ {min} đến {max}";
        }
        Check("blockedThreshold", "Số lệnh bị chặn", Blocked, CountMin, BlockedMax);
        Check("errorsThreshold", "Số lệnh lỗi", Errors, CountMin, ErrorsMax);
        Check("errorsPercent", "Tỉ lệ lỗi (%)", ErrorsPercent, PercentMin, PercentMax);
        Check("burstWritesThreshold", "Số lệnh ghi", BurstWrites, CountMin, WritesMax);
        Check("chatSpamThreshold", "Số tin chat", ChatSpam, CountMin, ChatsMax);
        Check("windowMinutes", "Cửa sổ thời gian (phút)", WindowMinutes, WindowMin, WindowMax);
        Check("cooldownMinutes", "Thời gian chống lặp (phút)", CooldownMinutes, CooldownMin, CooldownMax);
        return e;
    }
}

/// <summary>
/// Ngưỡng cảnh báo AI do quản trị viên đặt (TEST-232). Bảng một dòng (<see cref="SingletonId"/>); chưa có dòng → <see cref="AiAlertThresholds.Default"/>.
/// <c>bot_approval</c> luôn bật, không có ngưỡng. Chỉ cảnh báo — không tự chặn bot.
/// </summary>
[Audited]
public sealed class AiAlertSettings
{
    public const int SingletonId = 1;
    public int Id { get; set; } = SingletonId;
    public int BlockedThreshold { get; set; }
    public int ErrorsThreshold { get; set; }
    public int ErrorsPercent { get; set; }
    public int BurstWritesThreshold { get; set; }
    public int ChatSpamThreshold { get; set; }
    public int WindowMinutes { get; set; }
    public int CooldownMinutes { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public string? UpdatedByName { get; set; }

    public AiAlertThresholds ToThresholds() =>
        new(BlockedThreshold, ErrorsThreshold, ErrorsPercent, BurstWritesThreshold, ChatSpamThreshold, WindowMinutes, CooldownMinutes);

    public void Apply(AiAlertThresholds t)
    {
        BlockedThreshold = t.Blocked;
        ErrorsThreshold = t.Errors;
        ErrorsPercent = t.ErrorsPercent;
        BurstWritesThreshold = t.BurstWrites;
        ChatSpamThreshold = t.ChatSpam;
        WindowMinutes = t.WindowMinutes;
        CooldownMinutes = t.CooldownMinutes;
    }
}

/// <summary>
/// Luật cảnh báo (chủ dự án chốt 2026-11-11: không có luật IP mới; người nhận = mọi tài khoản vai trò admin).
/// Ngưỡng / cửa sổ / chống lặp lấy từ <see cref="AiAlertThresholds"/> (TEST-232: admin chỉnh trên web, job đọc DB mỗi lần chạy).
/// </summary>
public static class AiAlertRules
{
    public const string Blocked = "blocked";
    public const string Errors = "errors";
    public const string BurstWrites = "burst_writes";
    public const string BotApproval = "bot_approval";
    public const string ChatSpam = "chat_spam";
    public static readonly string[] All = [Blocked, Errors, BurstWrites, BotApproval, ChatSpam];

    /// <summary>Chu kỳ job — cố định, không chỉnh trên web.</summary>
    public static readonly TimeSpan Interval = TimeSpan.FromMinutes(5);

    /// <summary>Luật khớp với thống kê một người. <paramref name="isBot"/> = tài khoản đánh dấu bot (HR đặt). <paramref name="t"/> null = mặc định.</summary>
    public static IReadOnlyList<AiAlertHit> Evaluate(AiWindowStats s, bool isBot, AiAlertThresholds? t = null)
    {
        t ??= AiAlertThresholds.Default;
        var hits = new List<AiAlertHit>();
        if (s.Blocked >= t.Blocked) hits.Add(new(Blocked, s.Blocked));
        // Lỗi phải chiếm hơn ErrorsPercent % số lệnh (agent bận nhiều mà lỗi lẻ tẻ thì không báo). So số nguyên: errors·100 > total·%.
        if (s.Errors >= t.Errors && (long)s.Errors * 100 > (long)s.Total * t.ErrorsPercent) hits.Add(new(Errors, s.Errors));
        if (s.Writes >= t.BurstWrites) hits.Add(new(BurstWrites, s.Writes));
        if (isBot && s.Approvals > 0) hits.Add(new(BotApproval, s.Approvals)); // luôn bật, không chỉnh được
        // Hạn mức cứng là 60 tin / giờ → nhiều tin trong cửa sổ = có thể đang nhắn qua lại với bot khác / lặp.
        if (s.Chats >= t.ChatSpam) hits.Add(new(ChatSpam, s.Chats));
        return hits;
    }

    /// <summary>Đã cảnh báo (người, luật) này trong thời gian chống lặp chưa. <paramref name="cooldown"/> null = mặc định 1 giờ.</summary>
    public static bool InCooldown(DateTimeOffset? lastSent, DateTimeOffset now, TimeSpan? cooldown = null) =>
        lastSent is { } t && now - t < (cooldown ?? AiAlertThresholds.Default.Cooldown);

    /// <summary>Chỉ gửi email cho luật nghiêm trọng (bot tự duyệt đơn); còn lại chuông + push.</summary>
    public static bool SendsEmail(string rule) => rule == BotApproval;

    public static string Title(string rule, string name) => rule switch
    {
        Blocked => $"Trợ lý AI của {name} bị chặn nhiều lần",
        Errors => $"Trợ lý AI của {name} gặp lỗi liên tục",
        BurstWrites => $"Trợ lý AI của {name} ghi dữ liệu dồn dập",
        BotApproval => $"Bot {name} đã gọi duyệt / từ chối đơn",
        ChatSpam => $"Bot {name} nhắn tin dồn dập",
        _ => $"Hoạt động AI bất thường: {name}",
    };

    /// <summary>"15 phút", "1 giờ", "1 giờ 30 phút".</summary>
    public static string Duration(int minutes) =>
        minutes < 60 ? $"{minutes} phút" : minutes % 60 == 0 ? $"{minutes / 60} giờ" : $"{minutes / 60} giờ {minutes % 60} phút";

    /// <param name="windowMinutes">Độ dài cửa sổ của cảnh báo (WindowEnd − WindowStart).</param>
    public static string Body(string rule, int count, int total, int windowMinutes = 15)
    {
        var w = Duration(windowMinutes);
        return rule switch
        {
            Blocked => $"{count} lệnh bị chặn (403 / 429) trong {w} qua — agent có thể đang thử truy cập dữ liệu không được phép hoặc chạy vòng lặp.",
            Errors => $"{count}/{total} lệnh lỗi trong {w} qua — agent có thể đang bị kẹt.",
            BurstWrites => $"{count} lệnh ghi trong {w} qua — kiểm tra xem agent có đang tạo việc / bình luận hàng loạt không.",
            BotApproval => $"{count} lệnh duyệt / từ chối đơn trong {w} qua. Bot không được phép tự duyệt đơn — kiểm tra ngay và thu hồi kết nối nếu cần.",
            ChatSpam => $"{count} tin nhắn trong {w} qua — bot có thể đang nhắn qua lại với bot khác hoặc lặp lại. Hệ thống tự chặn khi quá 60 tin / giờ.",
            _ => $"{count} lệnh trong {w} qua.",
        };
    }

    /// <summary>Độ dài cửa sổ (phút, làm tròn) của một cảnh báo đã lưu.</summary>
    public static int WindowMinutesOf(AiAlert a) => Math.Max(1, (int)Math.Round((a.WindowEnd - a.WindowStart).TotalMinutes));
}
