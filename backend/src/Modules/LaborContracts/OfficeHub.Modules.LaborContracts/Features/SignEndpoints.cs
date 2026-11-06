using System.Net;
using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Email;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.BuildingBlocks.Storage;
using OfficeHub.Modules.Identity.Contracts;
using OfficeHub.Modules.LaborContracts.Domain;
using OfficeHub.Modules.LaborContracts.Infrastructure;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.LaborContracts.Features;

public sealed record SignRequestDto(Guid Id, Guid ContractId, string ContractNumber, Guid EmployeeId, string EmployeeName, string Status,
    DateTimeOffset CreatedAt, string? CreatedByName, DateTimeOffset ExpiresAt, DateTimeOffset? OtpSentAt, DateTimeOffset? SignedAt,
    string OriginalSha256, string? SignedSha256, bool CanSign);
public sealed record OtpSentDto(string SentTo, DateTimeOffset ExpiresAt);
/// <summary>signature = data URL "data:image/png;base64,…" (vẽ trên canvas); agree phải true.</summary>
public sealed record SignRequestBody(string Otp, string Signature, bool Agree);

/// <summary>
/// Ký điện tử hợp đồng (nội bộ + OTP email). HR gửi yêu cầu trên file PDF của hợp đồng → nhân viên xem, nhận OTP, vẽ chữ ký →
/// server so SHA-256 bản gốc, đóng dấu (PdfSigner), lưu bản đã ký làm file chính thức của hợp đồng. Không có trong route token AI.
/// </summary>
internal static class SignEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapPost("/{id:guid}/sign-requests", CreateAsync).RequireAuthorization(AuthPolicies.Hr);
        g.MapGet("/sign-requests", ListAsync);
        g.MapDelete("/sign-requests/{rid:guid}", CancelAsync).RequireAuthorization(AuthPolicies.Hr);
        g.MapGet("/sign-requests/{rid:guid}/document", DocumentAsync);
        g.MapPost("/sign-requests/{rid:guid}/otp", SendOtpAsync);
        g.MapPost("/sign-requests/{rid:guid}/sign", SignAsync);
    }

    private static string StatusOf(SignRequest r, DateTimeOffset now) =>
        (r.Status == SignStatus.Pending && r.ExpiresAt <= now ? SignStatus.Expired : r.Status).ToString();

    private static async Task<List<SignRequestDto>> ToDtosAsync(List<SignRequest> rows, ContractsDbContext db, IEmployeeDirectory dir, Guid? me, DateTimeOffset now,
        CancellationToken ct)
    {
        var cids = rows.Select(r => r.ContractId).Distinct().ToList();
        var numbers = await db.Contracts.IgnoreQueryFilters().AsNoTracking().Where(c => cids.Contains(c.Id)).ToDictionaryAsync(c => c.Id, c => c.Number, ct);
        var list = new List<SignRequestDto>();
        foreach (var r in rows)
        {
            var name = (await dir.GetAsync(r.EmployeeId, ct))?.FullName ?? "";
            var status = StatusOf(r, now);
            list.Add(new SignRequestDto(r.Id, r.ContractId, numbers.GetValueOrDefault(r.ContractId, ""), r.EmployeeId, name, status, r.CreatedAt,
                r.CreatedByName, r.ExpiresAt, r.OtpSentAt, r.SignedAt, r.OriginalSha256, r.SignedSha256, CanSign: status == "Pending" && r.SignerUserId == me));
        }
        return list;
    }

    /// <summary>HR gửi yêu cầu ký cho file PDF hiện tại của hợp đồng. Mỗi hợp đồng một yêu cầu đang chờ.</summary>
    private static async Task<Results<Ok<SignRequestDto>, NotFound, ProblemHttpResult>> CreateAsync(Guid id, ClaimsPrincipal user, ContractsDbContext db,
        IEmployeeDirectory dir, IFileStorage storage, INotifier notifier, TimeProvider clock, CancellationToken ct)
    {
        var c = await db.Contracts.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (c is null) return TypedResults.NotFound();
        if (c.File.Key is null || c.File.ContentType != "application/pdf")
            return TypedResults.Problem("Tải bản PDF của hợp đồng lên trước (có thể xuất từ mẫu Word rồi lưu PDF)", statusCode: StatusCodes.Status409Conflict);
        if (await dir.GetAsync(c.EmployeeId, ct) is not { UserId: { } signerUser } emp)
            return TypedResults.Problem("Nhân viên chưa có tài khoản đăng nhập nên chưa ký điện tử được", statusCode: StatusCodes.Status409Conflict);
        var now = clock.GetUtcNow();
        if (await db.SignRequests.AnyAsync(r => r.ContractId == id && r.Status == SignStatus.Pending && r.ExpiresAt > now, ct))
            return Problems.Conflict("Hợp đồng đang có yêu cầu ký chờ nhân viên — huỷ yêu cầu cũ trước");

        await using var file = await storage.OpenReadAsync(c.File.Key, ct);
        var r = new SignRequest
        {
            ContractId = c.Id, EmployeeId = c.EmployeeId, SignerUserId = signerUser, OriginalFileKey = c.File.Key,
            OriginalSha256 = SignRules.Sha256(file.ToArray()), Status = SignStatus.Pending, CreatedAt = now,
            CreatedByName = user.FindFirstValue(ClaimNames.FullName), ExpiresAt = now + SignRules.RequestLifetime,
        };
        db.SignRequests.Add(r);
        await db.SaveChangesAsync(ct);
        await notifier.NotifyAsync(new NotificationRequest([signerUser], NotificationCategories.ContractSignRequested,
            $"Hợp đồng {c.Number} chờ bạn ký", $"HR đã gửi hợp đồng {c.Number} để bạn xem và ký điện tử (hạn {SignRules.RequestLifetime.TotalDays:0} ngày).", "/contracts"), ct);
        return TypedResults.Ok((await ToDtosAsync([r], db, dir, user.GetUserId(), now, ct))[0]);
    }

    /// <summary>HR: mọi yêu cầu (lọc contractId); nhân viên: của mình.</summary>
    private static async Task<Ok<List<SignRequestDto>>> ListAsync(Guid? contractId, ClaimsPrincipal user, ContractsDbContext db, IEmployeeDirectory dir,
        TimeProvider clock, CancellationToken ct)
    {
        var uid = user.GetUserId();
        var q = db.SignRequests.AsNoTracking();
        if (!user.IsHr()) q = q.Where(r => r.SignerUserId == uid);
        if (contractId is { } cid) q = q.Where(r => r.ContractId == cid);
        var rows = await q.OrderByDescending(r => r.CreatedAt).Take(100).ToListAsync(ct);
        return TypedResults.Ok(await ToDtosAsync(rows, db, dir, uid, clock.GetUtcNow(), ct));
    }

    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> CancelAsync(Guid rid, ContractsDbContext db, CancellationToken ct)
    {
        var r = await db.SignRequests.FirstOrDefaultAsync(x => x.Id == rid, ct);
        if (r is null) return TypedResults.NotFound();
        if (r.Status != SignStatus.Pending) return Problems.Conflict("Chỉ huỷ được yêu cầu đang chờ ký");
        r.Status = SignStatus.Cancelled;
        r.OtpHash = null;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    /// <summary>Link xem bản gốc (signed=false) hoặc bản đã ký. Người ký hoặc HR.</summary>
    private static async Task<Results<Ok<FileUrlDto>, NotFound>> DocumentAsync(Guid rid, bool? signed, ClaimsPrincipal user, ContractsDbContext db,
        IFileStorage storage, CancellationToken ct)
    {
        var r = await db.SignRequests.AsNoTracking().FirstOrDefaultAsync(x => x.Id == rid, ct);
        if (r is null || (r.SignerUserId != user.GetUserId() && !user.IsHr())) return TypedResults.NotFound();
        var key = signed == true ? r.SignedFileKey : r.OriginalFileKey;
        if (key is null) return TypedResults.NotFound();
        return TypedResults.Ok(new FileUrlDto(await storage.GetDownloadUrlAsync(key), signed == true ? "hop-dong-da-ky.pdf" : "hop-dong.pdf"));
    }

    private static async Task<Results<Ok<OtpSentDto>, NotFound, ProblemHttpResult>> SendOtpAsync(Guid rid, ClaimsPrincipal user, ContractsDbContext db,
        IAccountService accounts, IEmployeeDirectory dir, IEmailSender email, IOptions<AppSettings> app, TimeProvider clock, ILogger<SignRequest> log,
        CancellationToken ct)
    {
        var r = await db.SignRequests.FirstOrDefaultAsync(x => x.Id == rid, ct);
        if (r is null || r.SignerUserId != user.GetUserId()) return TypedResults.NotFound();
        var now = clock.GetUtcNow();
        if (SignRules.CannotSendOtp(r, now) is { } why) return Problems.Conflict(why);
        var to = (await accounts.GetAsync(r.SignerUserId, ct))?.Email ?? (await dir.GetProfileAsync(r.EmployeeId, ct))?.Email;
        if (string.IsNullOrWhiteSpace(to)) return Problems.Conflict("Tài khoản chưa có email để nhận mã xác nhận — liên hệ HR");
        var number = await db.Contracts.Where(c => c.Id == r.ContractId).Select(c => c.Number).FirstAsync(ct);

        var otp = SignRules.NewOtp();
        r.OtpHash = SignRules.HashOtp(r.Id, otp);
        r.OtpSentAt = now;
        r.OtpExpiresAt = now + SignRules.OtpLifetime;
        r.OtpAttempts = 0;
        r.OtpSends++;
        await db.SaveChangesAsync(ct);
        try
        {
            await email.SendAsync(to, user.FindFirstValue(ClaimNames.FullName) ?? "", $"Mã xác nhận ký hợp đồng {number} — {app.Value.Name}",
                $"<p>Mã xác nhận ký điện tử hợp đồng <b>{WebUtility.HtmlEncode(number)}</b> của bạn là:</p>" +
                $"<p style=\"font-size:28px;font-weight:700;letter-spacing:6px\">{otp}</p>" +
                $"<p>Mã có hiệu lực {SignRules.OtpLifetime.TotalMinutes:0} phút. <b>Không chia sẻ mã này với bất kỳ ai</b> — kể cả HR.</p>" +
                "<p>Nếu bạn không yêu cầu ký, hãy bỏ qua email này và báo HR.</p>", ct);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            log.LogWarning(e, "Không gửi được OTP ký hợp đồng cho yêu cầu {Request}", r.Id);
            return TypedResults.Problem("Không gửi được email mã xác nhận, thử lại sau ít phút", statusCode: StatusCodes.Status503ServiceUnavailable);
        }
        return TypedResults.Ok(new OtpSentDto(PdfSigner.Mask(to), r.OtpExpiresAt.Value));
    }

    private static async Task<Results<Ok<SignRequestDto>, NotFound, ValidationProblem, ProblemHttpResult>> SignAsync(Guid rid, SignRequestBody body,
        HttpContext http, ClaimsPrincipal user, ContractsDbContext db, IEmployeeDirectory dir, IAccountService accounts, IFileStorage storage,
        INotifier notifier, IOptions<OfficeSettings> office, TimeProvider clock, CancellationToken ct)
    {
        var r = await db.SignRequests.FirstOrDefaultAsync(x => x.Id == rid, ct);
        if (r is null || r.SignerUserId != user.GetUserId()) return TypedResults.NotFound();
        var now = clock.GetUtcNow();
        if (r.Status != SignStatus.Pending || r.ExpiresAt <= now) return Problems.Conflict("Yêu cầu ký không còn hiệu lực");
        var png = SignRules.ParseSignaturePng(body.Signature);
        var v = new Validation()
            .When(!body.Agree, "agree", "Cần xác nhận đã đọc và đồng ý nội dung hợp đồng")
            .When(png is null, "signature", "Hãy vẽ chữ ký");
        if (v.Failed) return v.Problem();
        if (r.OtpAttempts >= SignRules.MaxOtpAttempts) return Problems.Conflict("Nhập sai mã quá nhiều lần — gửi lại mã mới");
        if (!SignRules.OtpMatches(r, body.Otp, now))
        {
            r.OtpAttempts++;
            await db.SaveChangesAsync(ct);
            return new Validation().Add("otp", r.OtpExpiresAt <= now ? "Mã đã hết hạn — gửi lại mã" : $"Mã không đúng (còn {SignRules.MaxOtpAttempts - r.OtpAttempts} lần thử)").Problem();
        }

        var c = await db.Contracts.FirstAsync(x => x.Id == r.ContractId, ct);
        await using var src = await storage.OpenReadAsync(r.OriginalFileKey, ct);
        var original = src.ToArray();
        if (SignRules.Sha256(original) != r.OriginalSha256)
            return Problems.Conflict("File hợp đồng đã thay đổi sau khi gửi ký — đề nghị HR gửi lại yêu cầu");

        var emp = await dir.GetAsync(r.EmployeeId, ct);
        var ip = http.Connection.RemoteIpAddress?.ToString();
        var ua = http.Request.Headers.UserAgent.ToString() is { Length: > 0 } u ? u[..Math.Min(u.Length, 512)] : null;
        var signerEmail = (await accounts.GetAsync(r.SignerUserId, ct))?.Email;
        byte[] signed;
        try
        {
            signed = PdfSigner.Stamp(original, png!, new SignStamp(c.Number, emp?.FullName ?? "", emp?.Code ?? "", signerEmail, now,
                TimeZoneInfo.FindSystemTimeZoneById(office.Value.TimeZone), ip, ua, r.OriginalSha256, r.Id, "email"));
        }
        catch (InvalidDataException e) { return Problems.Conflict(e.Message); }

        var folder = $"contracts/{c.EmployeeId}/{c.Id}/signed/{r.Id}";
        await storage.UploadAsync($"{folder}/signature.png", new MemoryStream(png!), "image/png", ct);
        await storage.UploadAsync($"{folder}/hop-dong-da-ky.pdf", new MemoryStream(signed), "application/pdf", ct);
        r.Status = SignStatus.Signed;
        r.SignedAt = now;
        r.SignerIp = ip;
        r.SignerUserAgent = ua;
        r.SignatureImageKey = $"{folder}/signature.png";
        r.SignedFileKey = $"{folder}/hop-dong-da-ky.pdf";
        r.SignedSha256 = SignRules.Sha256(signed);
        r.OtpHash = null;
        // Bản đã ký thành file chính thức của hợp đồng (bản gốc vẫn giữ trên S3, khoá lưu ở yêu cầu ký)
        c.File.Key = r.SignedFileKey;
        c.File.Name = $"{c.Number}-da-ky.pdf".Replace('/', '-');
        c.File.ContentType = "application/pdf";
        c.File.Size = signed.Length;
        c.SignedDate ??= DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, TimeZoneInfo.FindSystemTimeZoneById(office.Value.TimeZone)).DateTime);
        await db.SaveChangesAsync(ct);

        var hr = (await accounts.ListByRoleAsync(Roles.Hr, ct)).Select(a => a.Id).Where(id => id != r.SignerUserId).ToList();
        if (hr.Count > 0)
            await notifier.NotifyAsync(new NotificationRequest(hr, NotificationCategories.ContractSigned, $"{emp?.FullName} đã ký hợp đồng {c.Number}",
                "Bản đã ký điện tử được lưu làm file của hợp đồng.", "/contracts", SendEmail: false), ct);
        return TypedResults.Ok((await ToDtosAsync([r], db, dir, user.GetUserId(), now, ct))[0]);
    }
}
