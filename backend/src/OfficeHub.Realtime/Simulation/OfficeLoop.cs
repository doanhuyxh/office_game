using Microsoft.AspNetCore.SignalR;
using OfficeHub.Realtime.Chat;
using OfficeHub.Realtime.Hubs;

namespace OfficeHub.Realtime.Simulation;

/// <summary>
/// Vòng lặp 10 Hz: bot đang đi bộ bước tiếp (<see cref="BotPresence.Step"/>), gom vị trí đã thay đổi (người + bot) và phát cho cả phòng
/// trong một gói. Bot tới phòng có tường → báo Api cấp quyền kênh chat phòng (như người thật bước vào phòng).
/// </summary>
public sealed class OfficeLoop(Presence presence, BotPresence bots, ChatApi chatApi, IHubContext<OfficeRoomHub, IOfficeClient> hub, ILogger<OfficeLoop> log)
    : BackgroundService
{
    public const double TickSeconds = 0.1;

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(TickSeconds));
        while (await timer.WaitForNextTickAsync(ct))
        {
            try
            {
                foreach (var b in bots.Step(TickSeconds))
                    if (b.Spot?.RoomId is { } roomId) JoinRoomInBackground(b.UserId, roomId);

                var changed = new List<PositionDto>();
                foreach (var p in presence.All)
                {
                    lock (p)
                    {
                        if (!p.Dirty) continue;
                        p.Dirty = false;
                        changed.Add(new PositionDto(p.UserId, p.X, p.Z, p.R, p.Anim));
                    }
                }
                foreach (var b in bots.All)
                {
                    if (!b.Dirty) continue;
                    b.Dirty = false;
                    // Người thật của tài khoản đang trong văn phòng → không có avatar bot riêng
                    if (!presence.TryGet(b.UserId, out _)) changed.Add(new PositionDto(b.UserId, b.X, b.Z, b.R, b.Anim));
                }
                if (changed.Count > 0)
                    await hub.Clients.Group(OfficeRoomHub.OfficeGroup).Positions([.. changed]);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "Lỗi vòng lặp văn phòng");
            }
        }
    }

    /// <summary>Thành viên kênh chat phòng là theo TÀI KHOẢN (lưu ở Api) — người thật đăng nhập cùng tài khoản vẫn thấy lịch sử.</summary>
    private void JoinRoomInBackground(string userId, string roomId) => _ = Task.Run(async () =>
    {
        try { await chatApi.JoinRoomAsync(userId, roomId); }
        catch (Exception ex) { log.LogWarning("Bot {UserId} vào phòng {Room}: không cấp được kênh chat — {Message}", userId, roomId, ex.Message); }
    });
}
