using OfficeHub.Modules.Approval.Contracts;
using OfficeHub.Modules.Approval.Domain;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Approval.Infrastructure;

internal sealed class ApprovalService(ApprovalDbContext db, IEmployeeDirectory dir, TimeProvider clock, ApprovalNotifications notify) : IApprovalService
{
    public async Task<Guid> SubmitAsync(ApprovalSubmission s, CancellationToken ct = default)
    {
        var requester = await dir.GetAsync(s.RequesterEmployeeId, ct)
                        ?? throw new InvalidOperationException("Không tìm thấy nhân viên gửi đơn");
        var request = new ApprovalRequest
        {
            Type = s.Type, SubjectId = s.SubjectId, RequesterEmployeeId = s.RequesterEmployeeId,
            Title = s.Title, Summary = s.Summary, Status = RequestStatus.Pending, CreatedAt = clock.GetUtcNow(),
        };
        var order = 0;
        foreach (var kind in s.Steps.Distinct())
        {
            Guid? approver = null;
            if (kind == ApprovalStepKind.Manager)
            {
                // Không có quản lý (hoặc quản lý đã nghỉ) → bỏ bước này, chuyển thẳng HR.
                if (requester.ManagerId is not { } mid || await dir.GetAsync(mid, ct) is not { IsActive: true }) continue;
                approver = mid;
            }
            request.Steps.Add(new ApprovalStep
            {
                Order = order, Kind = kind, ApproverEmployeeId = approver,
                Status = order == 0 ? StepStatus.Pending : StepStatus.Waiting,
            });
            order++;
        }
        if (request.Steps.Count == 0)
            request.Steps.Add(new ApprovalStep { Order = 0, Kind = ApprovalStepKind.Hr, Status = StepStatus.Pending });
        db.Requests.Add(request);
        await db.SaveChangesAsync(ct);
        await notify.SubmittedAsync(request, ct); // không ném lỗi
        return request.Id;
    }
}
