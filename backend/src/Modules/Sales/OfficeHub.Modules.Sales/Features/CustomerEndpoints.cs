using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Organization.Contracts;
using OfficeHub.Modules.Sales.Domain;
using OfficeHub.Modules.Sales.Infrastructure;

namespace OfficeHub.Modules.Sales.Features;

public sealed record CustomerDto(Guid Id, string Code, string Name, CustomerKind Kind, string? TaxCode, string? Phone, string? Email, string? Source,
    Guid OwnerEmployeeId, string OwnerName, bool IsActive, DateTimeOffset CreatedAt, int OpenOpportunities, int ActiveContracts);
public sealed record ContactDto(Guid Id, string Name, string? Title, string? Phone, string? Email, bool IsPrimary);
public sealed record ActivityDto(Guid Id, Guid CustomerId, string? CustomerName, Guid? OpportunityId, ActivityKind Kind, DateTimeOffset At, string Content, string? NextAction,
    DateOnly? NextActionOn, string CreatedByName);
public sealed record CustomerDetail(CustomerDto Customer, string? Address, string? Note, List<ContactDto> Contacts, List<ActivityDto> Activities,
    List<OpportunityDto> Opportunities, List<ContractDto> Contracts, bool CanEdit);
public sealed record UpsertCustomer(string Name, CustomerKind Kind = CustomerKind.Company, string? TaxCode = null, string? Address = null, string? Phone = null,
    string? Email = null, string? Source = null, string? Note = null, Guid? OwnerEmployeeId = null, bool IsActive = true);
public sealed record UpsertContact(string Name, string? Title = null, string? Phone = null, string? Email = null, bool IsPrimary = false);
public sealed record CreateActivity(ActivityKind Kind, string Content, DateTimeOffset? At = null, Guid? OpportunityId = null, string? NextAction = null, DateOnly? NextActionOn = null);

/// <summary>Khách hàng, người liên hệ, nhật ký chăm sóc. Thấy: người phụ trách + quản lý của họ + người có quyền Xem tài chính (<see cref="SalesViewer"/>).</summary>
internal static class CustomerEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/customers", ListAsync);
        g.MapGet("/customers/{id:guid}", GetAsync);
        g.MapPost("/customers", CreateAsync);
        g.MapPut("/customers/{id:guid}", UpdateAsync);
        g.MapPost("/customers/{id:guid}/contacts", AddContactAsync);
        g.MapPut("/contacts/{id:guid}", UpdateContactAsync);
        g.MapDelete("/contacts/{id:guid}", DeleteContactAsync);
        g.MapPost("/customers/{id:guid}/activities", AddActivityAsync);
        g.MapGet("/activities/upcoming", UpcomingAsync);
    }

    internal static ProblemHttpResult Forbidden(string msg = "Bạn không phụ trách khách hàng này") => TypedResults.Problem(msg, statusCode: StatusCodes.Status403Forbidden);

    private static async Task<Ok<PagedResult<CustomerDto>>> ListAsync(ClaimsPrincipal user, SalesDbContext db, SalesAccess access, string? search, Guid? ownerId,
        bool? includeInactive, int page, int? pageSize, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var q = db.Customers.AsNoTracking().AsQueryable();
        if (!v.SeeAll) { var owners = v.Owners.ToList(); q = q.Where(c => owners.Contains(c.OwnerEmployeeId)); }
        if (ownerId is { } o) q = q.Where(c => c.OwnerEmployeeId == o);
        if (includeInactive != true) q = q.Where(c => c.IsActive);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = Like.Contains(search);
            q = q.Where(c => EF.Functions.ILike(c.Name, s) || EF.Functions.ILike(c.TaxCode ?? "", s) || EF.Functions.ILike(c.Phone ?? "", s) || EF.Functions.ILike(c.Email ?? "", s)
                             || c.Contacts.Any(x => EF.Functions.ILike(x.Name, s) || EF.Functions.ILike(x.Phone ?? "", s)));
        }
        var paged = await q.OrderByDescending(c => c.CreatedAt).ThenBy(c => c.Id).ToPagedAsync(page < 1 ? 1 : page, pageSize, ct);
        return TypedResults.Ok(paged.With(await ToDtosAsync(paged.Items, db, access, ct)));
    }

    internal static async Task<List<CustomerDto>> ToDtosAsync(IReadOnlyList<Customer> rows, SalesDbContext db, SalesAccess access, CancellationToken ct)
    {
        var ids = rows.Select(c => c.Id).ToList();
        var opps = await db.Opportunities.AsNoTracking().Where(o => ids.Contains(o.CustomerId) && o.Stage != OpportunityStage.Won && o.Stage != OpportunityStage.Lost)
            .GroupBy(o => o.CustomerId).Select(g => new { g.Key, N = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.N, ct);
        var cons = await db.Contracts.AsNoTracking().Where(c => ids.Contains(c.CustomerId) && c.Status == ContractStatus.Active)
            .GroupBy(c => c.CustomerId).Select(g => new { g.Key, N = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.N, ct);
        var emps = await access.EmployeesAsync(ct);
        return rows.Select(c => new CustomerDto(c.Id, SalesRules.CustomerCode(c.Number), c.Name, c.Kind, c.TaxCode, c.Phone, c.Email, c.Source, c.OwnerEmployeeId,
            emps.TryGetValue(c.OwnerEmployeeId, out var e) ? e.FullName : "(không rõ)", c.IsActive, c.CreatedAt, opps.GetValueOrDefault(c.Id), cons.GetValueOrDefault(c.Id))).ToList();
    }

    private static async Task<Results<Ok<CustomerDetail>, NotFound>> GetAsync(Guid id, ClaimsPrincipal user, SalesDbContext db, SalesAccess access, CollectedCalculator calc,
        SalesClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var c = await db.Customers.AsNoTracking().Include(x => x.Contacts).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (c is null || !v.CanSee(c.OwnerEmployeeId)) return TypedResults.NotFound(); // không lộ sự tồn tại
        var dto = (await ToDtosAsync([c], db, access, ct))[0];
        var acts = await db.Activities.AsNoTracking().Where(a => a.CustomerId == id).OrderByDescending(a => a.At).Take(100).ToListAsync(ct);
        var opps = await db.Opportunities.AsNoTracking().Where(o => o.CustomerId == id).OrderByDescending(o => o.CreatedAt).ToListAsync(ct);
        var contracts = await db.Contracts.AsNoTracking().Include(x => x.Installments).ThenInclude(i => i.Collections).AsSplitQuery().Where(x => x.CustomerId == id)
            .OrderByDescending(x => x.SignedOn).ToListAsync(ct);
        return TypedResults.Ok(new CustomerDetail(dto, c.Address, c.Note,
            [.. c.Contacts.OrderByDescending(x => x.IsPrimary).ThenBy(x => x.Name).Select(x => new ContactDto(x.Id, x.Name, x.Title, x.Phone, x.Email, x.IsPrimary))],
            [.. acts.Select(a => ToDto(a, null))],
            await OpportunityEndpoints.ToDtosAsync(opps, db, access, ct),
            await ContractEndpoints.ToDtosAsync(contracts, db, access, calc, clock.Today, ct),
            v.CanEdit(c.OwnerEmployeeId)));
    }

    internal static ActivityDto ToDto(Activity a, string? customerName) =>
        new(a.Id, a.CustomerId, customerName, a.OpportunityId, a.Kind, a.At, a.Content, a.NextAction, a.NextActionOn, a.CreatedByName);

    private static Validation Validate(UpsertCustomer r) => new Validation()
        .Required(r.Name, "name", "Tên khách hàng").MaxLength(r.Name, 200, "name", "Tên khách hàng")
        .MaxLength(r.TaxCode, 20, "taxCode", "Mã số thuế").MaxLength(r.Address, 300, "address", "Địa chỉ").MaxLength(r.Phone, 30, "phone", "Điện thoại")
        .MaxLength(r.Source, 100, "source", "Nguồn khách").MaxLength(r.Note, 2000, "note", "Ghi chú")
        .When(!string.IsNullOrWhiteSpace(r.Email) && !r.Email.Contains('@'), "email", "Email không hợp lệ")
        .When(r.TaxCode is { Length: > 0 } t && !t.Trim().All(ch => char.IsDigit(ch) || ch == '-'), "taxCode", "Mã số thuế chỉ gồm số và dấu gạch");

    /// <summary>Đổi / đặt người phụ trách: phải là nhân viên đang làm, và là chính mình hoặc cấp dưới (hoặc người đặt có quyền Quản trị tài chính).</summary>
    internal static async Task<string?> CheckOwnerAsync(Guid ownerId, SalesViewer v, IEmployeeDirectory dir, CancellationToken ct)
    {
        if (await dir.GetAsync(ownerId, ct) is not { IsActive: true }) return "Người phụ trách không tồn tại hoặc đã nghỉ việc";
        return v.CanEdit(ownerId) ? null : "Chỉ giao cho chính bạn hoặc cấp dưới của bạn";
    }

    private static async Task<Results<Created<Guid>, ValidationProblem, ProblemHttpResult>> CreateAsync(UpsertCustomer r, ClaimsPrincipal user, SalesDbContext db,
        SalesAccess access, IEmployeeDirectory dir, SalesClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var owner = r.OwnerEmployeeId ?? v.Employee?.Id;
        if (owner is null) return Forbidden("Chỉ nhân viên có hồ sơ mới tạo được khách hàng");
        var val = Validate(r);
        if (await CheckOwnerAsync(owner.Value, v, dir, ct) is { } err) val.Add("ownerEmployeeId", err);
        await CheckTaxCodeAsync(val, r.TaxCode, null, db, ct);
        if (val.Failed) return val.Problem();
        var c = new Customer
        {
            Name = r.Name.Trim(), Kind = r.Kind, TaxCode = Clean(r.TaxCode), Address = Clean(r.Address), Phone = Clean(r.Phone), Email = Clean(r.Email)?.ToLowerInvariant(),
            Source = Clean(r.Source), Note = Clean(r.Note), OwnerEmployeeId = owner.Value, IsActive = true, CreatedAt = clock.Now,
        };
        db.Customers.Add(c);
        await db.SaveChangesAsync(ct);
        return TypedResults.Created($"/api/sales/customers/{c.Id}", c.Id);
    }

    private static async Task CheckTaxCodeAsync(Validation v, string? taxCode, Guid? selfId, SalesDbContext db, CancellationToken ct)
    {
        if (Clean(taxCode) is not { } t) return;
        var other = await db.Customers.AsNoTracking().Where(c => c.TaxCode == t && c.Id != selfId).Select(c => new { c.Name, c.Number }).FirstOrDefaultAsync(ct);
        if (other is not null) v.Add("taxCode", $"Mã số thuế đã có ở khách {SalesRules.CustomerCode(other.Number)} ({other.Name})");
    }

    private static async Task<Results<NoContent, NotFound, ValidationProblem, ProblemHttpResult>> UpdateAsync(Guid id, UpsertCustomer r, ClaimsPrincipal user, SalesDbContext db,
        SalesAccess access, IEmployeeDirectory dir, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var c = await db.Customers.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (c is null || !v.CanSee(c.OwnerEmployeeId)) return TypedResults.NotFound();
        if (!v.CanEdit(c.OwnerEmployeeId)) return Forbidden();
        var val = Validate(r);
        if (r.OwnerEmployeeId is { } o && o != c.OwnerEmployeeId && await CheckOwnerAsync(o, v, dir, ct) is { } err) val.Add("ownerEmployeeId", err);
        await CheckTaxCodeAsync(val, r.TaxCode, id, db, ct);
        if (val.Failed) return val.Problem();
        c.Name = r.Name.Trim(); c.Kind = r.Kind; c.TaxCode = Clean(r.TaxCode); c.Address = Clean(r.Address); c.Phone = Clean(r.Phone); c.Email = Clean(r.Email)?.ToLowerInvariant();
        c.Source = Clean(r.Source); c.Note = Clean(r.Note); c.IsActive = r.IsActive;
        if (r.OwnerEmployeeId is { } newOwner) c.OwnerEmployeeId = newOwner;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    // ---------- Người liên hệ ----------
    private static Validation Validate(UpsertContact r) => new Validation().Required(r.Name, "name", "Tên người liên hệ").MaxLength(r.Name, 200, "name", "Tên người liên hệ")
        .MaxLength(r.Title, 100, "title", "Chức vụ").MaxLength(r.Phone, 30, "phone", "Điện thoại").MaxLength(r.Email, 200, "email", "Email")
        .When(!string.IsNullOrWhiteSpace(r.Email) && !r.Email.Contains('@'), "email", "Email không hợp lệ");

    private static async Task<Results<Created<Guid>, NotFound, ValidationProblem, ProblemHttpResult>> AddContactAsync(Guid id, UpsertContact r, ClaimsPrincipal user,
        SalesDbContext db, SalesAccess access, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var c = await db.Customers.Include(x => x.Contacts).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (c is null || !v.CanSee(c.OwnerEmployeeId)) return TypedResults.NotFound();
        if (!v.CanEdit(c.OwnerEmployeeId)) return Forbidden();
        var val = Validate(r);
        if (val.Failed) return val.Problem();
        var isPrimary = r.IsPrimary || c.Contacts.Count == 0;
        if (isPrimary) foreach (var x in c.Contacts) x.IsPrimary = false;
        var contact = new Contact { CustomerId = id, Name = r.Name.Trim(), Title = Clean(r.Title), Phone = Clean(r.Phone), Email = Clean(r.Email), IsPrimary = isPrimary };
        db.Contacts.Add(contact);
        await db.SaveChangesAsync(ct);
        return TypedResults.Created($"/api/sales/contacts/{contact.Id}", contact.Id);
    }

    private static async Task<Results<NoContent, NotFound, ValidationProblem, ProblemHttpResult>> UpdateContactAsync(Guid id, UpsertContact r, ClaimsPrincipal user,
        SalesDbContext db, SalesAccess access, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var contact = await db.Contacts.FirstOrDefaultAsync(x => x.Id == id, ct);
        var c = contact is null ? null : await db.Customers.Include(x => x.Contacts).FirstOrDefaultAsync(x => x.Id == contact.CustomerId, ct);
        if (contact is null || c is null || !v.CanSee(c.OwnerEmployeeId)) return TypedResults.NotFound();
        if (!v.CanEdit(c.OwnerEmployeeId)) return Forbidden();
        var val = Validate(r);
        if (val.Failed) return val.Problem();
        if (r.IsPrimary) foreach (var x in c.Contacts) x.IsPrimary = x.Id == id;
        contact.Name = r.Name.Trim(); contact.Title = Clean(r.Title); contact.Phone = Clean(r.Phone); contact.Email = Clean(r.Email);
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> DeleteContactAsync(Guid id, ClaimsPrincipal user, SalesDbContext db, SalesAccess access, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var contact = await db.Contacts.FirstOrDefaultAsync(x => x.Id == id, ct);
        var owner = contact is null ? (Guid?)null : await db.Customers.Where(x => x.Id == contact.CustomerId).Select(x => (Guid?)x.OwnerEmployeeId).FirstOrDefaultAsync(ct);
        if (contact is null || owner is null || !v.CanSee(owner.Value)) return TypedResults.NotFound();
        if (!v.CanEdit(owner.Value)) return Forbidden();
        db.Contacts.Remove(contact);
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    // ---------- Chăm sóc ----------
    private static async Task<Results<Created<Guid>, NotFound, ValidationProblem, ProblemHttpResult>> AddActivityAsync(Guid id, CreateActivity r, ClaimsPrincipal user,
        SalesDbContext db, SalesAccess access, SalesClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var c = await db.Customers.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (c is null || !v.CanSee(c.OwnerEmployeeId)) return TypedResults.NotFound();
        if (!v.CanEdit(c.OwnerEmployeeId) || v.Employee is null) return Forbidden();
        var val = new Validation().Required(r.Content, "content", "Nội dung").MaxLength(r.Content, 2000, "content", "Nội dung").MaxLength(r.NextAction, 300, "nextAction", "Việc tiếp theo")
            .When(r.NextActionOn is not null && string.IsNullOrWhiteSpace(r.NextAction), "nextAction", "Nhập việc tiếp theo cho ngày hẹn")
            .When(r.At is { } at && at > clock.Now.AddMinutes(5), "at", "Thời điểm chăm sóc không ở tương lai");
        if (r.OpportunityId is { } oid && !await db.Opportunities.AnyAsync(o => o.Id == oid && o.CustomerId == id, ct)) val.Add("opportunityId", "Cơ hội không thuộc khách này");
        if (val.Failed) return val.Problem();
        var a = new Activity
        {
            CustomerId = id, OpportunityId = r.OpportunityId, Kind = r.Kind, At = (r.At ?? clock.Now).ToUniversalTime(), Content = r.Content.Trim(),
            NextAction = Clean(r.NextAction), NextActionOn = r.NextActionOn, CreatedByEmployeeId = v.Employee.Id, CreatedByName = v.Name,
        };
        db.Activities.Add(a);
        await db.SaveChangesAsync(ct);
        return TypedResults.Created($"/api/sales/activities/{a.Id}", a.Id);
    }

    /// <summary>Việc chăm sóc tôi đã hẹn (chưa tới / quá ≤ 30 ngày), sắp theo ngày hẹn.</summary>
    private static async Task<Ok<List<ActivityDto>>> UpcomingAsync(ClaimsPrincipal user, SalesDbContext db, SalesAccess access, SalesClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        if (v.Employee is null) return TypedResults.Ok(new List<ActivityDto>());
        var from = clock.Today.AddDays(-30);
        var rows = await db.Activities.AsNoTracking().Where(a => a.CreatedByEmployeeId == v.Employee.Id && a.NextActionOn != null && a.NextActionOn >= from)
            .OrderBy(a => a.NextActionOn).Take(100).ToListAsync(ct);
        var names = await db.Customers.AsNoTracking().Where(c => rows.Select(r => r.CustomerId).Contains(c.Id)).ToDictionaryAsync(c => c.Id, c => c.Name, ct);
        return TypedResults.Ok(rows.Select(a => ToDto(a, names.GetValueOrDefault(a.CustomerId))).ToList());
    }

    internal static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
