namespace OfficeHub.Modules.Projects.Domain;

/// <summary>
/// Quy trình trạng thái việc khi dự án bật "Xong cần duyệt" (<see cref="Project.RequireReview"/>) — chủ dự án chốt 2026-11-10, áp dụng như nhau cho người và BOT:
/// Cần làm → Đang làm → Chờ review → Xong, đi lần lượt từng bước. Chỉ quản lý dự án (hoặc HR) chuyển Chờ review → Xong.
/// Lùi: Đang làm → Cần làm tự do; Chờ review → Đang làm (review chưa đạt) và mở lại việc đã Xong (chỉ quản lý) bắt buộc ghi lý do.
/// Dự án tắt "Xong cần duyệt" → kéo thả tự do như trước. Hàm thuần, test: tests/OfficeHub.Modules.Projects.Tests/TaskWorkflowTests.cs.
/// </summary>
public static class TaskWorkflow
{
    public const int MaxNote = 2000;

    public static string Label(TaskState s) => s switch
    {
        TaskState.Todo => "Cần làm",
        TaskState.Doing => "Đang làm",
        TaskState.Review => "Chờ review",
        _ => "Xong",
    };

    /// <summary>Chuyển lùi cần lý do (review chưa đạt / mở lại việc đã xong).</summary>
    public static bool NeedsNote(TaskState from, TaskState to, bool requireReview) =>
        requireReview && to < from && from is TaskState.Review or TaskState.Done;

    /// <summary>Lỗi khi chuyển <paramref name="from"/> → <paramref name="to"/> (null = được phép).</summary>
    /// <param name="canManage">Quản lý dự án hoặc HR.</param>
    public static string? MoveError(TaskState from, TaskState to, bool requireReview, bool canManage, bool hasNote)
    {
        if (from == to || !requireReview) return null;
        if (to > from)
        {
            if (to != from + 1) return $"Phải đi lần lượt từng bước: {Label(from)} → {Label(from + 1)}";
            return to == TaskState.Done && !canManage ? "Chỉ quản lý dự án được duyệt việc sang Xong" : null;
        }
        if (from == TaskState.Done)
        {
            if (!canManage) return "Chỉ quản lý dự án được mở lại việc đã xong";
            if (to != TaskState.Doing) return "Mở lại việc đã xong: chuyển về Đang làm";
        }
        else if (from == TaskState.Review && to != TaskState.Doing) return "Review chưa đạt: chuyển về Đang làm";
        return NeedsNote(from, to, requireReview) && !hasNote ? "Ghi lý do (review chưa đạt / mở lại việc)" : null;
    }

    /// <summary>Trạng thái được chọn khi tạo việc: dự án cần duyệt → chỉ Cần làm / Đang làm.</summary>
    public static string? CreateStateError(TaskState s, bool requireReview) =>
        requireReview && s > TaskState.Doing ? "Dự án cần duyệt: việc mới chỉ ở Cần làm hoặc Đang làm" : null;
}
