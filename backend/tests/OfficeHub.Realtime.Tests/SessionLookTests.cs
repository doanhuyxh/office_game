using OfficeHub.Realtime.Auth;

namespace OfficeHub.Realtime.Tests;

/// <summary>Realtime lấy ngoại hình nhân vật từ body /api/auth/me (trường avatar) để phát cho cả văn phòng.</summary>
public class SessionLookTests
{
    [Fact]
    public void Reads_avatar_object_as_compact_json()
    {
        var look = SessionValidator.LookFromMe("{\"id\":\"1\",\"avatar\":{\"v\":1,\"body\":\"male\",\"skin\":null}}");
        Assert.Equal("{\"v\":1,\"body\":\"male\",\"skin\":null}", look);
    }

    [Theory]
    [InlineData("{\"id\":\"1\"}")]                   // Api cũ chưa có trường avatar
    [InlineData("{\"id\":\"1\",\"avatar\":null}")]   // chưa chọn → mặc định
    [InlineData("{\"avatar\":\"chuỗi\"}")]
    [InlineData("không phải json")]
    public void Missing_or_bad_avatar_means_default(string body) => Assert.Null(SessionValidator.LookFromMe(body));

    [Fact]
    public void Oversized_avatar_is_ignored()
    {
        var big = new string('x', SessionValidator.MaxLookLength);
        Assert.Null(SessionValidator.LookFromMe($"{{\"avatar\":{{\"pad\":\"{big}\"}}}}"));
    }
}
