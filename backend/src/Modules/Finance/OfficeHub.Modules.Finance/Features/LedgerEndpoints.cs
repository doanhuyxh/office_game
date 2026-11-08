using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Finance.Domain;
using OfficeHub.Modules.Finance.Infrastructure;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Finance.Features;

public sealed record EntryDto(Guid Id, TxKind Kind, DateOnly Date, long Amount, Guid AccountId, string AccountName, Guid? ToAccountId, string? ToAccountName,
    Guid? CategoryId, string? CategoryName, Guid? BusinessLineId, string? BusinessLineName, string? Counterparty, string? Description, string? InvoiceNumber,
    string? SourceType, Guid? SourceId, TxStatus Status, string? VoidReason, DateTimeOffset CreatedAt, string CreatedByName);
public sealed record CreateEntry(TxKind Kind, DateOnly Date, long Amount, Guid AccountId, Guid? ToAccountId = null, Guid? CategoryId = null, Guid? BusinessLineId = null,
    string? Counterparty = null, string? Description = null, string? InvoiceNumber = null);
public sealed record VoidEntry(string? Reason);
public sealed record LineSummary(Guid? BusinessLineId, string Name, long Income, long Expense);
public sealed record OverviewDto(long TotalBalance, List<AccountDto> Accounts, DateOnly MonthStart, long MonthIncome, long MonthExpense, List<LineSummary> ByLine,
    int ExpensePending, long ExpensePendingAmount, int ExpenseAwaitingPayment, long ExpenseAwaitingAmount, DateOnly? LockedThrough);

/// <summary>Sổ thu chi + tổng quan. Mọi thứ ở đây cần quyền tài chính (Xem để đọc, Ghi sổ để ghi / huỷ).</summary>
internal static class LedgerEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/overview", OverviewAsync).RequireFinance(FinancePermission.View);
        g.MapGet("/entries", ListAsync).RequireFinance(FinancePermission.View);
        g.MapPost("/entries", CreateAsync).RequireFinance(FinancePermission.Record);
        g.MapPost("/entries/{id:guid}/void", VoidAsync).RequireFinance(FinancePermission.Record);
    }

    private static async Task<Ok<OverviewDto>> OverviewAsync(FinanceDbContext db, FinanceClock clock, CancellationToken ct)
    {
        var accounts = await FinanceQueries.AccountsAsync(db, ct);
        var from = clock.ThisMonthStart;
        var month = await db.Entries.AsNoTracking().Where(e => e.Status == TxStatus.Active && e.Kind != TxKind.Transfer && e.Date >= from)
            .GroupBy(e => new { e.BusinessLineId, e.Kind }).Select(g => new { g.Key.BusinessLineId, g.Key.Kind, Sum = g.Sum(e => e.Amount) }).ToListAsync(ct);
        var lines = await db.Lines.AsNoTracking().ToDictionaryAsync(l => l.Id, l => l.Name, ct);
        var byLine = month.GroupBy(m => m.BusinessLineId).Select(g => new LineSummary(g.Key, g.Key is { } id && lines.TryGetValue(id, out var n) ? n : "Chưa gắn mảng",
            g.Where(x => x.Kind == TxKind.Income).Sum(x => x.Sum), g.Where(x => x.Kind == TxKind.Expense).Sum(x => x.Sum))).OrderByDescending(x => x.Income + x.Expense).ToList();
        var pending = await db.Expenses.AsNoTracking().Where(x => x.Status == ExpenseStatus.Pending).GroupBy(_ => 1).Select(g => new { N = g.Count(), S = g.Sum(x => x.Amount) }).FirstOrDefaultAsync(ct);
        var ready = await db.Expenses.AsNoTracking().Where(x => x.Status == ExpenseStatus.Approved).GroupBy(_ => 1).Select(g => new { N = g.Count(), S = g.Sum(x => x.Amount) }).FirstOrDefaultAsync(ct);
        var locked = (await db.Settings.AsNoTracking().FirstOrDefaultAsync(ct))?.LockedThrough;
        return TypedResults.Ok(new OverviewDto(accounts.Where(a => a.IsActive).Sum(a => a.Balance), accounts, from, byLine.Sum(x => x.Income), byLine.Sum(x => x.Expense), byLine,
            pending?.N ?? 0, pending?.S ?? 0, ready?.N ?? 0, ready?.S ?? 0, locked));
    }

    private static async Task<Ok<PagedResult<EntryDto>>> ListAsync(FinanceDbContext db, DateOnly? from, DateOnly? to, TxKind? kind, Guid? accountId, Guid? lineId, Guid? categoryId,
        bool? voided, string? search, int page, int? pageSize, CancellationToken ct)
    {
        var q = db.Entries.AsNoTracking().AsQueryable();
        if (from is { } f) q = q.Where(e => e.Date >= f);
        if (to is { } t) q = q.Where(e => e.Date <= t);
        if (kind is { } k) q = q.Where(e => e.Kind == k);
        if (accountId is { } a) q = q.Where(e => e.AccountId == a || e.ToAccountId == a);
        if (lineId is { } l) q = q.Where(e => e.BusinessLineId == l);
        if (categoryId is { } c) q = q.Where(e => e.CategoryId == c);
        q = voided == true ? q.Where(e => e.Status == TxStatus.Voided) : q.Where(e => e.Status == TxStatus.Active);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = $"%{search.Trim()}%";
            q = q.Where(e => EF.Functions.ILike(e.Description ?? "", s) || EF.Functions.ILike(e.Counterparty ?? "", s) || EF.Functions.ILike(e.InvoiceNumber ?? "", s));
        }
        var paged = await q.OrderByDescending(e => e.Date).ThenByDescending(e => e.CreatedAt).ThenBy(e => e.Id).ToPagedAsync(page < 1 ? 1 : page, pageSize, ct);
        var names = await FinanceQueries.NamesAsync(db, ct);
        return TypedResults.Ok(paged.Map(e => ToDto(e, names)));
    }

    internal static EntryDto ToDto(LedgerEntry e, FinanceQueries.Names n) => new(e.Id, e.Kind, e.Date, e.Amount, e.AccountId, n.Account(e.AccountId)!, e.ToAccountId, n.Account(e.ToAccountId),
        e.CategoryId, n.Category(e.CategoryId), e.BusinessLineId, n.Line(e.BusinessLineId), e.Counterparty, e.Description, e.InvoiceNumber, e.SourceType, e.SourceId,
        e.Status, e.VoidReason, e.CreatedAt, e.CreatedByName);

    private static async Task<Results<Created<Guid>, ValidationProblem>> CreateAsync(CreateEntry r, ClaimsPrincipal user, FinanceDbContext db, FinanceClock clock, CancellationToken ct)
    {
        var v = await ValidateAsync(r, db, clock, ct);
        if (v.Failed) return v.Problem();
        var e = Build(r, user, clock.Now);
        db.Entries.Add(e);
        await db.SaveChangesAsync(ct);
        return TypedResults.Created($"/api/finance/entries/{e.Id}", e.Id);
    }

    internal static LedgerEntry Build(CreateEntry r, ClaimsPrincipal user, DateTimeOffset now) =>
        Build(r, user.GetUserId() ?? Guid.Empty, user.FindFirstValue(ClaimNames.FullName) ?? user.Identity?.Name ?? "?", now);

    internal static LedgerEntry Build(CreateEntry r, Guid userId, string userName, DateTimeOffset now) => new()
    {
        Kind = r.Kind, Date = r.Date, Amount = r.Amount, AccountId = r.AccountId, ToAccountId = r.Kind == TxKind.Transfer ? r.ToAccountId : null,
        CategoryId = r.Kind == TxKind.Transfer ? null : r.CategoryId, BusinessLineId = r.BusinessLineId,
        Counterparty = Clean(r.Counterparty), Description = Clean(r.Description), InvoiceNumber = Clean(r.InvoiceNumber),
        CreatedAt = now, CreatedByUserId = userId, CreatedByName = userName,
    };

    /// <summary>Quy tắc thuần (<see cref="LedgerRules.Validate"/>) + kiểm tra dữ liệu tham chiếu (quỹ / danh mục / mảng còn dùng, ngày không trước ngày đầu kỳ).</summary>
    internal static async Task<Validation> ValidateAsync(CreateEntry r, FinanceDbContext db, FinanceClock clock, CancellationToken ct)
    {
        var v = new Validation()
            .MaxLength(r.Counterparty, 200, "counterparty", "Đối tác").MaxLength(r.Description, 1000, "description", "Diễn giải").MaxLength(r.InvoiceNumber, 50, "invoiceNumber", "Số hoá đơn");
        var locked = (await db.Settings.AsNoTracking().FirstOrDefaultAsync(ct))?.LockedThrough;
        foreach (var (field, message) in LedgerRules.Validate(r.Kind, r.Amount, r.AccountId, r.ToAccountId, r.Date, clock.Today, locked)) v.Add(field, message);

        async Task CheckAccountAsync(Guid? id, string field)
        {
            if (id is not { } aid || aid == Guid.Empty || v.Has(field)) return;
            var acc = await db.Accounts.AsNoTracking().FirstOrDefaultAsync(x => x.Id == aid, ct);
            if (acc is null) v.Add(field, "Quỹ / tài khoản không tồn tại");
            else if (!acc.IsActive) v.Add(field, "Quỹ / tài khoản đã đóng");
            else if (r.Date < acc.OpeningDate && !v.Has("date")) v.Add("date", $"Ngày trước ngày đầu kỳ của \"{acc.Name}\" ({acc.OpeningDate:dd/MM/yyyy})");
        }
        await CheckAccountAsync(r.AccountId, "accountId");
        await CheckAccountAsync(r.ToAccountId, "toAccountId");

        if (r.Kind != TxKind.Transfer && r.CategoryId is { } cid)
        {
            var cat = await db.Categories.AsNoTracking().FirstOrDefaultAsync(x => x.Id == cid, ct);
            if (cat is null || !cat.IsActive) v.Add("categoryId", "Danh mục không tồn tại hoặc đã ngừng");
            else if (!LedgerRules.CategoryMatches(r.Kind, cat.Kind)) v.Add("categoryId", "Danh mục không cùng loại thu / chi");
        }
        if (r.BusinessLineId is { } lid && !await db.Lines.AnyAsync(x => x.Id == lid && x.IsActive, ct)) v.Add("businessLineId", "Mảng kinh doanh không tồn tại hoặc đã ngừng");
        return v;
    }

    private static async Task<Results<NoContent, NotFound, ValidationProblem, ProblemHttpResult>> VoidAsync(Guid id, VoidEntry r, ClaimsPrincipal user,
        FinanceDbContext db, FinanceClock clock, CancellationToken ct)
    {
        var e = await db.Entries.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (e is null) return TypedResults.NotFound();
        if (e.Status == TxStatus.Voided) return Problems.Conflict("Giao dịch đã được huỷ");
        if (string.IsNullOrWhiteSpace(r.Reason)) return new Validation().Add("reason", "Nhập lý do huỷ").Problem();
        var locked = (await db.Settings.AsNoTracking().FirstOrDefaultAsync(ct))?.LockedThrough;
        if (LedgerRules.IsLocked(e.Date, locked)) return Problems.Conflict($"Sổ đã khoá đến hết {locked:dd/MM/yyyy}, không huỷ được giao dịch trong kỳ này");
        e.Status = TxStatus.Voided;
        e.VoidReason = r.Reason.Trim().Length > 500 ? r.Reason.Trim()[..500] : r.Reason.Trim();
        e.VoidedAt = clock.Now;
        e.VoidedByName = user.FindFirstValue(ClaimNames.FullName) ?? user.Identity?.Name ?? "?";
        // Huỷ giao dịch chi theo đề nghị → đề nghị trở lại "Đã duyệt" để chi lại (xem LedgerRules.AfterPaymentVoided).
        if (e.SourceType == ExpenseEndpoints.SourceType && e.SourceId is { } sid && await db.Expenses.FirstOrDefaultAsync(x => x.Id == sid, ct) is { } exp)
        {
            exp.Status = LedgerRules.AfterPaymentVoided(exp.Status);
            if (exp.Status == ExpenseStatus.Approved) { exp.PaidEntryId = null; exp.PaidAt = null; }
        }
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}

internal static class FinanceQueries
{
    /// <summary>Số dư = đầu kỳ + thu − chi − chuyển đi + chuyển đến (dòng đã huỷ không tính) — khớp <see cref="LedgerRules.Effect"/>.</summary>
    public static async Task<List<AccountDto>> AccountsAsync(FinanceDbContext db, CancellationToken ct)
    {
        var accounts = await db.Accounts.AsNoTracking().OrderBy(a => a.SortOrder).ThenBy(a => a.Name).ToListAsync(ct);
        var own = await db.Entries.AsNoTracking().Where(e => e.Status == TxStatus.Active).GroupBy(e => new { e.AccountId, e.Kind })
            .Select(g => new { g.Key.AccountId, g.Key.Kind, Sum = g.Sum(e => e.Amount) }).ToListAsync(ct);
        var incoming = await db.Entries.AsNoTracking().Where(e => e.Status == TxStatus.Active && e.Kind == TxKind.Transfer && e.ToAccountId != null)
            .GroupBy(e => e.ToAccountId!.Value).Select(g => new { Id = g.Key, Sum = g.Sum(e => e.Amount) }).ToDictionaryAsync(x => x.Id, x => x.Sum, ct);
        return accounts.Select(a =>
        {
            var sum = own.Where(o => o.AccountId == a.Id).Sum(o => o.Kind == TxKind.Income ? o.Sum : -o.Sum); // Income +, Expense −, Transfer đi −
            return new AccountDto(a.Id, a.Name, a.Kind, a.BankName, a.Last4, a.OpeningBalance, a.OpeningDate, a.OpeningBalance + sum + incoming.GetValueOrDefault(a.Id), a.IsActive, a.SortOrder);
        }).ToList();
    }

    public sealed class Names(Dictionary<Guid, string> accounts, Dictionary<Guid, string> categories, Dictionary<Guid, string> lines)
    {
        public string? Account(Guid? id) => id is { } i && accounts.TryGetValue(i, out var n) ? n : null;
        public string? Category(Guid? id) => id is { } i && categories.TryGetValue(i, out var n) ? n : null;
        public string? Line(Guid? id) => id is { } i && lines.TryGetValue(i, out var n) ? n : null;
    }

    public static async Task<Names> NamesAsync(FinanceDbContext db, CancellationToken ct) => new(
        await db.Accounts.AsNoTracking().ToDictionaryAsync(x => x.Id, x => x.Name, ct),
        await db.Categories.AsNoTracking().ToDictionaryAsync(x => x.Id, x => x.Name, ct),
        await db.Lines.AsNoTracking().ToDictionaryAsync(x => x.Id, x => x.Name, ct));
}
