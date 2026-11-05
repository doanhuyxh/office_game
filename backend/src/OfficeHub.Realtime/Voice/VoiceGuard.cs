using Livekit.Server.Sdk.Dotnet;
using Microsoft.Extensions.Options;
using OfficeHub.Realtime.Simulation;

namespace OfficeHub.Realtime.Voice;

/// <summary>
/// Giữ voice khớp vị trí: ai đã ra khỏi phòng (kênh tại vị trí khác room đã cấp token) quá <see cref="Grace"/> thì bị đẩy khỏi room LiveKit.
/// Client tử tế tự đổi kênh trong ~0,5 giây; guard chỉ để client bị sửa không ở lại nghe lén. Rời văn phòng / bị kick → cũng đẩy khỏi voice.
/// </summary>
public sealed class VoiceGuard(Presence presence, OfficeMap map, IOptions<LiveKitSettings> options, ILogger<VoiceGuard> log) : BackgroundService
{
    public static readonly TimeSpan Grace = TimeSpan.FromSeconds(3);
    private readonly RoomServiceClient? _rooms = options.Value.Enabled
        ? new RoomServiceClient(options.Value.ApiHttpUrl, options.Value.ApiKey!, options.Value.ApiSecret!)
        : null;

    /// <summary>Đẩy <paramref name="identity"/> khỏi room (không chờ; không có trong room thì bỏ qua).</summary>
    public void Kick(string room, string identity)
    {
        if (_rooms is null) return;
        _ = Task.Run(async () =>
        {
            try
            {
                await _rooms.RemoveParticipant(new RoomParticipantIdentity { Room = room, Identity = identity });
                log.LogInformation("Đẩy {User} khỏi voice {Room}", identity, room);
            }
            catch (Exception ex)
            {
                // not_found (đã tự rời / room đã đóng) là bình thường
                log.LogDebug(ex, "Không đẩy được {User} khỏi voice {Room}", identity, room);
            }
        });
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        if (_rooms is null) return;
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1));
        while (await timer.WaitForNextTickAsync(ct))
        {
            var now = DateTimeOffset.UtcNow;
            foreach (var p in presence.All)
            {
                string? kick = null;
                lock (p)
                {
                    if (p.VoiceRoom is null) continue;
                    if (map.VoiceAt(p.X, p.Z).LiveKitRoom == p.VoiceRoom) { p.VoiceMismatchSince = null; continue; }
                    p.VoiceMismatchSince ??= now;
                    if (now - p.VoiceMismatchSince < Grace) continue;
                    kick = p.VoiceRoom;
                    p.VoiceRoom = null;
                    p.VoiceMismatchSince = null;
                }
                Kick(kick, p.UserId);
            }
        }
    }
}
