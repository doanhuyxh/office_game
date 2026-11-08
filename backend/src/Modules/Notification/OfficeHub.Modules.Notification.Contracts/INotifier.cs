namespace OfficeHub.Modules.Notification.Contracts;

/// <summary>
/// Phần công khai của module Notification: module khác gửi thông báo cho tài khoản (in-app + email).
/// Lưu thông báo ngay; email gửi nền (hàng đợi trong DB, thử lại khi SMTP lỗi) nên không làm chậm / hỏng request gọi.
/// </summary>
public interface INotifier
{
    Task NotifyAsync(NotificationRequest request, CancellationToken ct = default);
}

/// <param name="RecipientUserIds">Id tài khoản nhận (trùng lặp tự bỏ).</param>
/// <param name="Category">Nhóm để FE chọn icon: xem <see cref="NotificationCategories"/>.</param>
/// <param name="Link">Đường dẫn trong app (vd "/approvals"); email dùng App__BaseUrl + Link.</param>
/// <param name="SendEmail">false = chỉ hiện trong app (thông báo phụ, tránh spam email).</param>
public sealed record NotificationRequest(
    IReadOnlyCollection<Guid> RecipientUserIds,
    string Category,
    string Title,
    string Body,
    string? Link = null,
    bool SendEmail = true);

public static class NotificationCategories
{
    /// <summary>Có đơn chờ người nhận duyệt.</summary>
    public const string ApprovalRequested = "approval_requested";
    /// <summary>Đơn của người nhận được duyệt (bước trung gian hoặc cuối).</summary>
    public const string ApprovalApproved = "approval_approved";
    public const string ApprovalRejected = "approval_rejected";
    /// <summary>Đơn người nhận đang phải duyệt đã bị người gửi huỷ.</summary>
    public const string ApprovalCancelled = "approval_cancelled";
    /// <summary>Được uỷ quyền duyệt thay / uỷ quyền bị thu hồi (module Approval).</summary>
    public const string ApprovalDelegation = "approval_delegation";
    /// <summary>Hợp đồng lao động sắp hết hạn (30 / 7 ngày) — gửi HR và quản lý trực tiếp.</summary>
    public const string ContractExpiring = "contract_expiring";
    /// <summary>Hợp đồng thử việc sắp hết (7 / 3 ngày) hoặc đã hết mà chưa có hợp đồng tiếp theo — gửi HR và quản lý trực tiếp.</summary>
    public const string ProbationEnding = "probation_ending";
    /// <summary>Được mời họp (module Meetings).</summary>
    public const string MeetingInvited = "meeting_invited";
    public const string MeetingCancelled = "meeting_cancelled";
    /// <summary>Nhắc chấm công ra / gửi giải trình khi quên chấm ra (module Attendance).</summary>
    public const string AttendanceReminder = "attendance_reminder";
    /// <summary>Phiếu lương kỳ mới đã chốt (module Payroll).</summary>
    public const string PayslipReady = "payslip_ready";
    /// <summary>Hợp đồng chờ nhân viên ký điện tử / nhân viên đã ký (module LaborContracts).</summary>
    public const string ContractSignRequested = "contract_sign_requested";
    public const string ContractSigned = "contract_signed";
    /// <summary>Nhân viên đề nghị đổi ngày sinh / CCCD / tài khoản ngân hàng (gửi HR) · HR duyệt / từ chối (gửi nhân viên) — module Organization.</summary>
    public const string ProfileChangeRequested = "profile_change_requested";
    public const string ProfileChangeApproved = "profile_change_approved";
    public const string ProfileChangeRejected = "profile_change_rejected";
    /// <summary>Tài liệu sắp / đã hết hạn lưu trữ — gửi HR + người phụ trách (module Documents).</summary>
    public const string DocumentRetention = "document_retention";
    /// <summary>Được bàn giao làm người phụ trách tài liệu (nhân viên cũ nghỉ việc) — module Documents.</summary>
    public const string DocumentHandover = "document_handover";
    /// <summary>Được thêm vào dự án (kho tài liệu dự án) — module Documents.</summary>
    public const string ProjectMemberAdded = "project_member_added";
    /// <summary>Bảo mật tài khoản: HR / admin đặt lại xác thực 2 lớp — module Organization.</summary>
    public const string AccountSecurity = "account_security";
    /// <summary>Bảng tin: bài mới (tác giả chọn gửi email), bình luận / trả lời, được @nhắc tên, bài bị ẩn — module News.</summary>
    public const string NewsPublished = "news_published";
    public const string NewsComment = "news_comment";
    public const string NewsMention = "news_mention";
    public const string NewsModerated = "news_moderated";
    /// <summary>Được cấp thiết bị / tài khoản dịch vụ (chuông + email) · bị thu hồi (chỉ chuông) — module Assets.</summary>
    public const string AssetAssigned = "asset_assigned";
    public const string AssetReturned = "asset_returned";
    /// <summary>Thiết bị sắp hết bảo hành / dịch vụ sắp tới hạn gia hạn (30 / 7 ngày) — gửi HR + người quản trị dịch vụ.</summary>
    public const string AssetExpiring = "asset_expiring";
    /// <summary>Nhân viên nghỉ việc còn giữ thiết bị / tài khoản dịch vụ — gửi HR + quản lý cũ.</summary>
    public const string AssetOffboarding = "asset_offboarding";
    /// <summary>Có mục cần rà soát quyền truy cập dịch vụ — gửi người rà soát.</summary>
    public const string AssetReview = "asset_review";
    /// <summary>Đề nghị chi đã duyệt, chờ kế toán chi (gửi người có quyền Ghi sổ) · đã chi tiền (gửi người đề nghị) — module Finance.</summary>
    public const string ExpenseReady = "expense_ready";
    public const string ExpensePaid = "expense_paid";
    /// <summary>Đợt thu sắp đến hạn / đến hạn / quá hạn (gửi người phụ trách hợp đồng + người có quyền Ghi sổ) · việc chăm sóc khách đến hẹn — module Sales.</summary>
    public const string ReceivableDue = "receivable_due";
    public const string CustomerFollowUp = "customer_follow_up";
    /// <summary>Được giao việc / việc đến hạn, quá hạn — module Projects.</summary>
    public const string ProjectTask = "project_task";
}
