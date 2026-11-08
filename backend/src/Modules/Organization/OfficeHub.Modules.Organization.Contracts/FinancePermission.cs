namespace OfficeHub.Modules.Organization.Contracts;

/// <summary>
/// Quyền tài chính gắn vào <b>chức vụ</b> (chủ dự án chốt 2026-11-08). Lưu dạng bit trong <c>org.positions</c>.
/// Quyền sau bao hàm quyền xem — dùng <see cref="FinancePermissions.Normalize"/> trước khi lưu / so sánh.
/// </summary>
[Flags]
public enum FinancePermission
{
    None = 0,
    /// <summary>Xem số dư, sổ thu chi, công nợ, hợp đồng bán, lãi / lỗ.</summary>
    View = 1,
    /// <summary>Ghi thu / chi, ghi nhận đợt thu, chi theo đề nghị đã duyệt (kế toán).</summary>
    Record = 2,
    /// <summary>Duyệt chi, duyệt báo giá giảm sâu (giám đốc).</summary>
    Approve = 4,
    /// <summary>Quản trị: bật / tắt quyền tài chính trên chức vụ, tài khoản tiền, danh mục, khoá sổ.</summary>
    Admin = 8,
}

public static class FinancePermissions
{
    public const int AllBits = (int)(FinancePermission.View | FinancePermission.Record | FinancePermission.Approve | FinancePermission.Admin);

    /// <summary>Giá trị có hợp lệ (chỉ gồm các bit đã định nghĩa, không âm)?</summary>
    public static bool IsValid(int value) => value >= 0 && (value & ~AllBits) == 0;

    /// <summary>Record / Approve / Admin ⇒ có luôn View. Bit lạ bị bỏ.</summary>
    public static FinancePermission Normalize(int value)
    {
        var p = (FinancePermission)(value & AllBits);
        return p != FinancePermission.None ? p | FinancePermission.View : p;
    }

    public static bool Has(this FinancePermission granted, FinancePermission required) =>
        required != FinancePermission.None && (granted & required) == required;
}
