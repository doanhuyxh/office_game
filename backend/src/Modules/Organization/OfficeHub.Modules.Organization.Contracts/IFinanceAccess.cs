
namespace OfficeHub.Modules.Organization.Contracts;

/// <summary>
/// Quyền tài chính của một tài khoản = quyền của <b>chức vụ</b> trên hồ sơ nhân viên gắn với tài khoản đó.
/// Tài khoản không có hồ sơ (admin seed), nhân viên đã nghỉ việc hoặc chức vụ chưa bật quyền → <see cref="FinancePermission.None"/>.
/// Vai trò <c>admin</c> không tự có quyền xem tiền (chủ dự án: chỉ giám đốc và kế toán xem tiền).
/// </summary>
public interface IFinanceAccess
{
    Task<FinancePermission> GetAsync(Guid userId, CancellationToken ct = default);

    /// <summary>Id người dùng (tài khoản) của mọi nhân viên đang làm có chức vụ chứa <paramref name="required"/> — dùng chọn người duyệt / người nhận thông báo.</summary>
    Task<IReadOnlyList<Guid>> ListUserIdsAsync(FinancePermission required, CancellationToken ct = default);
}
