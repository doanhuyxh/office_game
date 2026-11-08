using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Documents;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.BuildingBlocks.Storage;
using OfficeHub.Modules.Approval.Contracts;
using OfficeHub.Modules.Organization.Contracts;
using OfficeHub.Modules.Sales.Domain;
using OfficeHub.Modules.Sales.Infrastructure;

namespace OfficeHub.Modules.Sales.Features;

public sealed record QuoteLineDto(Guid Id, int Order, string Description, string? Unit, decimal Quantity, long UnitPrice, long Amount);
public sealed record QuoteDto(Guid Id, string Code, long Number, int Version, Guid CustomerId, string CustomerName, Guid? OpportunityId, string Title, DateOnly IssuedOn,
    DateOnly ValidUntil, int VatRate, decimal DiscountPercent, long Subtotal, long Discount, long BeforeTax, long Vat, long Total, QuoteStatus Status, bool Expired,
    Guid OwnerEmployeeId, string OwnerName, Guid? ContractId, DateTimeOffset CreatedAt);
public sealed record QuoteVersionRef(Guid Id, int Version, QuoteStatus Status, long Total, DateTimeOffset CreatedAt);
public sealed record QuoteDetail(QuoteDto Quote, List<QuoteLineDto> Lines, string? Terms, string? Note, Guid? BusinessLineId, Guid? ApprovalRequestId, string? ApprovalComment,
    DateTimeOffset? SentAt, DateOnly? DecidedOn, string? DecisionNote, bool CanEdit, bool NeedsApproval, decimal DiscountLimitPercent, List<QuoteVersionRef> Versions);
public sealed record UpsertQuote(Guid CustomerId, string Title, DateOnly ValidUntil, int VatRate, List<QuoteLineInput> Lines, decimal DiscountPercent = 0,
    DateOnly? IssuedOn = null, Guid? OpportunityId = null, Guid? BusinessLineId = null, string? Terms = null, string? Note = null);
public sealed record QuoteResult(bool Accepted, DateOnly? DecidedOn = null, string? Note = null);
public sealed record SalesSettingsDto(decimal QuoteDiscountLimitPercent, string? QuoteTemplateName, bool CanEditLimit, bool CanEditTemplate, DateTimeOffset? UpdatedAt,
    string? UpdatedByName);
public sealed record SaveSalesSettings(decimal QuoteDiscountLimitPercent);

/// <summary>
/// Báo giá (giai đoạn 1): hạng mục × đơn giá, chiết khấu %, VAT, hiệu lực, phiên bản, xuất Word theo mẫu. Chiết khấu VƯỢT ngưỡng
/// (<see cref="SalesSettings.QuoteDiscountLimitPercent"/>, Quản trị tài chính đặt, mặc định 15 %) → đơn <c>quote_discount</c> [Duyệt chi].
/// Thấy / sửa như khách hàng (người phụ trách khách + quản lý của họ; Xem tài chính thấy hết). Không PDF (chỉ .docx).
/// </summary>
internal static class QuoteEndpoints
{
    private const string DocxType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/quotes", ListAsync);
        g.MapGet("/quotes/{id:guid}", GetAsync);
        g.MapPost("/quotes", CreateAsync);
        g.MapPut("/quotes/{id:guid}", UpdateAsync);
        g.MapPost("/quotes/{id:guid}/submit", SubmitAsync);
        g.MapPost("/quotes/{id:guid}/sent", SentAsync);
        g.MapPost("/quotes/{id:guid}/result", ResultAsync);
        g.MapPost("/quotes/{id:guid}/revise", ReviseAsync);
        g.MapPost("/quotes/{id:guid}/cancel", CancelAsync);
        g.MapGet("/quotes/{id:guid}/export.docx", ExportAsync);
        g.MapGet("/settings", SettingsAsync);
        g.MapPut("/settings", SaveSettingsAsync);
        g.MapGet("/settings/quote-template/fields", () => TypedResults.Ok(QuoteDocument.Fields));
        g.MapGet("/settings/quote-template/default", () => TypedResults.File(QuoteDocument.DefaultTemplate(), DocxType, "mau-bao-gia-mac-dinh.docx"));
        g.MapPost("/settings/quote-template", UploadTemplateAsync).DisableAntiforgery();
        g.MapDelete("/settings/quote-template", DeleteTemplateAsync);
    }

    internal static async Task<SalesSettings> SettingsRowAsync(SalesDbContext db, CancellationToken ct) =>
        await db.Settings.AsNoTracking().FirstOrDefaultAsync(ct) ?? new SalesSettings();

    private static async Task<List<QuoteDto>> ToDtosAsync(IReadOnlyList<Quote> rows, SalesDbContext db, SalesAccess access, DateOnly today, CancellationToken ct)
    {
        var names = await db.Customers.AsNoTracking().Where(c => rows.Select(r => r.CustomerId).Contains(c.Id)).ToDictionaryAsync(c => c.Id, c => c.Name, ct);
        var emps = await access.EmployeesAsync(ct);
        return rows.Select(q => new QuoteDto(q.Id, QuoteRules.Code(q.Number, q.Version), q.Number, q.Version, q.CustomerId, names.GetValueOrDefault(q.CustomerId, "?"),
            q.OpportunityId, q.Title, q.IssuedOn, q.ValidUntil, q.VatRate, q.DiscountPercent, q.Subtotal, q.Discount, q.BeforeTax, q.Vat, q.Total, q.Status,
            q.ValidUntil < today && q.Status is QuoteStatus.Draft or QuoteStatus.Ready or QuoteStatus.Sent or QuoteStatus.PendingApproval,
            q.OwnerEmployeeId, emps.TryGetValue(q.OwnerEmployeeId, out var e) ? e.FullName : "(không rõ)", q.ContractId, q.CreatedAt)).ToList();
    }

    private static async Task<Ok<PagedResult<QuoteDto>>> ListAsync(ClaimsPrincipal user, SalesDbContext db, SalesAccess access, SalesClock clock, Guid? customerId,
        QuoteStatus? status, bool? includeOld, string? search, int page, int? pageSize, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var q = db.Quotes.AsNoTracking().AsQueryable();
        if (!v.SeeAll) { var owners = v.Owners.ToList(); q = q.Where(x => owners.Contains(x.OwnerEmployeeId)); }
        if (customerId is { } cid) q = q.Where(x => x.CustomerId == cid);
        if (status is { } s) q = q.Where(x => x.Status == s);
        else if (includeOld != true) q = q.Where(x => x.Status != QuoteStatus.Superseded && x.Status != QuoteStatus.Cancelled);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var p = $"%{search.Trim()}%";
            q = q.Where(x => EF.Functions.ILike(x.Title, p) || db.Customers.Any(c => c.Id == x.CustomerId && EF.Functions.ILike(c.Name, p)));
        }
        var paged = await q.OrderByDescending(x => x.CreatedAt).ThenBy(x => x.Id).ToPagedAsync(page < 1 ? 1 : page, pageSize, ct);
        return TypedResults.Ok(paged.With(await ToDtosAsync(paged.Items, db, access, clock.Today, ct)));
    }

    private static async Task<(Quote? Q, SalesViewer V)> LoadAsync(Guid id, ClaimsPrincipal user, SalesDbContext db, SalesAccess access, CancellationToken ct, bool track = false)
    {
        var v = await access.ViewerAsync(user, ct);
        var src = track ? db.Quotes : db.Quotes.AsNoTracking();
        var q = await src.Include(x => x.Lines).FirstOrDefaultAsync(x => x.Id == id, ct);
        return (q is null || !v.CanSee(q.OwnerEmployeeId) ? null : q, v);
    }

    private static async Task<Results<Ok<QuoteDetail>, NotFound>> GetAsync(Guid id, ClaimsPrincipal user, SalesDbContext db, SalesAccess access, SalesClock clock,
        CancellationToken ct)
    {
        var (q, v) = await LoadAsync(id, user, db, access, ct);
        if (q is null) return TypedResults.NotFound();
        var limit = (await SettingsRowAsync(db, ct)).QuoteDiscountLimitPercent;
        var versions = await db.Quotes.AsNoTracking().Where(x => x.Number == q.Number).OrderBy(x => x.Version)
            .Select(x => new QuoteVersionRef(x.Id, x.Version, x.Status, x.Total, x.CreatedAt)).ToListAsync(ct);
        var dto = (await ToDtosAsync([q], db, access, clock.Today, ct))[0];
        return TypedResults.Ok(new QuoteDetail(dto, q.Lines.OrderBy(l => l.Order).Select(l => new QuoteLineDto(l.Id, l.Order, l.Description, l.Unit, l.Quantity, l.UnitPrice, l.Amount)).ToList(),
            q.Terms, q.Note, q.BusinessLineId, q.ApprovalRequestId, q.ApprovalComment, q.SentAt, q.DecidedOn, q.DecisionNote, v.CanEdit(q.OwnerEmployeeId),
            QuoteRules.NeedsApproval(q.DiscountPercent, limit), limit, versions));
    }

    private static async Task<Validation> ValidateAsync(UpsertQuote r, DateOnly issuedOn, SalesDbContext db, CancellationToken ct)
    {
        var lines = r.Lines ?? [];
        var v = new Validation().Required(r.Title, "title", "Tên báo giá").MaxLength(r.Title, 300, "title", "Tên báo giá")
            .MaxLength(r.Terms, 4000, "terms", "Điều khoản").MaxLength(r.Note, 2000, "note", "Ghi chú");
        foreach (var (field, msg) in QuoteRules.Validate(lines, r.DiscountPercent, r.VatRate, issuedOn, r.ValidUntil)) v.Add(field, msg);
        if (r.OpportunityId is { } oid && !await db.Opportunities.AnyAsync(o => o.Id == oid && o.CustomerId == r.CustomerId, ct))
            v.Add("opportunityId", "Cơ hội không thuộc khách này");
        return v;
    }

    private static void Apply(Quote q, UpsertQuote r, DateOnly issuedOn)
    {
        var t = QuoteRules.Totals(r.Lines, r.DiscountPercent, r.VatRate);
        q.Title = r.Title.Trim(); q.IssuedOn = issuedOn; q.ValidUntil = r.ValidUntil; q.VatRate = r.VatRate; q.DiscountPercent = r.DiscountPercent;
        q.OpportunityId = r.OpportunityId; q.BusinessLineId = r.BusinessLineId; q.Terms = CustomerEndpoints.Clean(r.Terms); q.Note = CustomerEndpoints.Clean(r.Note);
        (q.Subtotal, q.Discount, q.BeforeTax, q.Vat, q.Total) = (t.Subtotal, t.Discount, t.BeforeTax, t.Vat, t.Total);
        q.Lines.Clear();
        var i = 0;
        foreach (var l in r.Lines)
            q.Lines.Add(new QuoteLine { QuoteId = q.Id, Order = ++i, Description = l.Description.Trim(), Unit = CustomerEndpoints.Clean(l.Unit), Quantity = l.Quantity,
                UnitPrice = l.UnitPrice, Amount = QuoteRules.LineAmount(l.Quantity, l.UnitPrice) });
    }

    private static async Task<Results<Created<Guid>, NotFound, ValidationProblem, ProblemHttpResult>> CreateAsync(UpsertQuote r, ClaimsPrincipal user, SalesDbContext db,
        SalesAccess access, SalesClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var cust = await db.Customers.AsNoTracking().FirstOrDefaultAsync(x => x.Id == r.CustomerId, ct);
        if (cust is null || !v.CanSee(cust.OwnerEmployeeId)) return TypedResults.NotFound();
        if (!v.CanEdit(cust.OwnerEmployeeId)) return CustomerEndpoints.Forbidden();
        var issued = r.IssuedOn ?? clock.Today;
        var val = await ValidateAsync(r, issued, db, ct);
        if (val.Failed) return val.Problem();
        for (var attempt = 0; ; attempt++)
        {
            var q = new Quote
            {
                Number = (await db.Quotes.MaxAsync(x => (long?)x.Number, ct) ?? 0) + 1, CustomerId = r.CustomerId, Title = "", OwnerEmployeeId = cust.OwnerEmployeeId,
                Status = QuoteStatus.Draft, CreatedAt = clock.Now, CreatedByName = v.Name,
            };
            Apply(q, r, issued);
            db.Quotes.Add(q);
            try { await db.SaveChangesAsync(ct); }
            catch (DbUpdateException) when (attempt < 3) { db.Quotes.Remove(q); continue; } // tạo đồng thời → số trùng
            return TypedResults.Created($"/api/sales/quotes/{q.Id}", q.Id);
        }
    }

    private static async Task<Results<NoContent, NotFound, ValidationProblem, ProblemHttpResult>> UpdateAsync(Guid id, UpsertQuote r, ClaimsPrincipal user, SalesDbContext db,
        SalesAccess access, SalesClock clock, CancellationToken ct)
    {
        var (q, v) = await LoadAsync(id, user, db, access, ct, track: true);
        if (q is null) return TypedResults.NotFound();
        if (!v.CanEdit(q.OwnerEmployeeId)) return CustomerEndpoints.Forbidden();
        if (!QuoteRules.IsEditable(q.Status)) return Problems.Conflict("Chỉ sửa được báo giá nháp — tạo phiên bản mới để sửa");
        if (r.CustomerId != q.CustomerId) return new Validation().Add("customerId", "Không đổi khách của báo giá").Problem();
        var val = await ValidateAsync(r, r.IssuedOn ?? q.IssuedOn, db, ct);
        if (val.Failed) return val.Problem();
        db.QuoteLines.RemoveRange(q.Lines);
        Apply(q, r, r.IssuedOn ?? q.IssuedOn);
        db.QuoteLines.AddRange(q.Lines);
        q.UpdatedAt = clock.Now;
        q.ApprovalComment = null;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    /// <summary>Chốt nháp: chiết khấu trong ngưỡng → Sẵn sàng; vượt ngưỡng → gửi duyệt [Duyệt chi] (người gửi phải có hồ sơ nhân viên).</summary>
    private static async Task<Results<Ok<QuoteDto>, NotFound, ProblemHttpResult>> SubmitAsync(Guid id, ClaimsPrincipal user, SalesDbContext db, SalesAccess access,
        IApprovalService approvals, SalesClock clock, CancellationToken ct)
    {
        var (q, v) = await LoadAsync(id, user, db, access, ct, track: true);
        if (q is null) return TypedResults.NotFound();
        if (!v.CanEdit(q.OwnerEmployeeId)) return CustomerEndpoints.Forbidden();
        if (q.Status != QuoteStatus.Draft) return Problems.Conflict("Báo giá không ở trạng thái nháp");
        if (q.ValidUntil < clock.Today) return Problems.Conflict("Báo giá đã hết hiệu lực — sửa ngày hiệu lực");
        var limit = (await SettingsRowAsync(db, ct)).QuoteDiscountLimitPercent;
        if (!QuoteRules.NeedsApproval(q.DiscountPercent, limit)) q.Status = QuoteStatus.Ready;
        else
        {
            if (v.Employee is not { IsActive: true } me) return CustomerEndpoints.Forbidden("Chỉ nhân viên có hồ sơ mới gửi duyệt chiết khấu");
            var customer = await db.Customers.AsNoTracking().Where(c => c.Id == q.CustomerId).Select(c => c.Name).FirstAsync(ct);
            q.Status = QuoteStatus.PendingApproval;
            q.ApprovalSubjectId = Guid.CreateVersion7();
            await db.SaveChangesAsync(ct);
            try
            {
                q.ApprovalRequestId = await approvals.SubmitAsync(new ApprovalSubmission(ApprovalTypes.QuoteDiscount, q.ApprovalSubjectId.Value, me.Id,
                    $"Duyệt chiết khấu {q.DiscountPercent:0.##}% — báo giá {QuoteRules.Code(q.Number, q.Version)}",
                    $"{customer} · {q.Title} · trước chiết khấu {q.Subtotal:N0} đ, sau thuế {q.Total:N0} đ (ngưỡng {limit:0.##}%)", [ApprovalStepKind.Finance]), ct);
            }
            catch
            {
                q.Status = QuoteStatus.Draft;
                await db.SaveChangesAsync(CancellationToken.None);
                throw;
            }
        }
        q.UpdatedAt = clock.Now;
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok((await ToDtosAsync([q], db, access, clock.Today, ct))[0]);
    }

    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> SentAsync(Guid id, ClaimsPrincipal user, SalesDbContext db, SalesAccess access,
        SalesClock clock, CancellationToken ct)
    {
        var (q, v) = await LoadAsync(id, user, db, access, ct, track: true);
        if (q is null) return TypedResults.NotFound();
        if (!v.CanEdit(q.OwnerEmployeeId)) return CustomerEndpoints.Forbidden();
        if (q.Status != QuoteStatus.Ready) return Problems.Conflict(q.Status == QuoteStatus.PendingApproval ? "Chiết khấu chưa được duyệt" : "Chỉ gửi được báo giá đã chốt");
        q.Status = QuoteStatus.Sent;
        q.SentAt = clock.Now;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    /// <summary>Khách đồng ý / từ chối. Đồng ý → lập hợp đồng bán từ báo giá (POST /contracts với quoteId).</summary>
    private static async Task<Results<NoContent, NotFound, ValidationProblem, ProblemHttpResult>> ResultAsync(Guid id, QuoteResult r, ClaimsPrincipal user,
        SalesDbContext db, SalesAccess access, SalesClock clock, CancellationToken ct)
    {
        var (q, v) = await LoadAsync(id, user, db, access, ct, track: true);
        if (q is null) return TypedResults.NotFound();
        if (!v.CanEdit(q.OwnerEmployeeId)) return CustomerEndpoints.Forbidden();
        if (q.Status is not (QuoteStatus.Ready or QuoteStatus.Sent)) return Problems.Conflict("Chỉ ghi kết quả cho báo giá đã chốt / đã gửi");
        var on = r.DecidedOn ?? clock.Today;
        if (on > clock.Today) return new Validation().Add("decidedOn", "Ngày khách trả lời không ở tương lai").Problem();
        q.Status = r.Accepted ? QuoteStatus.Accepted : QuoteStatus.Rejected;
        q.DecidedOn = on;
        q.DecisionNote = CustomerEndpoints.Clean(r.Note) is { } n ? (n.Length > 500 ? n[..500] : n) : null;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    /// <summary>Phiên bản mới: chép thành Nháp (số giữ nguyên, phiên bản + 1); bản cũ → "Đã thay".</summary>
    private static async Task<Results<Created<Guid>, NotFound, ProblemHttpResult>> ReviseAsync(Guid id, ClaimsPrincipal user, SalesDbContext db, SalesAccess access,
        SalesClock clock, CancellationToken ct)
    {
        var (q, v) = await LoadAsync(id, user, db, access, ct, track: true);
        if (q is null) return TypedResults.NotFound();
        if (!v.CanEdit(q.OwnerEmployeeId)) return CustomerEndpoints.Forbidden();
        if (!QuoteRules.CanRevise(q.Status))
            return Problems.Conflict(q.Status == QuoteStatus.PendingApproval ? "Đang chờ duyệt — huỷ đơn duyệt ở mục Phê duyệt trước" : "Báo giá này không tạo phiên bản mới được");
        var latest = await db.Quotes.Where(x => x.Number == q.Number).MaxAsync(x => x.Version, ct);
        if (latest != q.Version) return Problems.Conflict("Đã có phiên bản mới hơn");
        var n = new Quote
        {
            Number = q.Number, Version = q.Version + 1, CustomerId = q.CustomerId, OpportunityId = q.OpportunityId, BusinessLineId = q.BusinessLineId, Title = q.Title,
            IssuedOn = clock.Today, ValidUntil = q.ValidUntil < clock.Today ? clock.Today.AddDays(30) : q.ValidUntil, VatRate = q.VatRate, DiscountPercent = q.DiscountPercent,
            Subtotal = q.Subtotal, Discount = q.Discount, BeforeTax = q.BeforeTax, Vat = q.Vat, Total = q.Total, Terms = q.Terms, Note = q.Note,
            OwnerEmployeeId = q.OwnerEmployeeId, Status = QuoteStatus.Draft, CreatedAt = clock.Now, CreatedByName = v.Name,
        };
        foreach (var l in q.Lines.OrderBy(l => l.Order))
            n.Lines.Add(new QuoteLine { QuoteId = n.Id, Order = l.Order, Description = l.Description, Unit = l.Unit, Quantity = l.Quantity, UnitPrice = l.UnitPrice, Amount = l.Amount });
        q.Status = QuoteStatus.Superseded;
        db.Quotes.Add(n);
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException) { return Problems.Conflict("Phiên bản mới vừa được tạo bởi người khác"); }
        return TypedResults.Created($"/api/sales/quotes/{n.Id}", n.Id);
    }

    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> CancelAsync(Guid id, ClaimsPrincipal user, SalesDbContext db, SalesAccess access,
        CancellationToken ct)
    {
        var (q, v) = await LoadAsync(id, user, db, access, ct, track: true);
        if (q is null) return TypedResults.NotFound();
        if (!v.CanEdit(q.OwnerEmployeeId)) return CustomerEndpoints.Forbidden();
        if (!QuoteRules.CanCancel(q.Status)) return Problems.Conflict("Không huỷ được báo giá ở trạng thái này");
        q.Status = QuoteStatus.Cancelled;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    /// <summary>File Word theo mẫu công ty (nếu có) hoặc mẫu mặc định. Người liên hệ = liên hệ chính của khách.</summary>
    private static async Task<Results<FileContentHttpResult, NotFound, ProblemHttpResult>> ExportAsync(Guid id, ClaimsPrincipal user, SalesDbContext db, SalesAccess access,
        IFileStorage storage, CancellationToken ct)
    {
        var (q, _) = await LoadAsync(id, user, db, access, ct);
        if (q is null) return TypedResults.NotFound();
        var c = await db.Customers.AsNoTracking().Include(x => x.Contacts).FirstAsync(x => x.Id == q.CustomerId, ct);
        var contact = c.Contacts.OrderByDescending(x => x.IsPrimary).FirstOrDefault();
        var settings = await SettingsRowAsync(db, ct);
        Stream template = settings.QuoteTemplateKey is { } key ? await storage.OpenReadAsync(key, ct) : new MemoryStream(QuoteDocument.DefaultTemplate());
        await using (template)
        {
            try
            {
                var bytes = QuoteDocument.Render(template, q, c, contact, await access.NameOfAsync(q.OwnerEmployeeId, ct));
                return TypedResults.File(bytes, DocxType, $"{QuoteRules.Code(q.Number, q.Version)}.docx");
            }
            catch (Exception ex) when (ex is DocumentFormat.OpenXml.Packaging.OpenXmlPackageException or InvalidDataException)
            {
                return Problems.Conflict("Mẫu báo giá của công ty bị lỗi — tải lại mẫu ở Cấu hình");
            }
        }
    }

    private static async Task<Ok<SalesSettingsDto>> SettingsAsync(ClaimsPrincipal user, SalesDbContext db, SalesAccess access, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var s = await SettingsRowAsync(db, ct);
        var admin = v.Finance.Has(FinancePermission.Admin);
        return TypedResults.Ok(new SalesSettingsDto(s.QuoteDiscountLimitPercent, s.QuoteTemplateName, admin, admin || user.IsHr(), s.UpdatedAt, s.UpdatedByName));
    }

    private static async Task<Results<NoContent, ValidationProblem, ProblemHttpResult>> SaveSettingsAsync(SaveSalesSettings r, ClaimsPrincipal user, SalesDbContext db,
        SalesAccess access, SalesClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        if (!v.Finance.Has(FinancePermission.Admin)) return CustomerEndpoints.Forbidden("Chỉ Quản trị tài chính đổi ngưỡng chiết khấu");
        if (r.QuoteDiscountLimitPercent is < 0 or > 100) return new Validation().Add("quoteDiscountLimitPercent", "Ngưỡng từ 0 đến 100 %").Problem();
        var s = await RowForWriteAsync(db, ct);
        s.QuoteDiscountLimitPercent = decimal.Round(r.QuoteDiscountLimitPercent, 2);
        s.UpdatedAt = clock.Now; s.UpdatedByName = v.Name;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private static async Task<SalesSettings> RowForWriteAsync(SalesDbContext db, CancellationToken ct)
    {
        var s = await db.Settings.FirstOrDefaultAsync(ct);
        if (s is null) { s = new SalesSettings(); db.Settings.Add(s); }
        return s;
    }

    /// <summary>Mẫu Word riêng của công ty (HR hoặc Quản trị tài chính). Kiểm tra mở được + có ít nhất một trường.</summary>
    private static async Task<Results<NoContent, ValidationProblem, ProblemHttpResult>> UploadTemplateAsync(IFormFile file, ClaimsPrincipal user, SalesDbContext db,
        SalesAccess access, IFileStorage storage, SalesClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        if (!user.IsHr() && !v.Finance.Has(FinancePermission.Admin)) return CustomerEndpoints.Forbidden("Chỉ HR hoặc Quản trị tài chính đổi mẫu báo giá");
        if (file.Length is 0 or > 10 * 1024 * 1024 || !file.FileName.EndsWith(".docx", StringComparison.OrdinalIgnoreCase))
            return new Validation().Add("file", "Chọn file Word .docx (≤ 10 MB)").Problem();
        using var ms = new MemoryStream();
        await file.CopyToAsync(ms, ct);
        IReadOnlyList<string> fields;
        try { ms.Position = 0; fields = DocxTemplate.ScanFields(ms); }
        catch (Exception e) when (e is DocumentFormat.OpenXml.Packaging.OpenXmlPackageException or InvalidDataException or System.IO.FileFormatException)
        { return new Validation().Add("file", "File không phải Word .docx hợp lệ").Problem(); }
        if (fields.Count == 0) return new Validation().Add("file", "Mẫu chưa có trường nào dạng {{SoBaoGia}}").Problem();
        var key = $"sales/templates/quote-{Guid.CreateVersion7():N}.docx";
        ms.Position = 0;
        await storage.UploadAsync(key, ms, DocxType, ct);
        var s = await RowForWriteAsync(db, ct);
        s.QuoteTemplateKey = key;
        s.QuoteTemplateName = Path.GetFileName(file.FileName) is { Length: > 200 } longName ? longName[..200] : Path.GetFileName(file.FileName);
        s.UpdatedAt = clock.Now; s.UpdatedByName = v.Name;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private static async Task<Results<NoContent, ProblemHttpResult>> DeleteTemplateAsync(ClaimsPrincipal user, SalesDbContext db, SalesAccess access, SalesClock clock,
        CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        if (!user.IsHr() && !v.Finance.Has(FinancePermission.Admin)) return CustomerEndpoints.Forbidden("Chỉ HR hoặc Quản trị tài chính đổi mẫu báo giá");
        var s = await RowForWriteAsync(db, ct);
        s.QuoteTemplateKey = null; s.QuoteTemplateName = null; s.UpdatedAt = clock.Now; s.UpdatedByName = v.Name; // file cũ giữ trên S3
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }
}
