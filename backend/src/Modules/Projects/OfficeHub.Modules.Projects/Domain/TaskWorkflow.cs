namespace OfficeHub.Modules.Projects.Domain;

/// <summary>Kiểu thông báo sau khi chuyển việc.</summary>
public enum MoveNotice { None, AwaitingApproval, Approved, SentBack }

/// <summary>
/// Quy trình chuyển việc giữa các cột tự do (chủ dự án chốt 2026-11-11, áp dụng như nhau cho người và BOT):
/// <list type="bullet">
/// <item>Dự án bật "Đi lần lượt" (<see cref="Project.Sequential"/>): chỉ tiến 1 cột mỗi lần; lùi về cột trước bất kỳ nhưng bắt buộc ghi lý do.</item>
/// <item>Cột "Cần người duyệt" (<see cref="TaskColumn.ApproverOnly"/>, luôn áp dụng): chỉ quản lý dự án / HR chuyển việc vào, hoặc kéo lùi ra khỏi cột.</item>
/// <item>Tạo việc (đi lần lượt): chỉ ở các cột trước cột cần duyệt / cột hoàn thành đầu tiên; không đi lần lượt: cột cần duyệt vẫn chỉ quản lý.</item>
/// </list>
/// Hàm thuần, <paramref name="columns"/> luôn sắp theo Position. Test: tests/OfficeHub.Modules.Projects.Tests/TaskWorkflowTests.cs.
/// </summary>
public static class TaskWorkflow
{
    public const int MaxNote = 2000;

    private static int IndexOf(IReadOnlyList<ColumnInfo> columns, Guid id)
    {
        for (var i = 0; i < columns.Count; i++) if (columns[i].Id == id) return i;
        return -1;
    }

    /// <summary>Chuyển lùi trong dự án đi lần lượt → cần lý do.</summary>
    public static bool NeedsNote(IReadOnlyList<ColumnInfo> columns, Guid from, Guid to, bool sequential) =>
        sequential && IndexOf(columns, to) < IndexOf(columns, from);

    /// <summary>Lỗi khi chuyển <paramref name="from"/> → <paramref name="to"/> (null = được phép).</summary>
    /// <param name="canApprove">Quản lý dự án hoặc HR.</param>
    public static string? MoveError(IReadOnlyList<ColumnInfo> columns, Guid from, Guid to, bool sequential, bool canApprove, bool hasNote)
    {
        if (from == to) return null;
        int fi = IndexOf(columns, from), ti = IndexOf(columns, to);
        if (ti < 0) return "Trạng thái không thuộc dự án";
        if (fi < 0) return null; // cột cũ không còn (không xảy ra — xoá cột chuyển hết việc) → cho đặt lại
        var src = columns[fi];
        var dst = columns[ti];
        if (ti > fi)
        {
            if (sequential && ti != fi + 1) return $"Phải đi lần lượt từng bước: {src.Name} → {columns[fi + 1].Name}";
            return dst.ApproverOnly && !canApprove ? $"Chỉ quản lý dự án được chuyển việc sang \"{dst.Name}\"" : null;
        }
        if (src.ApproverOnly && !canApprove) return $"Chỉ quản lý dự án được chuyển việc ra khỏi \"{src.Name}\"";
        if (dst.ApproverOnly && !canApprove) return $"Chỉ quản lý dự án được chuyển việc sang \"{dst.Name}\"";
        return sequential && !hasNote ? "Ghi lý do khi chuyển lùi trạng thái" : null;
    }

    /// <summary>Cột được chọn khi tạo việc.</summary>
    public static string? CreateError(IReadOnlyList<ColumnInfo> columns, Guid column, bool sequential, bool canApprove)
    {
        var i = IndexOf(columns, column);
        if (i < 0) return "Trạng thái không thuộc dự án";
        if (sequential)
        {
            var gate = FirstGate(columns);
            if (gate >= 0 && i >= gate) return $"Dự án đi lần lượt: việc mới chỉ ở các trạng thái trước \"{columns[gate].Name}\"";
        }
        return columns[i].ApproverOnly && !canApprove ? $"Chỉ quản lý dự án được tạo việc ở \"{columns[i].Name}\"" : null;
    }

    /// <summary>Cột cần duyệt / hoàn thành đầu tiên (−1 = không có).</summary>
    private static int FirstGate(IReadOnlyList<ColumnInfo> columns)
    {
        for (var i = 0; i < columns.Count; i++) if (columns[i].ApproverOnly || columns[i].IsDone) return i;
        return -1;
    }

    /// <summary>
    /// Ai cần biết sau khi chuyển: tiến vào cột ngay trước một cột cần duyệt → quản lý dự án (chờ duyệt);
    /// tiến vào cột cần duyệt → người làm (đã duyệt); lùi kèm lý do → người làm (trả lại / mở lại).
    /// </summary>
    public static MoveNotice Notice(IReadOnlyList<ColumnInfo> columns, Guid from, Guid to, bool hasNote)
    {
        int fi = IndexOf(columns, from), ti = IndexOf(columns, to);
        if (fi < 0 || ti < 0 || fi == ti) return MoveNotice.None;
        if (ti < fi) return hasNote ? MoveNotice.SentBack : MoveNotice.None;
        if (columns[ti].ApproverOnly) return MoveNotice.Approved;
        return ti + 1 < columns.Count && columns[ti + 1].ApproverOnly ? MoveNotice.AwaitingApproval : MoveNotice.None;
    }
}
