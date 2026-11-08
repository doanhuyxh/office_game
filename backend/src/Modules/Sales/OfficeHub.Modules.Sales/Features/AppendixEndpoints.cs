using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Projects.Contracts;
using OfficeHub.Modules.Sales.Domain;
using OfficeHub.Modules.Sales.Infrastructure;

namespace OfficeHub.Modules.Sales.Features;

public sealed record AppendixDto(Guid Id, string Code, string Title, DateOnly SignedOn, long ValueBeforeTaxDelta, long TotalDelta, Guid? ChangeRequestId,
    string? ChangeRequestCode, string? Note, bool Cancelled, string? CancelReason, string CreatedByName, DateTimeOffset CreatedAt);
public sealed record CreateAppendix(string Code, string Title, DateOnly SignedOn, long ValueBeforeTaxDelta, List<InstallmentInput>? Installments = null,
    Guid? ChangeRequestId = null, string? Note = null);
public sealed record CancelAppendix(string? Reason);

/// <summary>
/// Phụ lục hợp đồng bán (giai đoạn 2b-2): tăng / giảm giá trị, kèm đợt thu mới, lập từ yêu cầu thay đổi (CR) đã được khách đồng ý của dự án sở hữu hợp đồng.
/// Quyền như sửa hợp đồng (người phụ trách / quản lý của họ / HR). Giá trị hợp đồng luôn là giá trị hiện tại → lãi / lỗ dự án tự gồm phụ lục.
/// </summary>
internal static class AppendixEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapPost("/contracts/{id:guid}/appendices", CreateAsync);
        g.MapPost("/appendices/{id:guid}/cancel", CancelAsync);
    }

    /// <summary>CR đã được khách đồng ý, có tính tiền, chưa có phụ lục còn hiệu lực — để chọn khi lập phụ lục.</summary>
    internal static async Task<List<ChangeRequestRef>> PendingChangeRequestsAsync(Guid contractId, SalesDbContext db, IProjectDirectory projects, CancellationToken ct)
    {
        var all = await projects.ChangeRequestsForContractAsync(contractId, ct);
        var ids = all.Select(c => c.Id).ToList();
        var used = (await db.Appendices.AsNoTracking().Where(a => a.ChangeRequestId != null && ids.Contains(a.ChangeRequestId.Value) && !a.Cancelled)
            .Select(a => a.ChangeRequestId!.Value).ToListAsync(ct)).ToHashSet();
        return all.Where(c => c.Status == "Approved" && c.Billable && !used.Contains(c.Id)).ToList();
    }

    internal static async Task<List<AppendixDto>> ListForAsync(SalesContract c, IProjectDirectory projects, CancellationToken ct)
    {
        var crs = c.Appendices.Any(a => a.ChangeRequestId != null) ? (await projects.ChangeRequestsForContractAsync(c.Id, ct)).ToDictionary(x => x.Id, x => x.Code) : [];
        return c.Appendices.OrderBy(a => a.SignedOn).ThenBy(a => a.CreatedAt).Select(a => new AppendixDto(a.Id, a.Code, a.Title, a.SignedOn, a.ValueBeforeTaxDelta, a.TotalDelta,
            a.ChangeRequestId, a.ChangeRequestId is { } cr ? crs.GetValueOrDefault(cr) : null, a.Note, a.Cancelled, a.CancelReason, a.CreatedByName, a.CreatedAt)).ToList();
    }

    private static async Task<Results<Created<Guid>, NotFound, ValidationProblem, ProblemHttpResult>> CreateAsync(Guid id, CreateAppendix r, ClaimsPrincipal user,
        SalesDbContext db, SalesAccess access, IProjectDirectory projects, SalesClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var c = await db.Contracts.Include(x => x.Installments).Include(x => x.Appendices).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (c is null || !v.CanSee(c.OwnerEmployeeId)) return TypedResults.NotFound();
        if (!v.CanEdit(c.OwnerEmployeeId)) return CustomerEndpoints.Forbidden("Bạn không phụ trách hợp đồng này");
        if (c.Status != ContractStatus.Active) return Problems.Conflict("Hợp đồng đã kết thúc / huỷ, không lập phụ lục");

        var code = r.Code?.Trim() ?? "";
        var val = new Validation().Required(code, "code", "Số phụ lục").MaxLength(code, 50, "code", "Số phụ lục")
            .Required(r.Title, "title", "Nội dung phụ lục").MaxLength(r.Title, 300, "title", "Nội dung phụ lục").MaxLength(r.Note, 2000, "note", "Ghi chú");
        if (code.Length > 0 && c.Appendices.Any(a => a.Code == code)) val.Add("code", "Số phụ lục đã có trong hợp đồng này");
        var totalDelta = SalesRules.Total(r.ValueBeforeTaxDelta, c.VatRate);
        var items = (r.Installments ?? []).Select(i => (i.Title?.Trim() ?? "", i.DueOn, i.Amount)).ToList();
        var scheduled = c.Installments.Where(i => !i.Cancelled).Sum(i => i.Amount);
        foreach (var (field, msg) in SalesRules.ValidateAppendix(r.ValueBeforeTaxDelta, totalDelta, c.ValueBeforeTax, c.TotalValue, scheduled, r.SignedOn, c.SignedOn,
                     clock.Today, items))
            val.Add(field, msg);
        if (r.ChangeRequestId is { } crId && !(await PendingChangeRequestsAsync(id, db, projects, ct)).Any(x => x.Id == crId))
            val.Add("changeRequestId", "Yêu cầu thay đổi không thuộc dự án của hợp đồng, chưa được khách đồng ý, không tính tiền hoặc đã có phụ lục");
        if (val.Failed) return val.Problem();

        var a = new ContractAppendix
        {
            ContractId = id, Code = code, Title = r.Title.Trim(), SignedOn = r.SignedOn, ValueBeforeTaxDelta = r.ValueBeforeTaxDelta, TotalDelta = totalDelta,
            ChangeRequestId = r.ChangeRequestId, Note = CustomerEndpoints.Clean(r.Note), CreatedAt = clock.Now, CreatedByName = v.Name,
        };
        db.Appendices.Add(a);
        c.ValueBeforeTax += r.ValueBeforeTaxDelta;
        c.TotalValue += totalDelta;
        var order = c.Installments.Count;
        foreach (var (title, due, amount) in items.OrderBy(x => x.DueOn))
            db.Installments.Add(new Installment { ContractId = id, AppendixId = a.Id, Title = title, DueOn = due, Amount = amount, Order = ++order });
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException) { return new Validation().Add("code", "Số phụ lục đã có, hoặc yêu cầu thay đổi vừa được lập phụ lục").Problem(); }
        return TypedResults.Created($"/api/sales/appendices/{a.Id}", a.Id);
    }

    /// <summary>Huỷ phụ lục: các đợt của nó chưa có tiền thu → huỷ các đợt + trừ lại giá trị. Giá trị mới vẫn phải ≥ các đợt còn lại.</summary>
    private static async Task<Results<NoContent, NotFound, ValidationProblem, ProblemHttpResult>> CancelAsync(Guid id, CancelAppendix r, ClaimsPrincipal user,
        SalesDbContext db, SalesAccess access, CollectedCalculator calc, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var a = await db.Appendices.FirstOrDefaultAsync(x => x.Id == id, ct);
        var c = a is null ? null : await db.Contracts.Include(x => x.Installments).ThenInclude(i => i.Collections).FirstOrDefaultAsync(x => x.Id == a.ContractId, ct);
        if (a is null || c is null || !v.CanSee(c.OwnerEmployeeId)) return TypedResults.NotFound();
        if (!v.CanEdit(c.OwnerEmployeeId)) return CustomerEndpoints.Forbidden("Bạn không phụ trách hợp đồng này");
        if (a.Cancelled) return Problems.Conflict("Phụ lục đã huỷ");
        if (c.Status != ContractStatus.Active) return Problems.Conflict("Hợp đồng đã kết thúc / huỷ");
        if (string.IsNullOrWhiteSpace(r.Reason)) return new Validation().Add("reason", "Nhập lý do huỷ phụ lục").Problem();
        var own = c.Installments.Where(i => i.AppendixId == a.Id && !i.Cancelled).ToList();
        if ((await calc.ActiveCollectionIdsAsync(own.SelectMany(i => i.Collections).ToList(), ct)).Count > 0)
            return Problems.Conflict("Đợt thu của phụ lục đã có tiền, không huỷ được (kế toán huỷ dòng thu ở sổ trước)");
        var newTotal = c.TotalValue - a.TotalDelta;
        var remaining = c.Installments.Where(i => !i.Cancelled && i.AppendixId != a.Id).Sum(i => i.Amount);
        if (c.ValueBeforeTax - a.ValueBeforeTaxDelta < 1 || newTotal < remaining)
            return Problems.Conflict($"Huỷ phụ lục làm giá trị hợp đồng ({newTotal:N0} đ) nhỏ hơn các đợt đang lên lịch ({remaining:N0} đ) — huỷ bớt đợt trước");
        var reason = r.Reason.Trim().Length > 500 ? r.Reason.Trim()[..500] : r.Reason.Trim();
        var text = $"Huỷ phụ lục {a.Code}: {reason}";
        foreach (var i in own) { i.Cancelled = true; i.CancelReason = text.Length > 500 ? text[..500] : text; }
        a.Cancelled = true;
        a.CancelReason = reason;
        c.ValueBeforeTax -= a.ValueBeforeTaxDelta;
        c.TotalValue = newTotal;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }
}
