namespace OfficeHub.Modules.Audit.Domain;

/// <summary>
/// Một cảnh báo hoạt động AI bất thường đã gửi (job <c>AiAlertMonitor</c>). Vừa là lịch sử xem trên trang Báo cáo,
/// vừa để chống gửi lặp: cùng (người, luật) tối đa 1 cảnh báo / <see cref="AiAlertRules.Cooldown"/>.
/// </summary>
public sealed class AiAlert
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public DateTimeOffset CreatedAt { get; set; }
    /// <summary>Tài khoản dùng token AI có hoạt động bất thường.</summary>
    public Guid UserId { get; set; }
    /// <summary><see cref="AiAlertRules"/>: blocked | errors | burst_writes | bot_approval.</summary>
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

/// <summary>Luật cảnh báo (chủ dự án chốt 2026-11-11: không có luật IP mới; người nhận = mọi tài khoản vai trò admin).</summary>
public static class AiAlertRules
{
    public const string Blocked = "blocked";
    public const string Errors = "errors";
    public const string BurstWrites = "burst_writes";
    public const string BotApproval = "bot_approval";
    public const string ChatSpam = "chat_spam";
    public static readonly string[] All = [Blocked, Errors, BurstWrites, BotApproval, ChatSpam];

    public static readonly TimeSpan Window = TimeSpan.FromMinutes(15);
    public static readonly TimeSpan Interval = TimeSpan.FromMinutes(5);
    public static readonly TimeSpan Cooldown = TimeSpan.FromHours(1);

    public const int BlockedMin = 10;
    public const int ErrorsMin = 20;
    /// <summary>Lỗi phải chiếm hơn nửa số lệnh (agent bận nhiều mà lỗi lẻ tẻ thì không báo).</summary>
    public const double ErrorRatio = 0.5;
    public const int WritesMin = 60;
    /// <summary>Bot nhắn ≥ 20 tin / 15 phút (hạn mức cứng là 60 tin / giờ) → có thể đang nhắn qua lại với bot khác / lặp.</summary>
    public const int ChatsMin = 20;

    /// <summary>Luật khớp với thống kê một người. <paramref name="isBot"/> = tài khoản đánh dấu bot (HR đặt).</summary>
    public static IReadOnlyList<AiAlertHit> Evaluate(AiWindowStats s, bool isBot)
    {
        var hits = new List<AiAlertHit>();
        if (s.Blocked >= BlockedMin) hits.Add(new(Blocked, s.Blocked));
        if (s.Errors >= ErrorsMin && s.Errors > s.Total * ErrorRatio) hits.Add(new(Errors, s.Errors));
        if (s.Writes >= WritesMin) hits.Add(new(BurstWrites, s.Writes));
        if (isBot && s.Approvals > 0) hits.Add(new(BotApproval, s.Approvals));
        if (s.Chats >= ChatsMin) hits.Add(new(ChatSpam, s.Chats));
        return hits;
    }

    /// <summary>Đã cảnh báo (người, luật) này trong <see cref="Cooldown"/> chưa.</summary>
    public static bool InCooldown(DateTimeOffset? lastSent, DateTimeOffset now) => lastSent is { } t && now - t < Cooldown;

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

    public static string Body(string rule, int count, int total) => rule switch
    {
        Blocked => $"{count} lệnh bị chặn (403 / 429) trong 15 phút qua — agent có thể đang thử truy cập dữ liệu không được phép hoặc chạy vòng lặp.",
        Errors => $"{count}/{total} lệnh lỗi trong 15 phút qua — agent có thể đang bị kẹt.",
        BurstWrites => $"{count} lệnh ghi trong 15 phút qua — kiểm tra xem agent có đang tạo việc / bình luận hàng loạt không.",
        BotApproval => $"{count} lệnh duyệt / từ chối đơn trong 15 phút qua. Bot không được phép tự duyệt đơn — kiểm tra ngay và thu hồi kết nối nếu cần.",
        ChatSpam => $"{count} tin nhắn trong 15 phút qua — bot có thể đang nhắn qua lại với bot khác hoặc lặp lại. Hệ thống tự chặn khi quá 60 tin / giờ.",
        _ => $"{count} lệnh trong 15 phút qua.",
    };
}
