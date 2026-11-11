using System.Security.Cryptography;
using System.Text;

namespace OfficeHub.BuildingBlocks.Office;

/// <summary>
/// OfficeHub.Mcp → OfficeHub.Realtime: tài khoản bot (HR đánh dấu, <c>MeResponse.IsBot</c>) vừa gọi một tool MCP → hiện bot trong
/// văn phòng 3D. Realtime giữ trong RAM, quá <see cref="OnlineMinutes"/> phút không có hoạt động mới thì bot "offline".
/// Xác thực bằng khoá chung <c>Chat__InternalKey</c> (header <see cref="KeyHeader"/>), không dùng cookie.
/// </summary>
/// <param name="Look">Ngoại hình nhân vật (JSON từ /api/auth/me, null = mặc định).</param>
/// <param name="Zone">Khu trên bản đồ của phòng ban (<c>departments.MapZone</c>, lấy từ phòng ban cha nếu phòng con chưa đặt); null = chưa gán.</param>
/// <param name="Activity">Đang làm gì, ví dụ "Chuyển trạng thái việc · WEB-12" (tiêu đề tool + đối tượng).</param>
public sealed record BotActivity(Guid UserId, string Name, string? Look, string? Zone, string Activity);

/// <summary>
/// OfficeHub.Mcp → OfficeHub.Realtime: bot vừa gửi tin chat qua Api (tool send_chat_message) → Realtime phát tới client chat + HUD 3D,
/// như tin gửi qua hub. Body = nguyên JSON <c>SendResultDto</c> Api trả về. Cùng khoá <see cref="BotActivityRoute.KeyHeader"/>.
/// </summary>
public static class ChatRelayRoute
{
    public const string Path = "/rt/internal/chat-message";
}

public static class BotActivityRoute
{
    public const string Path = "/rt/internal/bot-activity";
    public const string KeyHeader = "X-Internal-Key";
    public const int OnlineMinutes = 5;

    /// <summary>So sánh thời gian cố định (không lộ độ dài khớp qua thời gian phản hồi).</summary>
    public static bool KeyMatches(string? provided, string? expected) =>
        !string.IsNullOrEmpty(provided) && !string.IsNullOrEmpty(expected)
        && CryptographicOperations.FixedTimeEquals(SHA256.HashData(Encoding.UTF8.GetBytes(provided)), SHA256.HashData(Encoding.UTF8.GetBytes(expected)));
}
