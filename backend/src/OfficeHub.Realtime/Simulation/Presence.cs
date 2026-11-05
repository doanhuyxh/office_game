using System.Collections.Concurrent;
using Microsoft.AspNetCore.SignalR;

namespace OfficeHub.Realtime.Simulation;

public sealed class Player
{
    public required string UserId { get; init; }
    public required string Name { get; init; }
    public required string ConnectionId { get; init; }
    public required HubCallerContext Context { get; init; }
    public float X, Z, R;
    public byte Anim;
    public bool Dirty = true;
    public long LastMoveTicks;
    public DateTimeOffset LastActiveAt;
    public DateTimeOffset LastChatAt;
}

/// <summary>Ai đang ở trong văn phòng ảo. Một tài khoản chỉ một kết nối: mở tab mới thì tab cũ bị đóng.</summary>
public sealed class Presence
{
    private readonly ConcurrentDictionary<string, Player> _byUser = new();

    public IEnumerable<Player> All => _byUser.Values;
    public int Count => _byUser.Count;

    /// <summary>Thêm người chơi, trả về kết nối cũ (nếu có) để host đóng lại.</summary>
    public Player? Add(Player p)
    {
        Player? old = null;
        _byUser.AddOrUpdate(p.UserId, p, (_, existing) => { old = existing; return p; });
        return old;
    }

    public bool TryGet(string userId, out Player p) => _byUser.TryGetValue(userId, out p!);

    /// <summary>Chỉ xoá nếu đúng kết nối đó (tránh xoá nhầm khi người dùng vừa mở tab mới).</summary>
    public bool Remove(string userId, string connectionId) =>
        _byUser.TryGetValue(userId, out var p) && p.ConnectionId == connectionId && _byUser.TryRemove(new(userId, p));
}
