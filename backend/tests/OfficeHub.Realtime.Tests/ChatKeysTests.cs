using System.ComponentModel.DataAnnotations;
using OfficeHub.BuildingBlocks.Configuration;

namespace OfficeHub.Realtime.Tests;

/// <summary>TEST-29: khoá nội bộ riêng theo chiều gọi, trống → dùng Chat__InternalKey (bản deploy cũ không gãy).</summary>
public class ChatKeysTests
{
    private static readonly string Shared = new('s', 40), K1 = new('a', 40), K2 = new('b', 40);

    private static List<ValidationResult> Validate(ChatSettings s)
    {
        var r = new List<ValidationResult>();
        Validator.TryValidateObject(s, new ValidationContext(s), r, validateAllProperties: true);
        return r;
    }

    [Fact]
    public void Falls_back_to_internal_key_when_unset_or_blank()
    {
        var s = new ChatSettings { InternalKey = Shared, McpToRealtimeKey = "  ", RealtimeToApiKey = null };
        Assert.Equal(Shared, s.McpRealtimeKey);
        Assert.Equal(Shared, s.RealtimeApiKey);
        Assert.Empty(Validate(s)); // biến để trống trong .env không làm app dừng
    }

    [Fact]
    public void Uses_separate_keys_per_direction()
    {
        var s = new ChatSettings { InternalKey = Shared, McpToRealtimeKey = K1, RealtimeToApiKey = K2 };
        Assert.Equal(K1, s.McpRealtimeKey);
        Assert.Equal(K2, s.RealtimeApiKey);
        Assert.Empty(Validate(s));
    }

    [Fact]
    public void Short_direction_key_is_rejected() =>
        Assert.Contains(Validate(new ChatSettings { InternalKey = Shared, McpToRealtimeKey = "ngan" }), v => v.ErrorMessage!.Contains("Chat__McpToRealtimeKey"));
}
