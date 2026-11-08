using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Finance.Domain;
using OfficeHub.Modules.Finance.Infrastructure;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Finance.Features;

public sealed record LineDto(Guid Id, string Code, string Name, int SortOrder, bool IsActive);
public sealed record UpsertLine(string Code, string Name, int SortOrder = 0, bool IsActive = true);
public sealed record CategoryDto(Guid Id, string Name, CategoryKind Kind, int SortOrder, bool IsActive);
public sealed record UpsertCategory(string Name, CategoryKind Kind, int SortOrder = 0, bool IsActive = true);
public sealed record AccountDto(Guid Id, string Name, AccountKind Kind, string? BankName, string? Last4, long OpeningBalance, DateOnly OpeningDate, long Balance,
    bool IsActive, int SortOrder);
public sealed record UpsertAccount(string Name, AccountKind Kind, string? BankName, string? Last4, long OpeningBalance, DateOnly OpeningDate, bool IsActive = true, int SortOrder = 0);
public sealed record LockDto(DateOnly? LockedThrough);

/// <summary>Cấu hình sổ: mảng kinh doanh, quỹ / tài khoản, danh mục, khoá sổ. Đọc danh mục + mảng: ai cũng được (form đề nghị chi cần); còn lại cần quyền tài chính.</summary>
internal static class SetupEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/lines", ListLinesAsync);
        g.MapPost("/lines", CreateLineAsync).RequireFinance(FinancePermission.Admin);
        g.MapPut("/lines/{id:guid}", UpdateLineAsync).RequireFinance(FinancePermission.Admin);
        g.MapGet("/categories", ListCategoriesAsync);
        g.MapPost("/categories", CreateCategoryAsync).RequireFinance(FinancePermission.Admin);
        g.MapPut("/categories/{id:guid}", UpdateCategoryAsync).RequireFinance(FinancePermission.Admin);
        g.MapGet("/accounts", ListAccountsAsync).RequireFinance(FinancePermission.View);
        g.MapPost("/accounts", CreateAccountAsync).RequireFinance(FinancePermission.Admin);
        g.MapPut("/accounts/{id:guid}", UpdateAccountAsync).RequireFinance(FinancePermission.Admin);
        g.MapGet("/lock", GetLockAsync).RequireFinance(FinancePermission.View);
        g.MapPut("/lock", SetLockAsync).RequireFinance(FinancePermission.Admin);
    }

    // ---------- Mảng kinh doanh ----------
    private static async Task<Ok<List<LineDto>>> ListLinesAsync(FinanceDbContext db, CancellationToken ct) =>
        TypedResults.Ok(await db.Lines.AsNoTracking().OrderBy(x => x.SortOrder).ThenBy(x => x.Name)
            .Select(x => new LineDto(x.Id, x.Code, x.Name, x.SortOrder, x.IsActive)).ToListAsync(ct));

    private static async Task<Validation> ValidateLineAsync(UpsertLine r, Guid? selfId, FinanceDbContext db, CancellationToken ct)
    {
        var v = new Validation().Required(r.Code, "code", "Mã mảng").MaxLength(r.Code, 20, "code", "Mã mảng")
            .Required(r.Name, "name", "Tên mảng").MaxLength(r.Name, 100, "name", "Tên mảng");
        if (!string.IsNullOrWhiteSpace(r.Code) && await db.Lines.AnyAsync(x => x.Code == r.Code.Trim().ToUpper() && x.Id != selfId, ct)) v.Add("code", "Mã mảng đã tồn tại");
        return v;
    }

    private static async Task<Results<Created<Guid>, ValidationProblem>> CreateLineAsync(UpsertLine r, FinanceDbContext db, CancellationToken ct)
    {
        var v = await ValidateLineAsync(r, null, db, ct);
        if (v.Failed) return v.Problem();
        var x = new BusinessLine { Code = r.Code.Trim().ToUpper(), Name = r.Name.Trim(), SortOrder = r.SortOrder, IsActive = r.IsActive };
        db.Lines.Add(x);
        await db.SaveChangesAsync(ct);
        return TypedResults.Created($"/api/finance/lines/{x.Id}", x.Id);
    }

    private static async Task<Results<NoContent, NotFound, ValidationProblem>> UpdateLineAsync(Guid id, UpsertLine r, FinanceDbContext db, CancellationToken ct)
    {
        var x = await db.Lines.FindAsync([id], ct);
        if (x is null) return TypedResults.NotFound();
        var v = await ValidateLineAsync(r, id, db, ct);
        if (v.Failed) return v.Problem();
        x.Code = r.Code.Trim().ToUpper(); x.Name = r.Name.Trim(); x.SortOrder = r.SortOrder; x.IsActive = r.IsActive;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    // ---------- Danh mục ----------
    private static async Task<Ok<List<CategoryDto>>> ListCategoriesAsync(FinanceDbContext db, CancellationToken ct) =>
        TypedResults.Ok(await db.Categories.AsNoTracking().OrderBy(x => x.Kind).ThenBy(x => x.SortOrder).ThenBy(x => x.Name)
            .Select(x => new CategoryDto(x.Id, x.Name, x.Kind, x.SortOrder, x.IsActive)).ToListAsync(ct));

    private static async Task<Validation> ValidateCategoryAsync(UpsertCategory r, Guid? selfId, FinanceDbContext db, CancellationToken ct)
    {
        var v = new Validation().Required(r.Name, "name", "Tên danh mục").MaxLength(r.Name, 100, "name", "Tên danh mục");
        if (!string.IsNullOrWhiteSpace(r.Name) && await db.Categories.AnyAsync(x => x.Kind == r.Kind && x.Name == r.Name.Trim() && x.Id != selfId, ct))
            v.Add("name", "Danh mục đã tồn tại");
        return v;
    }

    private static async Task<Results<Created<Guid>, ValidationProblem>> CreateCategoryAsync(UpsertCategory r, FinanceDbContext db, CancellationToken ct)
    {
        var v = await ValidateCategoryAsync(r, null, db, ct);
        if (v.Failed) return v.Problem();
        var x = new TxCategory { Name = r.Name.Trim(), Kind = r.Kind, SortOrder = r.SortOrder, IsActive = r.IsActive };
        db.Categories.Add(x);
        await db.SaveChangesAsync(ct);
        return TypedResults.Created($"/api/finance/categories/{x.Id}", x.Id);
    }

    private static async Task<Results<NoContent, NotFound, ValidationProblem, ProblemHttpResult>> UpdateCategoryAsync(Guid id, UpsertCategory r, FinanceDbContext db, CancellationToken ct)
    {
        var x = await db.Categories.FindAsync([id], ct);
        if (x is null) return TypedResults.NotFound();
        if (x.Kind != r.Kind && await db.Entries.AnyAsync(e => e.CategoryId == id, ct))
            return Problems.Conflict("Danh mục đã có giao dịch, không đổi được loại thu / chi");
        var v = await ValidateCategoryAsync(r, id, db, ct);
        if (v.Failed) return v.Problem();
        x.Name = r.Name.Trim(); x.Kind = r.Kind; x.SortOrder = r.SortOrder; x.IsActive = r.IsActive;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    // ---------- Quỹ / tài khoản ----------
    private static async Task<Ok<List<AccountDto>>> ListAccountsAsync(FinanceDbContext db, CancellationToken ct) =>
        TypedResults.Ok(await FinanceQueries.AccountsAsync(db, ct));

    private static Validation ValidateAccount(UpsertAccount r)
    {
        var v = new Validation().Required(r.Name, "name", "Tên quỹ / tài khoản").MaxLength(r.Name, 100, "name", "Tên quỹ / tài khoản")
            .MaxLength(r.BankName, 100, "bankName", "Tên ngân hàng")
            .When(r.Last4 is { Length: > 0 } l && (l.Length != 4 || !l.All(char.IsDigit)), "last4", "Nhập đúng 4 số cuối tài khoản")
            .When(Math.Abs(r.OpeningBalance) > LedgerRules.MaxAmount, "openingBalance", "Số dư đầu kỳ quá lớn, kiểm tra lại số 0");
        return v;
    }

    private static async Task<Results<Created<Guid>, ValidationProblem>> CreateAccountAsync(UpsertAccount r, FinanceDbContext db, CancellationToken ct)
    {
        var v = ValidateAccount(r);
        if (!string.IsNullOrWhiteSpace(r.Name) && await db.Accounts.AnyAsync(x => x.Name == r.Name.Trim(), ct)) v.Add("name", "Tên quỹ / tài khoản đã tồn tại");
        if (v.Failed) return v.Problem();
        var x = new MoneyAccount
        {
            Name = r.Name.Trim(), Kind = r.Kind, BankName = Clean(r.BankName), Last4 = Clean(r.Last4), OpeningBalance = r.OpeningBalance,
            OpeningDate = r.OpeningDate, IsActive = r.IsActive, SortOrder = r.SortOrder,
        };
        db.Accounts.Add(x);
        await db.SaveChangesAsync(ct);
        return TypedResults.Created($"/api/finance/accounts/{x.Id}", x.Id);
    }

    private static async Task<Results<NoContent, NotFound, ValidationProblem, ProblemHttpResult>> UpdateAccountAsync(Guid id, UpsertAccount r, FinanceDbContext db, CancellationToken ct)
    {
        var x = await db.Accounts.FindAsync([id], ct);
        if (x is null) return TypedResults.NotFound();
        var v = ValidateAccount(r);
        if (!string.IsNullOrWhiteSpace(r.Name) && await db.Accounts.AnyAsync(a => a.Name == r.Name.Trim() && a.Id != id, ct)) v.Add("name", "Tên quỹ / tài khoản đã tồn tại");
        if (v.Failed) return v.Problem();
        // Số dư đầu kỳ chỉ sửa được khi quỹ chưa có giao dịch — đổi sau sẽ làm lệch mọi số dư đã báo cáo.
        if ((x.OpeningBalance != r.OpeningBalance || x.OpeningDate != r.OpeningDate)
            && await db.Entries.AnyAsync(e => e.AccountId == id || e.ToAccountId == id, ct))
            return Problems.Conflict("Quỹ đã có giao dịch, không sửa được số dư đầu kỳ / ngày đầu kỳ. Hãy ghi một giao dịch điều chỉnh.");
        x.Name = r.Name.Trim(); x.Kind = r.Kind; x.BankName = Clean(r.BankName); x.Last4 = Clean(r.Last4);
        x.OpeningBalance = r.OpeningBalance; x.OpeningDate = r.OpeningDate; x.IsActive = r.IsActive; x.SortOrder = r.SortOrder;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    // ---------- Khoá sổ ----------
    private static async Task<Ok<LockDto>> GetLockAsync(FinanceDbContext db, CancellationToken ct) =>
        TypedResults.Ok(new LockDto((await db.Settings.AsNoTracking().FirstOrDefaultAsync(ct))?.LockedThrough));

    private static async Task<Results<NoContent, ValidationProblem>> SetLockAsync(LockDto r, FinanceDbContext db, FinanceClock clock, CancellationToken ct)
    {
        if (r.LockedThrough is { } d && d > clock.Today) return new Validation().Add("lockedThrough", "Không khoá sổ đến ngày ở tương lai").Problem();
        var s = await db.Settings.FirstOrDefaultAsync(ct);
        if (s is null) db.Settings.Add(new FinanceSettings { LockedThrough = r.LockedThrough });
        else s.LockedThrough = r.LockedThrough;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
