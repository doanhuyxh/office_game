namespace OfficeHub.Modules.Projects.Domain;

/// <summary>Yêu cầu thay đổi (CR) — hàm thuần, test: tests/OfficeHub.Modules.Projects.Tests.</summary>
public static class ChangeRequestRules
{
    public static string Code(string projectCode, int number) => $"{projectCode}-CR{number}";

    /// <summary>
    /// Nháp → Đã gửi / Khách đồng ý (khách đồng ý miệng) / Từ chối / Huỷ; Đã gửi → Nháp (sửa lại) / Đồng ý / Từ chối / Huỷ.
    /// Đồng ý / Từ chối / Huỷ là trạng thái cuối (đồng ý đã cộng ngân sách + có thể đã lập phụ lục).
    /// </summary>
    public static bool CanMove(ChangeRequestStatus from, ChangeRequestStatus to) => (from, to) switch
    {
        (ChangeRequestStatus.Draft, ChangeRequestStatus.Sent or ChangeRequestStatus.Approved or ChangeRequestStatus.Rejected or ChangeRequestStatus.Cancelled) => true,
        (ChangeRequestStatus.Sent, ChangeRequestStatus.Draft or ChangeRequestStatus.Approved or ChangeRequestStatus.Rejected or ChangeRequestStatus.Cancelled) => true,
        _ => false,
    };

    public static bool IsEditable(ChangeRequestStatus s) => s is ChangeRequestStatus.Draft or ChangeRequestStatus.Sent;

    /// <summary>Ngày công cộng vào ngân sách khi khách đồng ý: chỉ khi dự án có ngân sách và CR có ước tính &gt; 0.</summary>
    public static decimal? BudgetAddition(decimal? budget, decimal? estimate) => budget is not null && estimate is > 0 ? estimate : null;
}
