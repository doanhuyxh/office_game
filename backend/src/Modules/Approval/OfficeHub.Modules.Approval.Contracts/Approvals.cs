namespace OfficeHub.Modules.Approval.Contracts;

/// <summary>Loại đơn. Module sở hữu đơn đăng ký <see cref="IApprovalHandler"/> với đúng Type.</summary>
public static class ApprovalTypes
{
    public const string Leave = "leave";
    public const string AttendanceCorrection = "attendance_correction";
    public const string Overtime = "overtime";
    /// <summary>Ban hành tài liệu trong kho tài liệu (module Documents).</summary>
    public const string DocumentPublish = "document_publish";
}

/// <summary>Bước duyệt. Manager = quản lý trực tiếp của người gửi (bỏ qua nếu không có); Hr = bất kỳ ai có vai trò hr/admin.</summary>
public enum ApprovalStepKind { Manager = 0, Hr = 1 }

public sealed record ApprovalSubmission(
    string Type,
    /// <summary>Id bản ghi trong module sở hữu (vd LeaveRequest.Id)</summary>
    Guid SubjectId,
    Guid RequesterEmployeeId,
    string Title,
    string Summary,
    IReadOnlyList<ApprovalStepKind> Steps);

/// <summary>Module khác gửi đơn vào luồng duyệt.</summary>
public interface IApprovalService
{
    /// <summary>Tạo đơn + các bước duyệt. Trả Id đơn duyệt (lưu lại ở bản ghi gốc).</summary>
    Task<Guid> SubmitAsync(ApprovalSubmission submission, CancellationToken ct = default);
}

/// <summary>
/// Module sở hữu đơn nhận kết quả duyệt. PHẢI idempotent (có thể bị gọi lại nếu lưu trạng thái đơn duyệt lỗi):
/// kiểm tra trạng thái bản ghi gốc trước khi áp dụng.
/// </summary>
public interface IApprovalHandler
{
    string Type { get; }
    Task OnApprovedAsync(Guid subjectId, CancellationToken ct);
    Task OnRejectedAsync(Guid subjectId, string? comment, CancellationToken ct);
    Task OnCancelledAsync(Guid subjectId, CancellationToken ct);
}
