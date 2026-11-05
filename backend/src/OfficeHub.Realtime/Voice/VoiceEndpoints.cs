using System.Security.Claims;
using Livekit.Server.Sdk.Dotnet;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.Realtime.Auth;

namespace OfficeHub.Realtime.Voice;

public sealed class LiveKitSettings
{
    public const string Section = "LiveKit";
    /// <summary>URL WebSocket LiveKit mà trình duyệt kết nối, ví dụ wss://voice.congty.vn.</summary>
    public string? Url { get; set; }
    public string? ApiKey { get; set; }
    public string? ApiSecret { get; set; }
    public bool Enabled => !string.IsNullOrWhiteSpace(Url) && !string.IsNullOrWhiteSpace(ApiKey) && !string.IsNullOrWhiteSpace(ApiSecret);
}

public sealed record VoiceTokenResponse(string Url, string Token, string Room);

public static class VoiceEndpoints
{
    public static void MapVoice(this IEndpointRouteBuilder app)
    {
        // Cấp token vào phòng voice (phòng họp, khu vực). Room do server quyết định theo vị trí — tạm nhận từ query.
        app.MapPost("/rt/voice/token", async (string room, HttpContext http, ClaimsPrincipal user, IOptions<LiveKitSettings> opt,
            SessionValidator sessions) =>
        {
            if (await sessions.CheckAsync(SessionValidator.AuthCookieHeader(http.Request.Headers.Cookie.ToString()), http.RequestAborted)
                == SessionState.Invalid)
                return Results.Unauthorized();
            var cfg = opt.Value;
            if (!cfg.Enabled) return Results.Problem("Voice chưa được cấu hình (LiveKit__*)", statusCode: 503);

            var token = new AccessToken(cfg.ApiKey!, cfg.ApiSecret!)
                .WithIdentity(user.FindFirstValue(ClaimTypes.NameIdentifier)!)
                .WithName(user.FindFirstValue(ClaimNames.FullName) ?? user.Identity?.Name ?? "?")
                .WithGrants(new VideoGrants { RoomJoin = true, Room = room })
                .WithTtl(TimeSpan.FromHours(2))
                .ToJwt();
            return Results.Ok(new VoiceTokenResponse(cfg.Url!, token, room));
        }).RequireAuthorization();
    }
}
