namespace OfficeHub.Modules.Projects.Domain;

/// <summary>Một sự kiện trên việc (lịch sử hoặc bình luận) để nhận biết bot đang chờ người (TEST-119).</summary>
/// <param name="ActorEmployeeId">Nhân viên thực hiện (bot = tài khoản bot đó); null = không rõ.</param>
/// <param name="Counts">Sự kiện bot có tính là "bot vừa báo người" không: chuyển trạng thái / giao việc / bình luận → có;
/// tạo / sửa nội dung / đổi hạn / phụ thuộc / xoá bình luận → không (bỏ qua). Sự kiện của người thật luôn ngắt chờ.</param>
public readonly record struct WaitEvent(DateTimeOffset At, bool ByBot, Guid? ActorEmployeeId, bool Counts);

/// <summary>
/// Luật "bot chờ người" cho văn phòng 3D (TEST-119, chủ dự án chốt 2026-11-16): chờ duyệt thì việc vẫn ở cột hiện tại, bot bình luận + báo
/// người duyệt → KHÔNG suy từ cột mà từ lịch sử thao tác. Một việc của bot là đang chờ khi thao tác có tính (chuyển / giao / bình luận) mới nhất
/// là của chính bot làm việc và sau đó chưa có người thật thao tác gì (kể cả sửa nội dung, đổi hạn, xoá bình luận).
/// Hàm thuần — test: tests/OfficeHub.Modules.Projects.Tests/BotWaitRulesTests.cs.
/// </summary>
public static class BotWaitRules
{
    /// <summary>Thời điểm bot làm việc bắt đầu chờ người (UTC), null = không chờ.
    /// Duyệt từ mới → cũ: người thật → null; sự kiện bot không tính → bỏ qua; sự kiện bot có tính → <c>At</c> nếu do chính người làm việc,
    /// không thì null (bot khác giao việc cho bot này ≠ bot này chờ người).</summary>
    public static DateTimeOffset? WaitingSince(IEnumerable<WaitEvent> events, Guid assigneeEmployeeId)
    {
        foreach (var e in events.OrderByDescending(e => e.At))
        {
            if (!e.ByBot) return null;
            if (!e.Counts) continue;
            return e.ActorEmployeeId == assigneeEmployeeId ? e.At : null;
        }
        return null;
    }

    /// <summary>Chờ duyệt (true) khi cột ngay sau cột hiện tại (theo <see cref="TaskColumn.Position"/>) là cột cần người duyệt;
    /// còn lại là chờ phản hồi. Cột không thuộc danh sách → false.</summary>
    public static bool AwaitingApproval(IEnumerable<TaskColumn> columns, Guid columnId)
    {
        var ordered = columns.OrderBy(c => c.Position).ToList();
        var i = ordered.FindIndex(c => c.Id == columnId);
        return i >= 0 && i + 1 < ordered.Count && ordered[i + 1].ApproverOnly;
    }

    /// <summary>Sự kiện lịch sử có tính là "bot vừa báo người" không (chuyển trạng thái / giao việc).</summary>
    public static bool Counts(TaskActivityKind kind) => kind is TaskActivityKind.Moved or TaskActivityKind.Assigned;
}
