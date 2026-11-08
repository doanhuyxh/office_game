using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.Modules.Approval.Contracts;
using OfficeHub.Modules.Finance.Domain;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Finance.Infrastructure;

internal sealed class FinanceClock(TimeProvider clock, IOptions<OfficeSettings> office)
{
    private readonly TimeZoneInfo _tz = TimeZoneInfo.FindSystemTimeZoneById(office.Value.TimeZone);
    public DateTimeOffset Now => clock.GetUtcNow();
    public DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), _tz).DateTime);
    public DateOnly ThisMonthStart => new(Today.Year, Today.Month, 1);
}

/// <summary>
/// Chặn endpoint nếu chức vụ của người gọi thiếu quyền tài chính. Vai trò admin / hr KHÔNG thay thế quyền này
/// (chủ dự án: chỉ giám đốc và kế toán xem tiền). Back-end là lớp bảo vệ duy nhất — menu FE chỉ để điều hướng.
/// </summary>
internal sealed class RequireFinanceFilter(FinancePermission required) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext ctx, EndpointFilterDelegate next)
    {
        var user = ctx.HttpContext.User;
        var access = ctx.HttpContext.RequestServices.GetRequiredService<IFinanceAccess>();
        var granted = user.GetUserId() is { } uid ? await access.GetAsync(uid, ctx.HttpContext.RequestAborted) : FinancePermission.None;
        return granted.Has(required)
            ? await next(ctx)
            : TypedResults.Problem("Bạn không có quyền tài chính cho thao tác này", statusCode: StatusCodes.Status403Forbidden);
    }
}

internal static class FinanceAuth
{
    public static TBuilder RequireFinance<TBuilder>(this TBuilder b, FinancePermission required) where TBuilder : IEndpointConventionBuilder =>
        b.AddEndpointFilter(new RequireFinanceFilter(required));
}

/// <summary>Nhận kết quả duyệt đề nghị chi. Idempotent: chỉ đổi khi đề nghị còn đúng trạng thái trước đó.</summary>
internal sealed class ExpenseApprovalHandler(FinanceDbContext db, IFinanceAccess access, INotifier notifier, ILogger<ExpenseApprovalHandler> log) : IApprovalHandler
{
    public string Type => ApprovalTypes.ExpenseRequest;

    public async Task OnApprovedAsync(Guid subjectId, CancellationToken ct)
    {
        var e = await db.Expenses.FirstOrDefaultAsync(x => x.Id == subjectId, ct);
        if (e is null || e.Status != ExpenseStatus.Pending) return;
        e.Status = ExpenseStatus.Approved;
        await db.SaveChangesAsync(ct);
        try
        {
            var recorders = await access.ListUserIdsAsync(FinancePermission.Record, ct);
            await notifier.NotifyAsync(new NotificationRequest(recorders, NotificationCategories.ExpenseReady,
                $"Đề nghị chi {LedgerRules.ExpenseCode(e.Number)} đã duyệt, chờ chi", $"{e.Amount:N0} đ · {e.Reason}", "/finance", SendEmail: false), ct);
        }
        catch (Exception ex) { log.LogWarning(ex, "Không gửi được thông báo chờ chi cho đề nghị {Id}", subjectId); }
    }

    public async Task OnRejectedAsync(Guid subjectId, string? comment, CancellationToken ct)
    {
        var e = await db.Expenses.FirstOrDefaultAsync(x => x.Id == subjectId, ct);
        if (e is null || e.Status != ExpenseStatus.Pending) return;
        e.Status = ExpenseStatus.Rejected;
        e.RejectReason = comment is { Length: > 500 } ? comment[..500] : comment;
        await db.SaveChangesAsync(ct);
    }

    public async Task OnCancelledAsync(Guid subjectId, CancellationToken ct)
    {
        var e = await db.Expenses.FirstOrDefaultAsync(x => x.Id == subjectId, ct);
        if (e is null || e.Status != ExpenseStatus.Pending) return;
        e.Status = ExpenseStatus.Cancelled;
        await db.SaveChangesAsync(ct);
    }
}
