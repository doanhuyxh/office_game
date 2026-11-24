namespace OfficeHub.Modules.Projects.Domain;

/// <summary>Hành động thao tác hàng loạt trên việc (chuỗi gửi từ web).</summary>
public static class BulkTaskActions
{
    public const string Move = "move";
    public const string Assign = "assign";
    public const string Due = "due";
    public const string Follow = "follow";
    public const string Unfollow = "unfollow";
    public const string Delete = "delete";
    public static readonly IReadOnlyList<string> All = [Move, Assign, Due, Follow, Unfollow, Delete];
}

/// <summary>Cách đổi hạn hàng loạt.</summary>
public static class BulkDueModes
{
    public const string Set = "set";
    public const string Clear = "clear";
    public const string Shift = "shift";
    public static readonly IReadOnlyList<string> All = [Set, Clear, Shift];
}

/// <summary>
/// Thao tác hàng loạt trên việc của dự án (web, danh sách + kanban). Hàm thuần — test: tests/OfficeHub.Modules.Projects.Tests/BulkTaskRulesTests.cs.
/// Từng việc đi qua đúng handler đơn lẻ (quy trình, quyền, lịch sử, thông báo từng việc); thành công từng phần.
/// </summary>
public static class BulkTaskRules
{
    /// <summary>Số việc tối đa mỗi lần.</summary>
    public const int MaxIds = 100;
    /// <summary>Dời hạn tối đa ± số ngày.</summary>
    public const int MaxShiftDays = 365;
    /// <summary>Chữ người dùng phải gõ để xoá hàng loạt (không phân biệt hoa thường, bỏ khoảng trắng đầu / cuối).</summary>
    public const string DeleteConfirmWord = "delete";

    public static bool IsDeleteConfirmed(string? typed) => string.Equals(typed?.Trim(), DeleteConfirmWord, StringComparison.OrdinalIgnoreCase);

    /// <summary>Hạn mới khi dời <paramref name="days"/> ngày; việc chưa có hạn → null (bị bỏ qua).</summary>
    public static DateOnly? ShiftDue(DateOnly? current, int days) => current?.AddDays(days);

    /// <summary>Lỗi cấu trúc yêu cầu (null = hợp lệ) — chưa xét quyền / quy trình từng việc.</summary>
    public static string? RequestError(string? action, int idCount, bool hasColumn, bool hasFollower, string? dueMode, int shiftDays, bool hasDueOn, string? confirm)
    {
        if (action is null || !BulkTaskActions.All.Contains(action)) return "Thao tác không hợp lệ";
        if (idCount == 0) return "Chưa chọn việc nào";
        if (idCount > MaxIds) return $"Mỗi lần chỉ thao tác tối đa {MaxIds} việc";
        switch (action)
        {
            case BulkTaskActions.Move when !hasColumn: return "Chọn trạng thái cần chuyển tới";
            case BulkTaskActions.Follow or BulkTaskActions.Unfollow when !hasFollower: return "Chọn người theo dõi";
            case BulkTaskActions.Due:
                if (dueMode is null || !BulkDueModes.All.Contains(dueMode)) return "Cách đổi hạn không hợp lệ";
                if (dueMode == BulkDueModes.Set && !hasDueOn) return "Chọn ngày hạn";
                if (dueMode == BulkDueModes.Shift && (shiftDays == 0 || Math.Abs(shiftDays) > MaxShiftDays)) return $"Số ngày dời từ 1 đến {MaxShiftDays} (âm = lùi lại)";
                break;
            case BulkTaskActions.Delete when !IsDeleteConfirmed(confirm): return $"Gõ \"{DeleteConfirmWord}\" để xác nhận xoá";
        }
        return null;
    }
}
