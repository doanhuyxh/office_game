using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Caching.Memory;
using OfficeHub.BuildingBlocks.Office;

namespace OfficeHub.Mcp.Infrastructure;

/// <summary>
/// Kiểm tra đầu vào <c>POST /mcp/activity</c> (TEST-94): cấu trúc lô sự kiện + giới hạn tần suất theo token.
/// Realtime sẽ cắt trường quá dài (không từ chối) nên ở đây chỉ chặn lô sai cấu trúc — cùng luật 400 với
/// <c>BotActivityFeed.Clean</c> phía Realtime (thiếu id / kind lạ) để lô bị từ chối ngay tại Mcp, không tốn lượt chuyển tiếp.
/// Nội dung sự kiện không được ghi log ở host Mcp — chỉ đếm số sự kiện.
/// </summary>
public static class BotActivityGate
{
    /// <summary>null = hợp lệ; khác = lý do trả 400 (cả lô không gửi gì).</summary>
    public static string? Validate(IReadOnlyList<BotActivityEvent>? events)
    {
        if (events is not { Count: > 0 }) return "Thiếu events";
        if (events.Count > BotActivityFeedRoute.MaxEvents)
            return $"Tối đa {BotActivityFeedRoute.MaxEvents} sự kiện / lần — chia nhỏ lô";
        for (var i = 0; i < events.Count; i++)
        {
            var e = events[i];
            if (e is null) return $"events[{i}]: sự kiện rỗng";
            if (e.Kind is null || !BotActivityFeedRoute.Kinds.Contains(e.Kind))
                return $"events[{i}]: kind không hợp lệ (cho phép: {string.Join(", ", BotActivityFeedRoute.Kinds)})";
            if (string.IsNullOrWhiteSpace(e.Id)) return $"events[{i}]: thiếu id";
        }
        return null;
    }

    /// <summary>
    /// Cửa sổ cố định theo giây, theo token (SHA-256 — không giữ token thô làm khoá cache):
    /// quá <see cref="BotActivityFeedRoute.McpMaxCallsPerSecond"/> lần trong cùng giây → false (429).
    /// </summary>
    public static bool Allow(IMemoryCache cache, string authorization, long unixSecond)
    {
        var key = "act:" + Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(authorization))) + ":" + unixSecond;
        var count = cache.GetOrCreate(key, e =>
        {
            e.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(2);
            return new StrongBox<int>(0);
        })!;
        return Interlocked.Increment(ref count.Value) <= BotActivityFeedRoute.McpMaxCallsPerSecond;
    }
}
