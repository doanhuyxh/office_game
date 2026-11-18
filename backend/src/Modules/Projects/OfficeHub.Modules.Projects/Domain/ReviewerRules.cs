namespace OfficeHub.Modules.Projects.Domain;

/// <summary>
/// Người review việc (TEST-161): một thành viên dự án (người hoặc bot) review việc của người làm — vd agent C code, agent D review ngay trên việc của C
/// (không tách việc review riêng phụ thuộc việc code). Hàm thuần — test: tests/OfficeHub.Modules.Projects.Tests/ReviewerRulesTests.cs.
/// Rào chắn giữ nguyên: bot review chỉ bình luận, không duyệt / không chuyển trạng thái (cột approverOnly vẫn chỉ người thật).
/// </summary>
public static class ReviewerRules
{
    /// <summary>Lỗi khi đặt người review (null = hợp lệ). Không có người review → luôn hợp lệ.</summary>
    public static string? Error(Guid? reviewer, Guid? assignee, bool reviewerIsMember)
    {
        if (reviewer is not { } r) return null;
        if (!reviewerIsMember) return "Người review phải là thành viên dự án";
        return r == assignee ? "Người review phải khác người làm" : null;
    }

    /// <summary>
    /// Có báo "Cần review" không: việc vừa chuyển VÀO cột review từ một cột khác (đứng yên / chuyển giữa hai cột review không báo lại),
    /// có người review và người review không phải người vừa thao tác.
    /// </summary>
    public static bool ShouldRequest(IReadOnlyList<ColumnInfo> columns, Guid from, Guid to, Guid? reviewer, Guid? actor)
    {
        if (from == to || reviewer is not { } r || r == actor) return false;
        var dst = columns.FirstOrDefault(c => c.Id == to);
        var src = columns.FirstOrDefault(c => c.Id == from);
        return dst is { IsReview: true } && src is not { IsReview: true };
    }
}
