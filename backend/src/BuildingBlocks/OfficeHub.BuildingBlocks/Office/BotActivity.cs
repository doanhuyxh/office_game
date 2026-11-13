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
/// <param name="Busy">Có việc đang làm không (true → ngồi bàn, false → ra Khu nghỉ, null = không rõ → giữ như cũ). Xem <see cref="BotWork"/>.</param>
/// <param name="Task">Việc đang làm: "WEB-12 · Tên việc" (≤ 80 ký tự), null = không có / không rõ.</param>
/// <param name="FromRunner">true = agent-runner báo (<see cref="BotWork.PresencePath"/>) — ưu tiên hơn trạng thái suy từ bảng việc trong <see cref="BotActivityRoute.OnlineMinutes"/> phút.</param>
public sealed record BotActivity(Guid UserId, string Name, string? Look, string? Zone, string Activity, bool? Busy = null, string? Task = null, bool FromRunner = false);

/// <summary>
/// Bot đang làm / rảnh (chủ dự án yêu cầu 2026-11-13): đang làm → ngồi bàn trong khu phòng ban, bong bóng "🛠 việc · thao tác";
/// rảnh → đi bộ ra Khu nghỉ (hết chỗ → Pantry), bong bóng "☕ Đang nghỉ". Nguồn: agent-runner báo qua <see cref="PresencePath"/> (ưu tiên),
/// không có thì OfficeHub.Mcp suy từ bảng việc (<c>/api/projects/tasks/mine</c> → <c>inProgress</c>).
/// </summary>
public static class BotWork
{
    /// <summary>Endpoint trên host OfficeHub.Mcp (sau BearerGate, token AI của bot): body <see cref="BotPresenceReport"/>.</summary>
    public const string PresencePath = "/mcp/presence";
    public const string Working = "working";
    public const string Idle = "idle";
    public const string IdleBubble = "☕ Đang nghỉ";
    /// <summary>Rảnh liên tục bấy nhiêu giây mới đi ra Khu nghỉ (chống đi qua đi lại giữa hai việc). Có việc → về bàn ngay.</summary>
    public const int IdleDelaySeconds = 60;
    public const int MaxTask = 80;
    public const int MaxActivity = 60;
}

/// <param name="State"><see cref="BotWork.Working"/> | <see cref="BotWork.Idle"/>.</param>
/// <param name="Task">Mã việc (+ tên) đang làm, ví dụ "WEB-12 · Sửa form đăng nhập".</param>
/// <param name="Activity">Nhãn thô thao tác hiện tại ("Sửa code", "Chạy lệnh"…) — không gửi lệnh / đường dẫn file / lời agent.</param>
public sealed record BotPresenceReport(string State, string? Task = null, string? Activity = null);

/// <summary>
/// OfficeHub.Mcp → OfficeHub.Realtime: bot vừa gửi tin chat qua Api (tool send_chat_message) → Realtime phát tới client chat + HUD 3D,
/// như tin gửi qua hub. Body = nguyên JSON <c>SendResultDto</c> Api trả về. Cùng khoá <see cref="BotActivityRoute.KeyHeader"/>.
/// </summary>
/// <summary>
/// OfficeHub.Mcp → OfficeHub.Realtime: bot gọi tool <c>go_to</c> → đi bộ tới chỗ <see cref="Place"/> (tên / id phòng, khu phòng ban,
/// "bàn của tôi", tên người đang trong văn phòng). <see cref="Activity"/> để Realtime cho bot online trước nếu chưa có mặt.
/// </summary>
public sealed record BotMove(BotActivity Activity, string Place);
public sealed record OfficePlaceInfo(string Id, string Kind, string Name);
/// <param name="Seconds">Thời gian đi ước tính (giây).</param>
public sealed record BotMoveResult(OfficePlaceInfo Place, string Spot, double Distance, double Seconds, bool Sit);

public static class BotMoveRoute
{
    public const string Path = "/rt/internal/bot-move";
    /// <summary>GET ?userId= — các chỗ bot đi tới được (phòng, khu, bàn của tôi, người đang online).</summary>
    public const string PlacesPath = "/rt/internal/office-places";
}

/// <summary>
/// OfficeHub.Mcp → OfficeHub.Realtime: bot chiếu lên TV phòng đang ngồi. Mode: <c>frame</c> (ảnh chụp màn hình base64 — <see cref="Image"/>),
/// <c>document</c> (tài liệu trong kho: <see cref="DetailJson"/> + <see cref="FileJson"/> = body Api trả cho token của bot), <c>stop</c>.
/// </summary>
public sealed record BotScreenRequest(BotActivity Activity, string Mode, string? Image = null, string? Caption = null, string? DetailJson = null, string? FileJson = null,
    string? Markdown = null);

public static class BotScreenRoute
{
    public const string Path = "/rt/internal/bot-screen";
}

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
