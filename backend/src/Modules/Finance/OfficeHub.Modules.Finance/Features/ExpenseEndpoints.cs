using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Approval.Contracts;
using OfficeHub.Modules.Finance.Domain;
using OfficeHub.Modules.Finance.Infrastructure;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Organization.Contracts;
using OfficeHub.Modules.Projects.Contracts;

namespace OfficeHub.Modules.Finance.Features;

public sealed record ExpenseDto(Guid Id, string Code, Guid RequesterEmployeeId, string RequesterName, long Amount, string Reason, string? Payee, Guid? CategoryId, string? CategoryName,
    Guid? BusinessLineId, string? BusinessLineName, DateOnly? NeededBy, ExpenseStatus Status, Guid? ApprovalRequestId, string? RejectReason, Guid? PaidEntryId, DateTimeOffset? PaidAt,
    DateTimeOffset CreatedAt, Guid? ProjectId, string? ProjectName, int AttachmentCount = 0);
public sealed record CreateExpense(long Amount, string Reason, string? Payee = null, Guid? CategoryId = null, Guid? BusinessLineId = null, DateOnly? NeededBy = null,
    Guid? ProjectId = null);
public sealed record PayExpense(Guid AccountId, DateOnly Date, string? InvoiceNumber = null);

/// <summary>
/// Đề nghị chi: ai có hồ sơ nhân viên cũng gửi; duyệt [quản lý → người có quyền Duyệt chi] (mọi khoản chi đều phải duyệt — chủ dự án chốt 2026-11-08);
/// người có quyền Ghi sổ bấm "Đã chi" để sinh dòng sổ. Người gửi không tự duyệt (kể cả khi có quyền Duyệt chi) — luật chung của module Approval.
/// </summary>
internal static class ExpenseEndpoints
{
    public const string SourceType = "expense_request";

    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/expenses", ListAsync);
        g.MapPost("/expenses", CreateAsync);
        g.MapPost("/expenses/{id:guid}/pay", PayAsync).RequireFinance(FinancePermission.Record);
    }

    private static async Task<Results<Ok<PagedResult<ExpenseDto>>, ProblemHttpResult>> ListAsync(ClaimsPrincipal user, FinanceDbContext db, IEmployeeDirectory dir, IFinanceAccess access,
        IProjectDirectory projects, string? scope, ExpenseStatus? status, int page, int? pageSize, CancellationToken ct)
    {
        var all = string.Equals(scope, "all", StringComparison.OrdinalIgnoreCase);
        var q = db.Expenses.AsNoTracking().AsQueryable();
        if (all)
        {
            if (user.GetUserId() is not { } uid || !(await access.GetAsync(uid, ct)).Has(FinancePermission.View))
                return TypedResults.Problem("Bạn không có quyền tài chính cho thao tác này", statusCode: StatusCodes.Status403Forbidden);
        }
        else
        {
            var me = user.GetUserId() is { } u ? await dir.GetByUserIdAsync(u, ct) : null;
            if (me is null) return TypedResults.Ok(new PagedResult<ExpenseDto>([], 0, 1, pageSize ?? Paging.DefaultPageSize));
            q = q.Where(x => x.RequesterEmployeeId == me.Id);
        }
        if (status is { } s) q = q.Where(x => x.Status == s);
        var paged = await q.OrderByDescending(x => x.CreatedAt).ThenBy(x => x.Id).ToPagedAsync(page < 1 ? 1 : page, pageSize, ct);
        var names = await FinanceQueries.NamesAsync(db, projects, ct);
        var counts = await AttachmentEndpoints.CountsAsync(db, paged.Items.Select(x => x.Id).ToList(), ct);
        var people = new Dictionary<Guid, string>();
        foreach (var id in paged.Items.Select(x => x.RequesterEmployeeId).Distinct())
            people[id] = (await dir.GetAsync(id, ct))?.FullName ?? "(không rõ)";
        return TypedResults.Ok(paged.Map(x => ToDto(x, people, names) with { AttachmentCount = counts.GetValueOrDefault(x.Id) }));
    }

    private static ExpenseDto ToDto(ExpenseRequest x, Dictionary<Guid, string> people, FinanceQueries.Names n) => new(x.Id, LedgerRules.ExpenseCode(x.Number), x.RequesterEmployeeId,
        people.GetValueOrDefault(x.RequesterEmployeeId, "(không rõ)"), x.Amount, x.Reason, x.Payee, x.CategoryId, n.Category(x.CategoryId), x.BusinessLineId, n.Line(x.BusinessLineId),
        x.NeededBy, x.Status, x.ApprovalRequestId, x.RejectReason, x.PaidEntryId, x.PaidAt, x.CreatedAt, x.ProjectId, n.Project(x.ProjectId));

    private static async Task<Results<Created<Guid>, ValidationProblem, ProblemHttpResult>> CreateAsync(CreateExpense r, ClaimsPrincipal user, FinanceDbContext db, IEmployeeDirectory dir,
        IApprovalService approvals, FinanceClock clock, IProjectDirectory projects, IFinanceAccess access, CancellationToken ct)
    {
        var me = user.GetUserId() is { } uid ? await dir.GetByUserIdAsync(uid, ct) : null;
        if (me is null || !me.IsActive) return TypedResults.Problem("Chỉ nhân viên có hồ sơ mới gửi được đề nghị chi", statusCode: StatusCodes.Status403Forbidden);

        var v = new Validation().Required(r.Reason, "reason", "Lý do chi").MaxLength(r.Reason, 1000, "reason", "Lý do chi").MaxLength(r.Payee, 200, "payee", "Người / đơn vị nhận")
            .When(r.Amount < 1, "amount", "Số tiền phải lớn hơn 0")
            .When(r.Amount > LedgerRules.MaxAmount, "amount", "Số tiền quá lớn, kiểm tra lại số 0")
            .When(r.NeededBy is { } nb && nb < clock.Today, "neededBy", "Ngày cần chi không được ở quá khứ");
        if (r.CategoryId is { } cid)
        {
            var cat = await db.Categories.AsNoTracking().FirstOrDefaultAsync(x => x.Id == cid, ct);
            if (cat is null || !cat.IsActive || cat.Kind != CategoryKind.Expense) v.Add("categoryId", "Chọn danh mục chi hợp lệ");
        }
        if (r.BusinessLineId is { } lid && !await db.Lines.AnyAsync(x => x.Id == lid && x.IsActive, ct)) v.Add("businessLineId", "Mảng kinh doanh không tồn tại hoặc đã ngừng");
        if (r.ProjectId is { } pid)
        {
            // Gắn dự án: thành viên dự án, hoặc người có quyền Xem tài chính (giống danh sách GET /finance/projects).
            if (await projects.GetAsync(pid, ct) is not { IsActive: true }) v.Add("projectId", "Dự án không tồn tại hoặc đã đóng");
            else if (!(await projects.RolesOfAsync(me.Id, ct)).ContainsKey(pid) && !(await access.GetAsync(me.UserId ?? Guid.Empty, ct)).Has(FinancePermission.View))
                v.Add("projectId", "Bạn không tham gia dự án này");
        }
        if (v.Failed) return v.Problem();

        var e = new ExpenseRequest
        {
            RequesterEmployeeId = me.Id, Amount = r.Amount, Reason = r.Reason.Trim(), Payee = string.IsNullOrWhiteSpace(r.Payee) ? null : r.Payee.Trim(),
            CategoryId = r.CategoryId, BusinessLineId = r.BusinessLineId, ProjectId = r.ProjectId, NeededBy = r.NeededBy, Status = ExpenseStatus.Pending, CreatedAt = clock.Now,
        };
        db.Expenses.Add(e);
        await db.SaveChangesAsync(ct); // sinh Number
        try
        {
            e.ApprovalRequestId = await approvals.SubmitAsync(new ApprovalSubmission(ApprovalTypes.ExpenseRequest, e.Id, me.Id,
                $"Đề nghị chi {LedgerRules.ExpenseCode(e.Number)}: {e.Amount:N0} đ", $"{e.Reason}{(e.Payee is null ? "" : $" · Nhận: {e.Payee}")}",
                [ApprovalStepKind.Manager, ApprovalStepKind.Finance]), ct);
            await db.SaveChangesAsync(ct);
        }
        catch
        {
            db.Expenses.Remove(e);
            await db.SaveChangesAsync(CancellationToken.None);
            throw;
        }
        return TypedResults.Created($"/api/finance/expenses/{e.Id}", e.Id);
    }

    private static async Task<Results<NoContent, NotFound, ValidationProblem, ProblemHttpResult>> PayAsync(Guid id, PayExpense r, ClaimsPrincipal user, FinanceDbContext db, FinanceClock clock,
        IEmployeeDirectory dir, INotifier notifier, IProjectDirectory projects, CancellationToken ct)
    {
        var e = await db.Expenses.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (e is null) return TypedResults.NotFound();
        if (!LedgerRules.CanPay(e.Status))
            return Problems.Conflict(e.Status == ExpenseStatus.Paid ? "Đề nghị này đã được chi" : "Chỉ chi được đề nghị đã duyệt");

        var create = new CreateEntry(TxKind.Expense, r.Date, e.Amount, r.AccountId, null, e.CategoryId, e.BusinessLineId, e.Payee,
            $"Chi theo đề nghị {LedgerRules.ExpenseCode(e.Number)}: {e.Reason}", r.InvoiceNumber, e.ProjectId);
        var v = await LedgerEndpoints.ValidateAsync(create, db, clock, projects, ct);
        if (v.Failed) return v.Problem();

        var entry = LedgerEndpoints.Build(create, user, clock.Now);
        entry.SourceType = SourceType;
        entry.SourceId = e.Id;
        db.Entries.Add(entry);
        e.Status = ExpenseStatus.Paid;
        e.PaidEntryId = entry.Id;
        e.PaidAt = clock.Now;
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException) { return Problems.Conflict("Đề nghị này vừa được chi bởi người khác"); } // ux_entries_source

        try
        {
            if ((await dir.GetAsync(e.RequesterEmployeeId, ct))?.UserId is { } requester)
                await notifier.NotifyAsync(new NotificationRequest([requester], NotificationCategories.ExpensePaid,
                    $"Đề nghị chi {LedgerRules.ExpenseCode(e.Number)} đã được chi", $"{e.Amount:N0} đ · {e.Reason}", "/finance", SendEmail: false), ct);
        }
        catch { /* thông báo phụ — không làm hỏng việc ghi sổ */ }
        return TypedResults.NoContent();
    }
}
