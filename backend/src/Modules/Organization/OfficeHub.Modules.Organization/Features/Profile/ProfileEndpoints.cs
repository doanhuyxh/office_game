using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.BuildingBlocks.Security;
using OfficeHub.BuildingBlocks.Storage;
using OfficeHub.Modules.Identity.Contracts;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Organization.Domain;
using OfficeHub.Modules.Organization.Infrastructure;

namespace OfficeHub.Modules.Organization.Features.Profile;

public sealed record ContactDto(string? Phone, string? CurrentAddress, string? PermanentAddress,
    string? EmergencyContactName, string? EmergencyContactRelation, string? EmergencyContactPhone);
public sealed record SensitiveDto(DateOnly? DateOfBirth, string? IdNumber, DateOnly? IdIssuedOn, string? IdIssuedPlace,
    string? BankName, string? BankAccount, string? BankAccountHolder);
public sealed record FieldDiffDto(string Field, string Label, string? Old, string? New);
public sealed record ProfileRequestDto(Guid Id, Guid EmployeeId, string EmployeeCode, string EmployeeName, string Status, DateTimeOffset CreatedAt,
    DateTimeOffset? DecidedAt, string? DecidedByName, string? RejectReason, string? Note, IReadOnlyList<FieldDiffDto> Changes);
public sealed record MyProfileDto(Guid EmployeeId, string Code, string FullName, string? Email, string? DepartmentName, string? PositionName,
    string? JobTitle, string? ManagerName, DateOnly JoinedAt, string Status, string? AvatarUrl, ContactDto Contact, SensitiveDto Sensitive,
    ProfileRequestDto? Pending, ProfileRequestDto? LastDecided);
public sealed record SubmitRequestBody(SensitiveChange Change, string? Note);
public sealed record RejectBody(string Reason);
/// <summary>HR sửa thẳng (không qua duyệt): thay toàn bộ liên hệ + thông tin nhạy cảm (null = xoá).</summary>
public sealed record HrUpdateBody(ContactDto Contact, SensitiveDto Sensitive);

/// <summary>
/// Thông tin cá nhân (chủ dự án chốt 2026-11-06). Prefix /api/org/profile CỐ Ý nằm ngoài allowlist token AI (AccessTokenAuth):
/// CCCD / tài khoản ngân hàng không bao giờ ra MCP.
/// - Nhân viên: xem hồ sơ của mình, tự sửa liên hệ + ảnh (hiệu lực ngay), gửi yêu cầu đổi ngày sinh / CCCD / ngân hàng (HR duyệt).
/// - HR: duyệt / từ chối yêu cầu, xem + sửa thẳng thông tin cá nhân của nhân viên. Email chỉ HR đổi (form hồ sơ nhân viên).
/// </summary>
internal static class ProfileEndpoints
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static void Map(RouteGroupBuilder org)
    {
        var g = org.MapGroup("/profile").WithTags("Organization");
        g.MapGet("/me", MeAsync);
        g.MapPut("/me/contact", SaveContactAsync);
        g.MapPost("/me/avatar", UploadAvatarAsync).DisableAntiforgery();
        g.MapDelete("/me/avatar", DeleteAvatarAsync);
        g.MapPost("/me/requests", SubmitAsync);
        g.MapDelete("/me/requests/{id:guid}", CancelAsync);
        g.MapGet("/avatars/{employeeId:guid}", AvatarAsync);

        var hr = g.MapGroup("").RequireAuthorization(AuthPolicies.Hr);
        hr.MapGet("/requests", ListRequestsAsync);
        hr.MapPost("/requests/{id:guid}/approve", ApproveAsync);
        hr.MapPost("/requests/{id:guid}/reject", RejectAsync);
        hr.MapGet("/employees/{id:guid}", HrGetAsync);
        hr.MapPut("/employees/{id:guid}", HrUpdateAsync);
    }

    // ---------------- Hỗ trợ ----------------

    internal static string? AvatarUrl(Employee e) =>
        e.AvatarKey is { } k ? $"/api/org/profile/avatars/{e.Id}?v={Path.GetFileNameWithoutExtension(k)}" : null;

    private static ProblemHttpResult NoProfile() =>
        TypedResults.Problem("Tài khoản chưa gắn hồ sơ nhân viên", statusCode: StatusCodes.Status404NotFound, title: "no_employee_profile");

    private static Task<Employee?> MineAsync(ClaimsPrincipal user, OrgDbContext db, CancellationToken ct)
    {
        var uid = user.GetUserId();
        return db.Employees.FirstOrDefaultAsync(e => e.UserId == uid && e.Status != EmployeeStatus.Resigned, ct);
    }

    private static string? Dec(IFieldEncryptor enc, string? token) => token is null ? null : enc.Decrypt(token);
    private static string? Enc(IFieldEncryptor enc, string? plain) => string.IsNullOrEmpty(plain) ? null : enc.Encrypt(plain);
    private static string? Clean(string? s, int max) => string.IsNullOrWhiteSpace(s) ? null : s.Trim()[..Math.Min(s.Trim().Length, max)];
    private static DateOnly Today(IOptions<OfficeSettings> o, TimeProvider clock) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), TimeZoneInfo.FindSystemTimeZoneById(o.Value.TimeZone)).DateTime);

    private static ContactDto Contact(Employee e) => new(e.Phone, e.CurrentAddress, e.PermanentAddress, e.EmergencyContactName, e.EmergencyContactRelation, e.EmergencyContactPhone);
    private static SensitiveDto Sensitive(Employee e, IFieldEncryptor enc) =>
        new(e.DateOfBirth, Dec(enc, e.IdNumberEncrypted), e.IdIssuedOn, e.IdIssuedPlace, e.BankName, Dec(enc, e.BankAccountEncrypted), e.BankAccountHolder);

    private static Validation ValidateContact(ContactDto c) => new Validation()
        .When(!PersonalProfile.ValidPhone(c.Phone), "phone", "Số điện thoại không hợp lệ")
        .When(!PersonalProfile.ValidPhone(c.EmergencyContactPhone), "emergencyContactPhone", "Số điện thoại không hợp lệ")
        .MaxLength(c.CurrentAddress, PersonalProfile.AddressMax, "currentAddress", "Địa chỉ hiện tại")
        .MaxLength(c.PermanentAddress, PersonalProfile.AddressMax, "permanentAddress", "Địa chỉ thường trú")
        .MaxLength(c.EmergencyContactName, PersonalProfile.NameMax, "emergencyContactName", "Người liên hệ")
        .MaxLength(c.EmergencyContactRelation, PersonalProfile.RelationMax, "emergencyContactRelation", "Quan hệ");

    private static void ApplyContact(Employee e, ContactDto c)
    {
        e.Phone = Clean(c.Phone, 30);
        e.CurrentAddress = Clean(c.CurrentAddress, PersonalProfile.AddressMax);
        e.PermanentAddress = Clean(c.PermanentAddress, PersonalProfile.AddressMax);
        e.EmergencyContactName = Clean(c.EmergencyContactName, PersonalProfile.NameMax);
        e.EmergencyContactRelation = Clean(c.EmergencyContactRelation, PersonalProfile.RelationMax);
        e.EmergencyContactPhone = Clean(c.EmergencyContactPhone, 30);
    }

    /// <summary>Áp yêu cầu đã duyệt: null = giữ nguyên; chuỗi rỗng = xoá.</summary>
    private static void ApplySensitive(Employee e, SensitiveChange c, IFieldEncryptor enc)
    {
        if (c.ClearDateOfBirth) e.DateOfBirth = null; else if (c.DateOfBirth is { } d) e.DateOfBirth = d;
        if (c.IdNumber is not null) e.IdNumberEncrypted = Enc(enc, c.IdNumber);
        if (c.IdIssuedOn is { } iss) e.IdIssuedOn = iss;
        if (c.IdIssuedPlace is not null) e.IdIssuedPlace = c.IdIssuedPlace.Length == 0 ? null : c.IdIssuedPlace;
        if (c.BankName is not null) e.BankName = c.BankName.Length == 0 ? null : c.BankName;
        if (c.BankAccount is not null) e.BankAccountEncrypted = Enc(enc, c.BankAccount);
        if (c.BankAccountHolder is not null) e.BankAccountHolder = c.BankAccountHolder.Length == 0 ? null : c.BankAccountHolder;
    }

    private static List<FieldDiffDto> Diff(Employee e, SensitiveChange c, IFieldEncryptor enc)
    {
        static string? D(DateOnly? d) => d?.ToString("yyyy-MM-dd");
        static string? Blank(string? s) => string.IsNullOrEmpty(s) ? null : s;
        var cur = Sensitive(e, enc);
        var list = new List<FieldDiffDto>();
        void Add(string f, string label, string? oldV, string? newV) { if (oldV != newV) list.Add(new(f, label, oldV, newV)); }
        if (c.ClearDateOfBirth) Add("dateOfBirth", "Ngày sinh", D(cur.DateOfBirth), null);
        else if (c.DateOfBirth is { } dob) Add("dateOfBirth", "Ngày sinh", D(cur.DateOfBirth), D(dob));
        if (c.IdNumber is not null) Add("idNumber", "Số CCCD", cur.IdNumber, Blank(c.IdNumber));
        if (c.IdIssuedOn is { } iss) Add("idIssuedOn", "Ngày cấp CCCD", D(cur.IdIssuedOn), D(iss));
        if (c.IdIssuedPlace is not null) Add("idIssuedPlace", "Nơi cấp CCCD", cur.IdIssuedPlace, Blank(c.IdIssuedPlace));
        if (c.BankName is not null) Add("bankName", "Ngân hàng", cur.BankName, Blank(c.BankName));
        if (c.BankAccount is not null) Add("bankAccount", "Số tài khoản", cur.BankAccount, Blank(c.BankAccount));
        if (c.BankAccountHolder is not null) Add("bankAccountHolder", "Chủ tài khoản", cur.BankAccountHolder, Blank(c.BankAccountHolder));
        return list;
    }

    private static SensitiveChange Read(ProfileChangeRequest r, IFieldEncryptor enc) =>
        JsonSerializer.Deserialize<SensitiveChange>(enc.Decrypt(r.DataEncrypted), Json)!;

    private static ProfileRequestDto ToDto(ProfileChangeRequest r, Employee e, IFieldEncryptor enc) =>
        new(r.Id, e.Id, e.Code, e.FullName, r.Status.ToString(), r.CreatedAt, r.DecidedAt, r.DecidedByName, r.RejectReason, r.Note,
            r.Status == ProfileRequestStatus.Pending ? Diff(e, Read(r, enc), enc)
                // đã xử lý: hồ sơ có thể đã đổi tiếp → chỉ liệt kê giá trị yêu cầu
                : Diff(new Employee { Code = e.Code, FullName = e.FullName }, Read(r, enc), enc).Select(d => d with { Old = null }).ToList());

    // ---------------- Nhân viên ----------------

    private static async Task<Results<Ok<MyProfileDto>, ProblemHttpResult>> MeAsync(ClaimsPrincipal user, OrgDbContext db, IFieldEncryptor enc, CancellationToken ct)
    {
        var e = await MineAsync(user, db, ct);
        if (e is null) return NoProfile();
        return TypedResults.Ok(await ToMyProfileAsync(e, db, enc, ct));
    }

    private static async Task<MyProfileDto> ToMyProfileAsync(Employee e, OrgDbContext db, IFieldEncryptor enc, CancellationToken ct)
    {
        var dept = e.DepartmentId is { } d ? await db.Departments.Where(x => x.Id == d).Select(x => x.Name).FirstOrDefaultAsync(ct) : null;
        var pos = e.PositionId is { } p ? await db.Positions.IgnoreQueryFilters().Where(x => x.Id == p).Select(x => x.Name).FirstOrDefaultAsync(ct) : null;
        var mgr = e.ManagerId is { } m ? await db.Employees.Where(x => x.Id == m).Select(x => x.FullName).FirstOrDefaultAsync(ct) : null;
        var reqs = await db.ProfileRequests.AsNoTracking().Where(r => r.EmployeeId == e.Id).OrderByDescending(r => r.CreatedAt).Take(5).ToListAsync(ct);
        var pending = reqs.FirstOrDefault(r => r.Status == ProfileRequestStatus.Pending);
        var last = reqs.FirstOrDefault(r => r.Status is ProfileRequestStatus.Approved or ProfileRequestStatus.Rejected);
        return new MyProfileDto(e.Id, e.Code, e.FullName, e.Email, dept, pos, e.JobTitle, mgr, e.JoinedAt, e.Status.ToString(), AvatarUrl(e),
            Contact(e), Sensitive(e, enc), pending is null ? null : ToDto(pending, e, enc), last is null ? null : ToDto(last, e, enc));
    }

    private static async Task<Results<Ok<MyProfileDto>, ProblemHttpResult, ValidationProblem>> SaveContactAsync(ContactDto body, ClaimsPrincipal user,
        OrgDbContext db, IFieldEncryptor enc, CancellationToken ct)
    {
        var e = await MineAsync(user, db, ct);
        if (e is null) return NoProfile();
        var v = ValidateContact(body);
        if (v.Failed) return v.Problem();
        ApplyContact(e, body);
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(await ToMyProfileAsync(e, db, enc, ct));
    }

    private static async Task<Results<Ok<string>, ProblemHttpResult, ValidationProblem>> UploadAvatarAsync(IFormFile file, ClaimsPrincipal user,
        OrgDbContext db, IFileStorage storage, CancellationToken ct)
    {
        var e = await MineAsync(user, db, ct);
        if (e is null) return NoProfile();
        if (!PersonalProfile.AvatarTypes.TryGetValue(file.ContentType, out var ext))
            return new Validation().Add("file", "Ảnh phải là JPG, PNG hoặc WebP").Problem();
        if (file.Length is 0 or > PersonalProfile.AvatarMaxBytes)
            return new Validation().Add("file", "Ảnh tối đa 2 MB").Problem();
        var old = e.AvatarKey;
        var key = $"employees/{e.Id}/avatar/{Guid.NewGuid():N}.{ext}";
        await using (var s = file.OpenReadStream()) await storage.UploadAsync(key, s, file.ContentType, ct);
        e.AvatarKey = key;
        await db.SaveChangesAsync(ct);
        if (old is not null) try { await storage.DeleteAsync(old, ct); } catch (Exception x) when (x is not OperationCanceledException) { /* best effort */ }
        return TypedResults.Ok(AvatarUrl(e)!);
    }

    private static async Task<Results<NoContent, ProblemHttpResult>> DeleteAvatarAsync(ClaimsPrincipal user, OrgDbContext db, IFileStorage storage, CancellationToken ct)
    {
        var e = await MineAsync(user, db, ct);
        if (e is null) return NoProfile();
        if (e.AvatarKey is { } old)
        {
            e.AvatarKey = null;
            await db.SaveChangesAsync(ct);
            try { await storage.DeleteAsync(old, ct); } catch (Exception x) when (x is not OperationCanceledException) { /* best effort */ }
        }
        return TypedResults.NoContent();
    }

    /// <summary>Ảnh đại diện (ai đăng nhập cũng xem) → chuyển hướng tới link S3 tạm (15 phút). ?v= đổi khi đổi ảnh để thẻ img tải lại.
    /// Lưu ý: pipeline xác thực đặt Cache-Control no-store cho response API nên mỗi lần hiển thị gọi lại endpoint này (rẻ: 1 truy vấn + ký link).</summary>
    private static async Task<Results<RedirectHttpResult, NotFound>> AvatarAsync(Guid employeeId, OrgDbContext db, IFileStorage storage, CancellationToken ct)
    {
        var key = await db.Employees.Where(e => e.Id == employeeId).Select(e => e.AvatarKey).FirstOrDefaultAsync(ct);
        if (key is null) return TypedResults.NotFound();
        return TypedResults.Redirect(await storage.GetDownloadUrlAsync(key, TimeSpan.FromMinutes(15)));
    }

    private static async Task<Results<Ok<ProfileRequestDto>, ProblemHttpResult, ValidationProblem>> SubmitAsync(SubmitRequestBody body, ClaimsPrincipal user,
        OrgDbContext db, IFieldEncryptor enc, IAccountService accounts, INotifier notifier, IOptions<OfficeSettings> office, TimeProvider clock, CancellationToken ct)
    {
        var e = await MineAsync(user, db, ct);
        if (e is null) return NoProfile();
        var change = PersonalProfile.Normalize(body.Change);
        var errors = PersonalProfile.Validate(change, Today(office, clock)).ToList();
        var v = new Validation();
        foreach (var (f, err) in errors) v.Add(f.Length == 0 ? "change" : f, err);
        if (body.Note is { Length: > 500 }) v.Add("note", "Ghi chú tối đa 500 ký tự");
        if (v.Failed) return v.Problem();
        if (Diff(e, change, enc).Count == 0) return new Validation().Add("change", "Thông tin giống hiện tại — không có gì để cập nhật").Problem();
        if (await db.ProfileRequests.AnyAsync(r => r.EmployeeId == e.Id && r.Status == ProfileRequestStatus.Pending, ct))
            return Problems.Conflict("Bạn đang có một yêu cầu chờ HR duyệt — huỷ yêu cầu đó trước khi gửi yêu cầu mới");

        var r = new ProfileChangeRequest
        {
            EmployeeId = e.Id, Status = ProfileRequestStatus.Pending, CreatedAt = clock.GetUtcNow(), Note = Clean(body.Note, 500),
            DataEncrypted = enc.Encrypt(JsonSerializer.Serialize(change, Json)),
        };
        db.ProfileRequests.Add(r);
        await db.SaveChangesAsync(ct);
        var hr = (await accounts.ListByRoleAsync(Roles.Hr, ct)).Select(a => a.Id).Where(id => id != user.GetUserId()).ToList();
        if (hr.Count > 0)
            await notifier.NotifyAsync(new NotificationRequest(hr, NotificationCategories.ProfileChangeRequested, $"{e.FullName} đề nghị cập nhật thông tin cá nhân",
                "Ngày sinh / CCCD / tài khoản ngân hàng — vào Nhân viên → Yêu cầu cập nhật để duyệt.", "/employees", SendEmail: false), ct);
        return TypedResults.Ok(ToDto(r, e, enc));
    }

    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> CancelAsync(Guid id, ClaimsPrincipal user, OrgDbContext db, TimeProvider clock, CancellationToken ct)
    {
        var e = await MineAsync(user, db, ct);
        if (e is null) return NoProfile();
        var r = await db.ProfileRequests.FirstOrDefaultAsync(x => x.Id == id && x.EmployeeId == e.Id, ct);
        if (r is null) return TypedResults.NotFound();
        if (r.Status != ProfileRequestStatus.Pending) return Problems.Conflict("Yêu cầu đã được xử lý");
        r.Status = ProfileRequestStatus.Cancelled;
        r.DecidedAt = clock.GetUtcNow();
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    // ---------------- HR ----------------

    private static async Task<Ok<List<ProfileRequestDto>>> ListRequestsAsync(string? status, OrgDbContext db, IFieldEncryptor enc, CancellationToken ct)
    {
        var q = db.ProfileRequests.AsNoTracking();
        q = Enum.TryParse<ProfileRequestStatus>(status, true, out var st) ? q.Where(r => r.Status == st) : q.Where(r => r.Status == ProfileRequestStatus.Pending);
        var rows = await q.OrderByDescending(r => r.CreatedAt).Take(200).ToListAsync(ct);
        var ids = rows.Select(r => r.EmployeeId).Distinct().ToList();
        var emps = await db.Employees.AsNoTracking().Where(e => ids.Contains(e.Id)).ToDictionaryAsync(e => e.Id, ct);
        return TypedResults.Ok(rows.Where(r => emps.ContainsKey(r.EmployeeId)).Select(r => ToDto(r, emps[r.EmployeeId], enc)).ToList());
    }

    private static async Task<Results<Ok<ProfileRequestDto>, NotFound, ProblemHttpResult>> ApproveAsync(Guid id, ClaimsPrincipal user, OrgDbContext db,
        IFieldEncryptor enc, INotifier notifier, TimeProvider clock, CancellationToken ct)
    {
        var r = await db.ProfileRequests.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (r is null) return TypedResults.NotFound();
        if (r.Status != ProfileRequestStatus.Pending) return Problems.Conflict("Yêu cầu đã được xử lý");
        var e = await db.Employees.FirstAsync(x => x.Id == r.EmployeeId, ct);
        if (IsSelfByNonAdmin(user, e)) return SelfForbidden();
        var dto = ToDto(r, e, enc); // diff trước khi áp
        ApplySensitive(e, Read(r, enc), enc);
        r.Status = ProfileRequestStatus.Approved;
        r.DecidedAt = clock.GetUtcNow();
        r.DecidedByName = user.FindFirstValue(ClaimNames.FullName);
        await db.SaveChangesAsync(ct);
        if (e.UserId is { } uid)
            await notifier.NotifyAsync(new NotificationRequest([uid], NotificationCategories.ProfileChangeApproved, "Thông tin cá nhân đã được cập nhật",
                $"HR đã duyệt yêu cầu cập nhật: {string.Join(", ", dto.Changes.Select(c => c.Label))}.", "/profile", SendEmail: false), ct);
        return TypedResults.Ok(dto with { Status = r.Status.ToString(), DecidedAt = r.DecidedAt, DecidedByName = r.DecidedByName });
    }

    private static async Task<Results<NoContent, NotFound, ProblemHttpResult, ValidationProblem>> RejectAsync(Guid id, RejectBody body, ClaimsPrincipal user,
        OrgDbContext db, INotifier notifier, TimeProvider clock, CancellationToken ct)
    {
        var v = new Validation().Required(body.Reason, "reason", "Lý do").MaxLength(body.Reason, 500, "reason", "Lý do");
        if (v.Failed) return v.Problem();
        var r = await db.ProfileRequests.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (r is null) return TypedResults.NotFound();
        if (r.Status != ProfileRequestStatus.Pending) return Problems.Conflict("Yêu cầu đã được xử lý");
        r.Status = ProfileRequestStatus.Rejected;
        r.RejectReason = body.Reason.Trim();
        r.DecidedAt = clock.GetUtcNow();
        r.DecidedByName = user.FindFirstValue(ClaimNames.FullName);
        await db.SaveChangesAsync(ct);
        var uid = await db.Employees.Where(x => x.Id == r.EmployeeId).Select(x => x.UserId).FirstOrDefaultAsync(ct);
        if (uid is { } u)
            await notifier.NotifyAsync(new NotificationRequest([u], NotificationCategories.ProfileChangeRejected, "Yêu cầu cập nhật thông tin bị từ chối",
                $"Lý do: {r.RejectReason}", "/profile", SendEmail: false), ct);
        return TypedResults.NoContent();
    }

    private static async Task<Results<Ok<MyProfileDto>, NotFound>> HrGetAsync(Guid id, OrgDbContext db, IFieldEncryptor enc, CancellationToken ct)
    {
        var e = await db.Employees.FirstOrDefaultAsync(x => x.Id == id, ct);
        return e is null ? TypedResults.NotFound() : TypedResults.Ok(await ToMyProfileAsync(e, db, enc, ct));
    }

    private static async Task<Results<Ok<MyProfileDto>, NotFound, ValidationProblem, ProblemHttpResult>> HrUpdateAsync(Guid id, HrUpdateBody body,
        ClaimsPrincipal user, OrgDbContext db, IFieldEncryptor enc, IOptions<OfficeSettings> office, TimeProvider clock, CancellationToken ct)
    {
        var e = await db.Employees.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (e is null) return TypedResults.NotFound();
        if (IsSelfByNonAdmin(user, e)) return SelfForbidden();
        var s = body.Sensitive;
        // Thay toàn bộ: null → chuỗi rỗng (= xoá) cho đúng ngữ nghĩa SensitiveChange
        var change = PersonalProfile.Normalize(new SensitiveChange(s.DateOfBirth, s.DateOfBirth is null, s.IdNumber ?? "", s.IdIssuedOn, s.IdIssuedPlace ?? "",
            s.BankName ?? "", s.BankAccount ?? "", s.BankAccountHolder ?? ""));
        var v = ValidateContact(body.Contact);
        foreach (var (f, err) in PersonalProfile.Validate(change, Today(office, clock)).Where(x => x.Field.Length > 0)) v.Add(f, err);
        if (v.Failed) return v.Problem();
        ApplyContact(e, body.Contact);
        ApplySensitive(e, change, enc);
        if (s.IdIssuedOn is null) e.IdIssuedOn = null;
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(await ToMyProfileAsync(e, db, enc, ct));
    }

    /// <summary>
    /// Tách nhiệm vụ (TEST-10): HR không tự duyệt / sửa thẳng CCCD, số tài khoản ngân hàng của chính mình (đổi STK nhận lương không ai kiểm).
    /// Nhờ HR khác hoặc admin. Admin giữ nguyên theo thiết kế.
    /// </summary>
    private static bool IsSelfByNonAdmin(ClaimsPrincipal user, Employee e) =>
        e.UserId is { } uid && uid == user.GetUserId() && !user.IsInRole(Roles.Admin);

    private static ProblemHttpResult SelfForbidden() => TypedResults.Problem(
        "Không tự duyệt / sửa thông tin cá nhân nhạy cảm của chính mình — nhờ HR khác hoặc admin", statusCode: StatusCodes.Status403Forbidden);
}
