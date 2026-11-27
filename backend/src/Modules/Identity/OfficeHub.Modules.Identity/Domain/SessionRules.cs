using System.Globalization;
using OfficeHub.BuildingBlocks.Configuration;

namespace OfficeHub.Modules.Identity.Domain;

/// <summary>
/// Thời hạn phiên web (TEST-259, <see cref="SessionSettings"/>). Cookie trượt: mỗi request gia hạn → <c>IssuedUtc</c> = lần hoạt động gần nhất.
/// Lúc đăng nhập ghi trong <c>AuthenticationProperties.Items</c> (<see cref="LoginAtKey"/>), giữ qua mọi lần gia hạn / cấp lại cookie.
/// </summary>
public static class SessionRules
{
    public const string LoginAtKey = ".officehub.login_at";

    public enum Verdict { Ok, Idle, TooOld }

    /// <param name="lastActivity">IssuedUtc của cookie (lần gia hạn gần nhất).</param>
    /// <param name="loginAt">Lúc đăng nhập (null = cookie cũ trước TEST-259, chưa có mốc → không xét thời hạn tối đa).</param>
    public static Verdict Check(DateTimeOffset? lastActivity, DateTimeOffset? loginAt, DateTimeOffset now, SessionSettings s)
    {
        if (lastActivity is { } last && now - last > s.Idle) return Verdict.Idle;
        if (s.MaxAge is { } max && loginAt is { } login && now - login > max) return Verdict.TooOld;
        return Verdict.Ok;
    }

    public static DateTimeOffset? ReadLoginAt(IDictionary<string, string?> items) =>
        items.TryGetValue(LoginAtKey, out var v) && DateTimeOffset.TryParse(v, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var t) ? t : null;

    public static void WriteLoginAt(IDictionary<string, string?> items, DateTimeOffset at) =>
        items[LoginAtKey] = at.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);
}
