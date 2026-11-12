using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Finance.Contracts;
using OfficeHub.Modules.Projects.Contracts;
using OfficeHub.Modules.Sales.Domain;
using OfficeHub.Modules.Sales.Infrastructure;

namespace OfficeHub.Modules.Sales.Features;

public sealed record ContractDto(Guid Id, string Code, Guid CustomerId, string CustomerName, string Title, Guid? BusinessLineId, long TotalValue, BillingKind Billing,
    ContractStatus Status, DateOnly SignedOn, DateOnly? EndOn, Guid OwnerEmployeeId, string OwnerName, long Scheduled, long Collected, long Outstanding, long Overdue);
public sealed record CollectionDto(Guid Id, DateOnly Date, long Amount, bool Active, string CreatedByName, DateTimeOffset CreatedAt);
public sealed record InstallmentDto(Guid Id, int Order, string Title, DateOnly DueOn, long Amount, long Collected, long Remaining, InstallmentState State, string? AgingBucket,
    string? CancelReason, List<CollectionDto> Collections, Guid? AppendixId);
/// <param name="ValueBeforeTax">Hiện tại (đã gồm phụ lục). Gốc: <paramref name="OriginalValueBeforeTax"/> / <paramref name="OriginalTotalValue"/>.</param>
/// <param name="PendingChangeRequests">CR có tính tiền đã được khách đồng ý, chưa lập phụ lục (dự án sở hữu hợp đồng).</param>
public sealed record ContractDetail(ContractDto Contract, long ValueBeforeTax, int VatRate, string? Note, Guid? OpportunityId, List<InstallmentDto> Installments,
    bool CanEdit, bool CanCollect, long OriginalValueBeforeTax, long OriginalTotalValue, List<AppendixDto> Appendices, List<ChangeRequestRef> PendingChangeRequests);
public sealed record InstallmentInput(string Title, DateOnly DueOn, long Amount);
public sealed record CreateContract(string Code, Guid CustomerId, string Title, long ValueBeforeTax, int VatRate, DateOnly SignedOn, BillingKind Billing,
    List<InstallmentInput> Installments, DateOnly? EndOn = null, Guid? OpportunityId = null, Guid? BusinessLineId = null, string? Note = null, Guid? QuoteId = null);
public sealed record UpdateContract(string Title, ContractStatus Status, DateOnly? EndOn = null, string? Note = null);
public sealed record CancelInstallment(string? Reason);
public sealed record CollectRequest(long Amount, DateOnly Date, Guid AccountId, Guid? CategoryId = null, string? InvoiceNumber = null);
public sealed record ReceivableItem(Guid InstallmentId, Guid ContractId, string ContractCode, Guid CustomerId, string CustomerName, string OwnerName, string Title, DateOnly DueOn,
    long Amount, long Collected, long Remaining, InstallmentState State, string? AgingBucket);
public sealed record ReceivablesDto(long Outstanding, long Overdue, long DueSoon, Dictionary<string, long> Buckets, List<ReceivableItem> Items);

/// <summary>
/// Hợp đồng bán + lịch thu + ghi nhận tiền khách trả. Ghi nhận thu = dòng THU ở sổ Finance (<see cref="IFinanceLedger"/>), chỉ người có quyền Ghi sổ.
/// Số đã thu luôn tính từ dòng sổ còn hiệu lực (<see cref="CollectedCalculator"/>).
/// </summary>
internal static class ContractEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/contracts", ListAsync);
        g.MapGet("/contracts/{id:guid}", GetAsync);
        g.MapPost("/contracts", CreateAsync);
        g.MapPut("/contracts/{id:guid}", UpdateAsync);
        g.MapPost("/contracts/{id:guid}/installments", AddInstallmentAsync);
        g.MapPost("/installments/{id:guid}/cancel", CancelInstallmentAsync);
        g.MapPost("/installments/{id:guid}/collect", CollectAsync);
        g.MapGet("/receivables", ReceivablesAsync);
    }

    private static IQueryable<SalesContract> Full(SalesDbContext db) =>
        db.Contracts.Include(x => x.Installments).ThenInclude(i => i.Collections).Include(x => x.Appendices).AsSplitQuery();

    internal static async Task<List<ContractDto>> ToDtosAsync(IReadOnlyList<SalesContract> rows, SalesDbContext db, SalesAccess access, CollectedCalculator calc,
        DateOnly today, CancellationToken ct)
    {
        var all = rows.SelectMany(r => r.Installments).ToList();
        var collected = await calc.ByInstallmentAsync(all, ct);
        var names = await db.Customers.AsNoTracking().Where(c => rows.Select(r => r.CustomerId).Contains(c.Id)).ToDictionaryAsync(c => c.Id, c => c.Name, ct);
        var emps = await access.EmployeesAsync(ct);
        return rows.Select(c =>
        {
            var live = c.Installments.Where(i => !i.Cancelled).ToList();
            var got = live.Sum(i => collected[i.Id]);
            var overdue = live.Where(i => i.DueOn < today).Sum(i => Math.Max(0, i.Amount - collected[i.Id]));
            return new ContractDto(c.Id, c.Code, c.CustomerId, names.GetValueOrDefault(c.CustomerId, "?"), c.Title, c.BusinessLineId, c.TotalValue, c.Billing, c.Status,
                c.SignedOn, c.EndOn, c.OwnerEmployeeId, emps.TryGetValue(c.OwnerEmployeeId, out var e) ? e.FullName : "(không rõ)", live.Sum(i => i.Amount), got,
                live.Sum(i => Math.Max(0, i.Amount - collected[i.Id])), overdue);
        }).ToList();
    }

    private static async Task<Ok<PagedResult<ContractDto>>> ListAsync(ClaimsPrincipal user, SalesDbContext db, SalesAccess access, CollectedCalculator calc, SalesClock clock,
        Guid? customerId, ContractStatus? status, string? search, int page, int? pageSize, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var q = Full(db).AsNoTracking().AsQueryable();
        if (!v.SeeAll) { var owners = v.Owners.ToList(); q = q.Where(c => owners.Contains(c.OwnerEmployeeId)); }
        if (customerId is { } cid) q = q.Where(c => c.CustomerId == cid);
        if (status is { } s) q = q.Where(c => c.Status == s);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var p = Like.Contains(search);
            q = q.Where(c => EF.Functions.ILike(c.Code, p) || EF.Functions.ILike(c.Title, p) || db.Customers.Any(x => x.Id == c.CustomerId && EF.Functions.ILike(x.Name, p)));
        }
        var paged = await q.OrderByDescending(c => c.SignedOn).ThenByDescending(c => c.CreatedAt).ThenBy(c => c.Id).ToPagedAsync(page < 1 ? 1 : page, pageSize, ct);
        return TypedResults.Ok(paged.With(await ToDtosAsync(paged.Items, db, access, calc, clock.Today, ct)));
    }

    private static async Task<Results<Ok<ContractDetail>, NotFound>> GetAsync(Guid id, ClaimsPrincipal user, SalesDbContext db, SalesAccess access, CollectedCalculator calc,
        SalesClock clock, IProjectDirectory projects, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var c = await Full(db).AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (c is null || !v.CanSee(c.OwnerEmployeeId)) return TypedResults.NotFound();
        return TypedResults.Ok(await DetailAsync(c, v, db, access, calc, projects, clock.Today, ct));
    }

    private static async Task<ContractDetail> DetailAsync(SalesContract c, SalesViewer v, SalesDbContext db, SalesAccess access, CollectedCalculator calc,
        IProjectDirectory projects, DateOnly today, CancellationToken ct)
    {
        var dto = (await ToDtosAsync([c], db, access, calc, today, ct))[0];
        var cols = c.Installments.SelectMany(i => i.Collections).ToList();
        var active = await calc.ActiveCollectionIdsAsync(cols, ct);
        var items = c.Installments.OrderBy(i => i.Order).Select(i =>
        {
            var got = i.Collections.Where(x => active.Contains(x.Id)).Sum(x => x.Amount);
            var state = SalesRules.InstallmentStatus(i.Cancelled, i.Amount, got, i.DueOn, today);
            return new InstallmentDto(i.Id, i.Order, i.Title, i.DueOn, i.Amount, got, i.Cancelled ? 0 : Math.Max(0, i.Amount - got), state,
                state == InstallmentState.Overdue ? SalesRules.AgingBucket(i.DueOn, today) : null, i.CancelReason,
                [.. i.Collections.OrderBy(x => x.CreatedAt).Select(x => new CollectionDto(x.Id, x.Date, x.Amount, active.Contains(x.Id), x.CreatedByName, x.CreatedAt))], i.AppendixId);
        }).ToList();
        var live = c.Appendices.Where(a => !a.Cancelled).ToList();
        var canEdit = v.CanEdit(c.OwnerEmployeeId);
        return new ContractDetail(dto, c.ValueBeforeTax, c.VatRate, c.Note, c.OpportunityId, items, canEdit, v.CanCollect,
            c.ValueBeforeTax - live.Sum(a => a.ValueBeforeTaxDelta), c.TotalValue - live.Sum(a => a.TotalDelta), await AppendixEndpoints.ListForAsync(c, projects, ct),
            canEdit && c.Status == ContractStatus.Active ? await AppendixEndpoints.PendingChangeRequestsAsync(c.Id, db, projects, ct) : []);
    }

    private static async Task<Results<Created<Guid>, NotFound, ValidationProblem, ProblemHttpResult>> CreateAsync(CreateContract r, ClaimsPrincipal user, SalesDbContext db,
        SalesAccess access, SalesClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var cust = await db.Customers.AsNoTracking().FirstOrDefaultAsync(x => x.Id == r.CustomerId, ct);
        if (cust is null || !v.CanSee(cust.OwnerEmployeeId)) return TypedResults.NotFound();
        if (!v.CanEdit(cust.OwnerEmployeeId)) return CustomerEndpoints.Forbidden();
        var val = new Validation().Required(r.Code, "code", "Số hợp đồng").MaxLength(r.Code, 50, "code", "Số hợp đồng")
            .Required(r.Title, "title", "Tên hợp đồng").MaxLength(r.Title, 300, "title", "Tên hợp đồng").MaxLength(r.Note, 2000, "note", "Ghi chú")
            .When(r.ValueBeforeTax < 1 || r.ValueBeforeTax > SalesRules.MaxAmount, "valueBeforeTax", "Giá trị hợp đồng không hợp lệ")
            .When(!SalesRules.VatRates.Contains(r.VatRate), "vatRate", "Thuế suất VAT chỉ 0, 5, 8 hoặc 10 %")
            .When(r.EndOn is { } end && end < r.SignedOn, "endOn", "Ngày kết thúc trước ngày ký")
            .When(r.SignedOn > clock.Today, "signedOn", "Ngày ký không ở tương lai");
        if (!string.IsNullOrWhiteSpace(r.Code) && await db.Contracts.AnyAsync(x => x.Code == r.Code.Trim(), ct)) val.Add("code", "Số hợp đồng đã tồn tại");
        Opportunity? opp = null;
        if (r.OpportunityId is { } oid)
        {
            opp = await db.Opportunities.FirstOrDefaultAsync(o => o.Id == oid, ct);
            if (opp is null || opp.CustomerId != r.CustomerId) val.Add("opportunityId", "Cơ hội không thuộc khách này");
            else if (opp.Stage == OpportunityStage.Lost) val.Add("opportunityId", "Cơ hội đã thua");
        }
        // Lập từ báo giá: cùng khách, báo giá đã chốt / đã gửi / khách đồng ý, chưa có hợp đồng → báo giá thành "Khách đồng ý".
        Quote? quote = null;
        if (r.QuoteId is { } qid)
        {
            quote = await db.Quotes.FirstOrDefaultAsync(x => x.Id == qid, ct);
            if (quote is null || quote.CustomerId != r.CustomerId) val.Add("quoteId", "Báo giá không thuộc khách này");
            else if (quote.ContractId is not null) val.Add("quoteId", "Báo giá đã có hợp đồng");
            else if (quote.Status is not (QuoteStatus.Ready or QuoteStatus.Sent or QuoteStatus.Accepted)) val.Add("quoteId", "Báo giá chưa chốt / đã bị thay / đã huỷ");
            // TEST-21: giá trị + VAT lấy theo báo giá đã chốt (chiết khấu đã qua duyệt quote_discount) — client gửi số khác → 400,
            // không lách duyệt chiết khấu bằng cách lập hợp đồng thấp hơn báo giá. Thay đổi giá sau ký → phụ lục.
            else if (r.ValueBeforeTax != quote.BeforeTax || r.VatRate != quote.VatRate)
                val.Add("valueBeforeTax", $"Giá trị trước thuế / VAT phải đúng như báo giá ({quote.BeforeTax:N0} đ, VAT {quote.VatRate}%) — đổi giá thì sửa báo giá (duyệt lại chiết khấu) hoặc lập phụ lục sau khi ký");
        }
        var total = SalesRules.Total(r.ValueBeforeTax, r.VatRate);
        var items = (r.Installments ?? []).Select(i => (i.Title?.Trim() ?? "", i.DueOn, i.Amount)).ToList();
        foreach (var err in SalesRules.ValidateSchedule(r.Billing, total, r.SignedOn, items)) val.Add("installments", err);
        if (val.Failed) return val.Problem();

        var c = new SalesContract
        {
            Code = r.Code.Trim(), CustomerId = r.CustomerId, OpportunityId = r.OpportunityId, BusinessLineId = r.BusinessLineId ?? opp?.BusinessLineId, Title = r.Title.Trim(),
            ValueBeforeTax = r.ValueBeforeTax, VatRate = r.VatRate, TotalValue = total, SignedOn = r.SignedOn, EndOn = r.EndOn, Billing = r.Billing,
            Status = ContractStatus.Active, Note = CustomerEndpoints.Clean(r.Note), OwnerEmployeeId = cust.OwnerEmployeeId, CreatedAt = clock.Now,
        };
        var order = 0;
        foreach (var (title, due, amount) in items.OrderBy(x => x.DueOn)) c.Installments.Add(new Installment { Title = title, DueOn = due, Amount = amount, Order = ++order });
        db.Contracts.Add(c);
        // Ký hợp đồng từ cơ hội → cơ hội Thắng.
        if (opp is { } o && o.Stage != OpportunityStage.Won) { o.Stage = OpportunityStage.Won; o.Probability = 100; o.ClosedAt = clock.Now; }
        if (quote is not null)
        {
            quote.ContractId = c.Id;
            if (quote.Status != QuoteStatus.Accepted) { quote.Status = QuoteStatus.Accepted; quote.DecidedOn = r.SignedOn; }
        }
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException) { return new Validation().Add("code", "Số hợp đồng đã tồn tại").Problem(); }
        return TypedResults.Created($"/api/sales/contracts/{c.Id}", c.Id);
    }

    private static async Task<Results<NoContent, NotFound, ValidationProblem, ProblemHttpResult>> UpdateAsync(Guid id, UpdateContract r, ClaimsPrincipal user, SalesDbContext db,
        SalesAccess access, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var c = await db.Contracts.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (c is null || !v.CanSee(c.OwnerEmployeeId)) return TypedResults.NotFound();
        if (!v.CanEdit(c.OwnerEmployeeId)) return CustomerEndpoints.Forbidden("Bạn không phụ trách hợp đồng này");
        var val = new Validation().Required(r.Title, "title", "Tên hợp đồng").MaxLength(r.Title, 300, "title", "Tên hợp đồng").MaxLength(r.Note, 2000, "note", "Ghi chú")
            .When(r.EndOn is { } end && end < c.SignedOn, "endOn", "Ngày kết thúc trước ngày ký");
        if (!SalesRules.CanChangeStatus(c.Status, r.Status))
            val.Add("status", c.Status == ContractStatus.Cancelled ? "Hợp đồng đã huỷ, không mở lại được — lập hợp đồng mới" : "Không chuyển được sang trạng thái này");
        if (val.Failed) return val.Problem();
        c.Title = r.Title.Trim(); c.EndOn = r.EndOn; c.Note = CustomerEndpoints.Clean(r.Note); c.Status = r.Status;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private static async Task<Results<Created<Guid>, NotFound, ValidationProblem, ProblemHttpResult>> AddInstallmentAsync(Guid id, InstallmentInput r, ClaimsPrincipal user,
        SalesDbContext db, SalesAccess access, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var c = await db.Contracts.Include(x => x.Installments).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (c is null || !v.CanSee(c.OwnerEmployeeId)) return TypedResults.NotFound();
        if (!v.CanEdit(c.OwnerEmployeeId)) return CustomerEndpoints.Forbidden("Bạn không phụ trách hợp đồng này");
        if (c.Status != ContractStatus.Active) return Problems.Conflict("Hợp đồng đã kết thúc / huỷ, không thêm đợt thu");
        var val = new Validation().Required(r.Title, "title", "Tên đợt").MaxLength(r.Title, 200, "title", "Tên đợt")
            .When(r.Amount < 1 || r.Amount > SalesRules.MaxAmount, "amount", "Số tiền không hợp lệ")
            .When(r.DueOn < c.SignedOn, "dueOn", "Hạn thu trước ngày ký");
        var scheduled = c.Installments.Where(i => !i.Cancelled).Sum(i => i.Amount);
        if (scheduled + r.Amount > c.TotalValue)
            val.Add("amount", $"Vượt giá trị hợp đồng: đã lên lịch {scheduled:N0} / {c.TotalValue:N0} đ (tăng giá trị: lập phụ lục)");
        if (val.Failed) return val.Problem();
        var i = new Installment { ContractId = id, Title = r.Title.Trim(), DueOn = r.DueOn, Amount = r.Amount, Order = c.Installments.Count + 1 };
        db.Installments.Add(i);
        await db.SaveChangesAsync(ct);
        return TypedResults.Created($"/api/sales/installments/{i.Id}", i.Id);
    }

    private static async Task<(Installment? Item, SalesContract? Contract)> LoadInstallmentAsync(Guid id, SalesDbContext db, CancellationToken ct)
    {
        var i = await db.Installments.Include(x => x.Collections).FirstOrDefaultAsync(x => x.Id == id, ct);
        return i is null ? (null, null) : (i, await db.Contracts.FirstOrDefaultAsync(c => c.Id == i.ContractId, ct));
    }

    private static async Task<Results<NoContent, NotFound, ValidationProblem, ProblemHttpResult>> CancelInstallmentAsync(Guid id, CancelInstallment r, ClaimsPrincipal user,
        SalesDbContext db, SalesAccess access, CollectedCalculator calc, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var (i, c) = await LoadInstallmentAsync(id, db, ct);
        if (i is null || c is null || !v.CanSee(c.OwnerEmployeeId)) return TypedResults.NotFound();
        if (!v.CanEdit(c.OwnerEmployeeId)) return CustomerEndpoints.Forbidden("Bạn không phụ trách hợp đồng này");
        if (i.Cancelled) return Problems.Conflict("Đợt thu đã huỷ");
        if (string.IsNullOrWhiteSpace(r.Reason)) return new Validation().Add("reason", "Nhập lý do huỷ đợt thu").Problem();
        if ((await calc.ActiveCollectionIdsAsync(i.Collections, ct)).Count > 0)
            return Problems.Conflict("Đợt này đã có tiền thu, không huỷ được (kế toán huỷ dòng thu ở sổ trước)");
        i.Cancelled = true;
        i.CancelReason = r.Reason.Trim().Length > 500 ? r.Reason.Trim()[..500] : r.Reason.Trim();
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private static async Task<Results<Created<Guid>, NotFound, ValidationProblem, ProblemHttpResult>> CollectAsync(Guid id, CollectRequest r, ClaimsPrincipal user,
        SalesDbContext db, SalesAccess access, CollectedCalculator calc, IFinanceLedger ledger, SalesClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        if (!v.CanCollect) return TypedResults.Problem("Chỉ người có quyền tài chính 'Ghi sổ' mới ghi nhận tiền thu", statusCode: StatusCodes.Status403Forbidden);
        var (i, c) = await LoadInstallmentAsync(id, db, ct);
        if (i is null || c is null) return TypedResults.NotFound();
        if (i.Cancelled) return Problems.Conflict("Đợt thu đã huỷ");
        var got = (await calc.ByInstallmentAsync([i], ct))[i.Id];
        var remaining = i.Amount - got;
        if (remaining <= 0) return Problems.Conflict("Đợt này đã thu đủ");
        if (r.Amount < 1 || r.Amount > remaining) return new Validation().Add("amount", $"Số tiền từ 1 đến {remaining:N0} đ (còn phải thu)").Problem();

        // Lưu lần thu trước (chưa có dòng sổ) → ghi sổ với SourceId = Id lần thu → gắn Id dòng sổ. Ghi sổ lỗi → xoá lần thu.
        // Nếu tiến trình chết giữa chừng, lần thu không có dòng sổ hiệu lực → không được tính (CollectedCalculator) → an toàn.
        var col = new Collection { InstallmentId = i.Id, Date = r.Date, Amount = r.Amount, CreatedAt = clock.Now, CreatedByName = v.Name };
        db.Collections.Add(col);
        await db.SaveChangesAsync(ct);
        var customer = await db.Customers.AsNoTracking().Where(x => x.Id == c.CustomerId).Select(x => x.Name).FirstOrDefaultAsync(ct);
        var res = await ledger.RecordIncomeAsync(new LedgerIncome(CollectedCalculator.SourceType, col.Id, r.Date, r.Amount, r.AccountId, r.CategoryId, c.BusinessLineId,
            customer, $"Thu HĐ {c.Code} – {i.Title}", r.InvoiceNumber, v.UserId, v.Name), ct);
        if (!res.Succeeded)
        {
            db.Collections.Remove(col);
            await db.SaveChangesAsync(CancellationToken.None);
            var val = new Validation();
            foreach (var (field, msg) in res.Errors) val.Add(field, msg);
            return val.Problem();
        }
        col.LedgerEntryId = res.EntryId!.Value;
        await db.SaveChangesAsync(ct);
        return TypedResults.Created($"/api/sales/collections/{col.Id}", col.Id);
    }

    /// <summary>Công nợ phải thu: đợt chưa thu đủ của hợp đồng đang hiệu lực mà người xem được thấy. <paramref name="state"/> lọc thêm.</summary>
    private static async Task<Ok<ReceivablesDto>> ReceivablesAsync(ClaimsPrincipal user, SalesDbContext db, SalesAccess access, CollectedCalculator calc, SalesClock clock,
        InstallmentState? state, Guid? ownerId, Guid? customerId, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var cq = db.Contracts.AsNoTracking().Where(c => c.Status == ContractStatus.Active);
        if (!v.SeeAll) { var owners = v.Owners.ToList(); cq = cq.Where(c => owners.Contains(c.OwnerEmployeeId)); }
        if (ownerId is { } o) cq = cq.Where(c => c.OwnerEmployeeId == o);
        if (customerId is { } cid) cq = cq.Where(c => c.CustomerId == cid);
        var contracts = await cq.ToDictionaryAsync(c => c.Id, ct);
        var ids = contracts.Keys.ToList();
        var items = await db.Installments.AsNoTracking().Include(i => i.Collections).Where(i => ids.Contains(i.ContractId) && !i.Cancelled).ToListAsync(ct);
        var collected = await calc.ByInstallmentAsync(items, ct);
        var names = await db.Customers.AsNoTracking().Where(c => contracts.Values.Select(x => x.CustomerId).Contains(c.Id)).ToDictionaryAsync(c => c.Id, c => c.Name, ct);
        var emps = await access.EmployeesAsync(ct);
        var today = clock.Today;
        var rows = items.Select(i =>
        {
            var c = contracts[i.ContractId];
            var got = collected[i.Id];
            var st = SalesRules.InstallmentStatus(false, i.Amount, got, i.DueOn, today);
            return new ReceivableItem(i.Id, c.Id, c.Code, c.CustomerId, names.GetValueOrDefault(c.CustomerId, "?"),
                emps.TryGetValue(c.OwnerEmployeeId, out var e) ? e.FullName : "(không rõ)", i.Title, i.DueOn, i.Amount, got, Math.Max(0, i.Amount - got), st,
                st == InstallmentState.Overdue ? SalesRules.AgingBucket(i.DueOn, today) : null);
        }).Where(x => x.State != InstallmentState.Paid).ToList();
        var buckets = new[] { "1-30", "31-60", "61-90", ">90" }.ToDictionary(b => b, b => rows.Where(x => x.AgingBucket == b).Sum(x => x.Remaining));
        var shown = (state is { } s ? rows.Where(x => x.State == s) : rows).OrderBy(x => x.DueOn).Take(1000).ToList();
        return TypedResults.Ok(new ReceivablesDto(rows.Sum(x => x.Remaining), rows.Where(x => x.State == InstallmentState.Overdue).Sum(x => x.Remaining),
            rows.Where(x => x.State == InstallmentState.DueSoon).Sum(x => x.Remaining), buckets, shown));
    }
}
