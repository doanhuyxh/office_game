using System.Collections.Concurrent;
using Microsoft.AspNetCore.SignalR;

namespace OfficeHub.Realtime.Chat;

public sealed record ChatConnection(string UserId, string? AuthCookie, HubCallerContext Context);

/// <summary>Kết nối chat đang mở (một tài khoản có thể nhiều kết nối). Cookie dùng để gọi Api thay người dùng và kiểm tra lại phiên.</summary>
public sealed class ChatConnections
{
    private readonly ConcurrentDictionary<string, ChatConnection> _byConnection = new();

    public IEnumerable<KeyValuePair<string, ChatConnection>> All => _byConnection;
    public void Add(string connectionId, ChatConnection c) => _byConnection[connectionId] = c;
    public void Remove(string connectionId) => _byConnection.TryRemove(connectionId, out _);
    public bool TryGet(string connectionId, out ChatConnection c) => _byConnection.TryGetValue(connectionId, out c!);
}
