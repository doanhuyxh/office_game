using System.Security.Claims;
using Livekit.Server.Sdk.Dotnet;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.Realtime.Auth;
using OfficeHub.Realtime.Simulation;

namespace OfficeHub.Realtime.Voice;

public sealed class LiveKitSettings
{
    public const string Section = "LiveKit";
    /// <summary>URL WebSocket LiveKit mà trình duyệt kết nối, ví dụ wss://voice.congty.vn.</summary>
    public string? Url { get; set; }
    public string? ApiKey { get; set; }
    public string? ApiSecret { get; set; }
    public bool Enabled => !string.IsNullOrWhiteSpace(Url) && !string.IsNullOrWhiteSpace(ApiKey) && !string.IsNullOrWhiteSpace(ApiSecret);

    /// <summary>URL HTTP nội bộ tới API LiveKit (tuỳ chọn, vd http://host.docker.internal:7880). Trống → suy ra từ <see cref="Url"/>.</summary>
    public string? ApiUrl { get; set; }

    /// <summary>URL HTTP của API LiveKit (đẩy người khỏi room): <see cref="ApiUrl"/>, hoặc từ <see cref="Url"/> (ws → http, wss → https).</summary>
    public string ApiHttpUrl => !string.IsNullOrWhiteSpace(ApiUrl) ? ApiUrl
        : Url!.StartsWith("wss://", StringComparison.OrdinalIgnoreCase) ? "https://" + Url[6..]
        : Url.StartsWith("ws://", StringComparison.OrdinalIgnoreCase) ? "http://" + Url[5..] : Url;
}

/// <param name="Room">Tên room LiveKit.</param>
/// <param name="Channel">Id phòng trên bản đồ (rooms[].id) hoặc "open".</param>
/// <param name="Meeting">Phòng có voice: "room" — cả phòng nghe rõ, được chia sẻ màn hình.</param>
public sealed record VoiceTokenResponse(string Url, string Token, string Room, string Channel, bool Meeting);

public static class VoiceEndpoints
{
    public static void MapVoice(this IEndpointRouteBuilder app)
    {
        // Cấp token voice cho kênh tại VỊ TRÍ HIỆN TẠI của người dùng trong văn phòng (server quyết định, không nhận tên room từ client)
        // → không vào nghe lén phòng họp khi đang đứng ngoài. Client so `channel` trả về với kênh nó mong muốn; lệch thì thử lại sau.
        app.MapPost("/rt/voice/token", async (HttpContext http, ClaimsPrincipal user, IOptions<LiveKitSettings> opt,
            SessionValidator sessions, Presence presence, OfficeMap map, VoiceGuard guard) =>
        {
            if (await sessions.CheckAsync(SessionValidator.AuthCookieHeader(http.Request.Headers.Cookie.ToString()), http.RequestAborted)
                == SessionState.Invalid)
                return Results.Unauthorized();
            var cfg = opt.Value;
            if (!cfg.Enabled) return Results.Problem("Voice chưa được cấu hình (LiveKit__*)", statusCode: 503);

            var userId = user.FindFirstValue(ClaimTypes.NameIdentifier)!;
            if (!presence.TryGet(userId, out var p))
                return Results.Problem("Hãy vào văn phòng 3D trước khi bật voice", statusCode: 409);

            VoiceChannel ch;
            string? previous;
            lock (p)
            {
                ch = map.VoiceAt(p.X, p.Z);
                previous = p.VoiceRoom;
                p.VoiceRoom = ch.LiveKitRoom;
                p.VoiceMismatchSince = null;
            }
            // Đổi kênh: chủ động đẩy khỏi room cũ (client tử tế đã tự rời; client sửa code thì vẫn bị cắt)
            if (previous is not null && previous != ch.LiveKitRoom) guard.Kick(previous, userId);

            var sources = ch.Meeting ? new[] { "microphone", "screen_share", "screen_share_audio" } : new[] { "microphone" };
            var grants = new VideoGrants { RoomJoin = true, Room = ch.LiveKitRoom, CanSubscribe = true, CanPublish = true, CanPublishData = false };
            grants.CanPublishSources.AddRange(sources);
            var token = new AccessToken(cfg.ApiKey!, cfg.ApiSecret!)
                .WithIdentity(userId)
                .WithName(user.FindFirstValue(ClaimNames.FullName) ?? user.Identity?.Name ?? "?")
                .WithGrants(grants)
                .WithTtl(TimeSpan.FromMinutes(10)) // chỉ dùng để vào room; LiveKit tự gia hạn trong phiên
                .ToJwt();
            return Results.Ok(new VoiceTokenResponse(cfg.Url!, token, ch.LiveKitRoom, ch.Id, ch.Meeting));
        }).RequireAuthorization();
    }
}
