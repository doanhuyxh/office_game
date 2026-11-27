using System.Security.Claims;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.BuildingBlocks.Security;
using OfficeHub.BuildingBlocks.Storage;
using OfficeHub.Modules.Settings.Domain;
using OfficeHub.Modules.Settings.Infrastructure;

namespace OfficeHub.Modules.Settings.Features;

/// <param name="LogoUrl">Link ảnh logo (<c>/api/branding/logo?v=…</c>, đổi khi lưu lại); null = chưa có logo.</param>
public sealed record BrandingDto(string Name, string? LogoUrl);

/// <summary>
/// Thông tin công ty (TEST-261). Admin: POST / DELETE <c>/api/system/settings/company/logo</c> (ảnh PNG / JPG / WebP ≤ 1 MB, S3 <c>settings/company/</c>).
/// Công khai (trang đăng nhập, trang chia sẻ, sidebar): GET <c>/api/branding</c> (tên + link logo) và <c>/api/branding/logo</c> (chuyển hướng link S3 tạm).
/// </summary>
internal static class CompanyEndpoints
{
    private static readonly Dictionary<string, string> LogoTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        ["image/png"] = "png", ["image/jpeg"] = "jpg", ["image/webp"] = "webp",
    };

    public static void MapAdmin(RouteGroupBuilder g)
    {
        g.MapPost("/company/logo", UploadLogoAsync).DisableAntiforgery();
        g.MapDelete("/company/logo", DeleteLogoAsync);
    }

    public static void MapPublic(IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/branding").WithTags("System").AllowAnonymous();
        g.MapGet("/", (RuntimeConfig runtime) => TypedResults.Ok(ToBranding(runtime.Company)));
        g.MapGet("/logo", LogoAsync);
    }

    internal static BrandingDto ToBranding(CompanySettings c) =>
        new(c.Name, c.LogoKey is null ? null : $"/api/branding/logo?v={c.UpdatedAt?.ToUnixTimeSeconds() ?? 0}");

    /// <summary>Không có logo → 404 (FE hiện biểu tượng mặc định). Link S3 tạm 15 phút như ảnh đại diện.</summary>
    private static async Task<Results<RedirectHttpResult, NotFound>> LogoAsync(RuntimeConfig runtime, IFileStorage files, CancellationToken ct) =>
        runtime.Company.LogoKey is { } key ? TypedResults.Redirect(await files.GetDownloadUrlAsync(key, TimeSpan.FromMinutes(15))) : TypedResults.NotFound();

    private static async Task<Results<Ok<SettingsGroupDto>, ValidationProblem>> UploadLogoAsync(IFormFile file, ClaimsPrincipal user,
        SettingsDbContext db, IFieldEncryptor enc, IFileStorage files, RuntimeConfig runtime, TimeProvider clock, CancellationToken ct)
    {
        if (!LogoTypes.TryGetValue(file.ContentType, out var ext))
            return new Validation().Add("file", "Logo phải là PNG, JPG hoặc WebP").Problem();
        if (file.Length is 0 or > CompanySettings.LogoMaxBytes)
            return new Validation().Add("file", "Logo tối đa 1 MB").Problem();
        // Chữ ký đầu file phải đúng loại ảnh khai báo (không tin Content-Type trình duyệt gửi) — như ảnh đại diện (TEST-13).
        await using (var head = file.OpenReadStream())
            if (!FileTypes.StreamMatches(head, ext)) return new Validation().Add("file", "Logo phải là PNG, JPG hoặc WebP").Problem();

        var key = $"{CompanySettings.LogoPrefix}logo-{Guid.NewGuid():N}.{ext}";
        await using (var s = file.OpenReadStream()) await files.UploadAsync(key, s, file.ContentType, ct);
        var old = runtime.Company.LogoKey;
        await SaveLogoKeyAsync(key, user, db, enc, runtime, clock, ct);
        if (old is not null) await DeleteQuietlyAsync(files, old, ct);
        return TypedResults.Ok(GroupDto(runtime));
    }

    private static async Task<Ok<SettingsGroupDto>> DeleteLogoAsync(ClaimsPrincipal user, SettingsDbContext db, IFieldEncryptor enc, IFileStorage files,
        RuntimeConfig runtime, TimeProvider clock, CancellationToken ct)
    {
        if (runtime.Company.LogoKey is { } old)
        {
            await SaveLogoKeyAsync(null, user, db, enc, runtime, clock, ct);
            await DeleteQuietlyAsync(files, old, ct);
        }
        return TypedResults.Ok(GroupDto(runtime));
    }

    /// <summary>Ghi logoKey vào nhóm company (chưa lưu → tạo với giá trị đang có hiệu lực, vd tên = App__Name).</summary>
    private static async Task SaveLogoKeyAsync(string? key, ClaimsPrincipal user, SettingsDbContext db, IFieldEncryptor enc, RuntimeConfig runtime,
        TimeProvider clock, CancellationToken ct)
    {
        var values = (JsonObject)(runtime.Stored(SettingsGroups.Company)?.Values ?? runtime.EnvValues(SettingsGroups.Company)).DeepClone();
        values["logoKey"] = key;
        await SettingsEndpoints.SaveRowAsync(db, enc, SettingsRules.Find(SettingsGroups.Company)!, values, [], user, clock, ct);
        runtime.Invalidate();
    }

    private static SettingsGroupDto GroupDto(RuntimeConfig runtime) => SettingsEndpoints.ToDto(SettingsRules.Find(SettingsGroups.Company)!, runtime);

    internal static async Task DeleteQuietlyAsync(IFileStorage files, string key, CancellationToken ct)
    {
        try { await files.DeleteAsync(key, ct); } catch (Exception x) when (x is not OperationCanceledException) { /* best effort — file mồ côi nhỏ */ }
    }
}
