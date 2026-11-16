namespace OfficeHub.BuildingBlocks.Office;

/// <summary>
/// Bot cần chú ý trong văn phòng 3D (TEST-117, chủ dự án chốt 2026-11-16) — hai trạng thái ngoài <see cref="BotWork.Working"/> / <see cref="BotWork.Idle"/>:
/// <list type="bullet">
/// <item><b>Lỗi</b>: agent-runner báo <see cref="BotWork.Error"/> kèm loại lỗi ngắn (<see cref="BotPresenceReport.Error"/> → <see cref="BotActivity.Error"/>).
/// Lỗi được GIỮ tới khi runner báo một trạng thái khác (working / idle) — không tự hết theo thời gian. Bong bóng chỉ ghi loại lỗi ngắn
/// (cả công ty thấy); chi tiết vẫn ở bảng "Màn hình của bot" cho người đứng gần.</item>
/// <item><b>Chờ người</b>: việc vẫn ở cột hiện tại, bot đã bình luận / chuyển việc và báo người duyệt. Nhận biết KHÔNG dựa vào cột:
/// một việc của bot là "chờ người" khi thao tác cuối trên việc (bình luận / chuyển trạng thái / giao việc) là của chính bot
/// và chưa có người thật thao tác lại sau đó. <see cref="Approval"/> = bot đã chuyển sang trạng thái cần duyệt / báo người duyệt;
/// <see cref="Reply"/> = bot hỏi lại (bình luận) và chờ trả lời.</item>
/// </list>
/// OfficeHub.Realtime → OfficeHub.Api: Realtime hỏi định kỳ (<see cref="PollSeconds"/> giây) các việc đang chờ người của những bot đang online —
/// POST <see cref="Path"/>, body <see cref="BotWaitingQuery"/>, trả về danh sách <see cref="BotWaiting"/>. Khoá chiều Realtime → Api
/// (<c>Chat__RealtimeToApiKey</c>, trống = <c>Chat__InternalKey</c>) qua header <see cref="AgentMeetingLiveRoute.KeyHeader"/> như
/// <see cref="AgentMeetingLiveRoute.Path"/> — không thêm biến .env.
/// </summary>
public static class BotWaitingRoute
{
    public const string Path = "/api/projects/internal/bot-waiting";
    /// <summary>Chu kỳ Realtime hỏi Api (giây).</summary>
    public const int PollSeconds = 30;
    /// <summary>Tối đa số tài khoản bot trong một lần hỏi (<see cref="BotWaitingQuery.UserIds"/>).</summary>
    public const int MaxUsers = 200;
    /// <summary>Tối đa số việc chờ người trả về cho mỗi bot (mới nhất trước).</summary>
    public const int MaxTasks = 10;
    /// <summary><see cref="BotWaitingTask.Kind"/>: bot đã báo người duyệt, chờ duyệt.</summary>
    public const string Approval = "approval";
    /// <summary><see cref="BotWaitingTask.Kind"/>: bot đã bình luận hỏi lại, chờ người trả lời.</summary>
    public const string Reply = "reply";
}

/// <param name="UserIds">Tài khoản bot cần hỏi (≤ <see cref="BotWaitingRoute.MaxUsers"/>).</param>
public sealed record BotWaitingQuery(IReadOnlyList<Guid> UserIds);

/// <param name="Code">Mã việc, ví dụ "WEB-12".</param>
/// <param name="Column">Tên cột hiện tại của việc (chỉ để hiển thị, không dùng để nhận biết).</param>
/// <param name="Kind"><see cref="BotWaitingRoute.Approval"/> | <see cref="BotWaitingRoute.Reply"/>.</param>
/// <param name="Since">Thời điểm thao tác cuối của bot (UTC) — bắt đầu chờ người.</param>
public sealed record BotWaitingTask(Guid TaskId, Guid ProjectId, string Code, string Title, string Column, string Kind, DateTimeOffset Since);

/// <param name="UserId">Tài khoản bot.</param>
/// <param name="Tasks">Việc đang chờ người (≤ <see cref="BotWaitingRoute.MaxTasks"/>); rỗng = không chờ ai.</param>
public sealed record BotWaiting(Guid UserId, IReadOnlyList<BotWaitingTask> Tasks);
