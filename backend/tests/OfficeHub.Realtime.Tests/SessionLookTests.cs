using OfficeHub.Realtime.Auth;

namespace OfficeHub.Realtime.Tests;

/// <summary>Realtime lấy ngoại hình nhân vật (avatar) + họ tên hiện tại (fullName) từ body /api/auth/me để phát cho cả văn phòng.</summary>
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

    // TEST-69: họ tên lấy từ /api/auth/me (DB), không tin claim cookie cũ
    [Fact]
    public void Reads_current_full_name() =>
        Assert.Equal("Đoàn Quang Huy", SessionValidator.NameFromMe("{\"id\":\"1\",\"fullName\":\"  Đoàn Quang Huy \"}"));

    [Theory]
    [InlineData("{\"id\":\"1\"}")]
    [InlineData("{\"fullName\":\"   \"}")]
    [InlineData("{\"fullName\":null}")]
    [InlineData("không phải json")]
    public void Missing_or_blank_name_is_null(string body) => Assert.Null(SessionValidator.NameFromMe(body));

    [Fact]
    public void Overlong_name_is_cut() =>
        Assert.Equal(SessionValidator.MaxNameLength, SessionValidator.NameFromMe($"{{\"fullName\":\"{new string('a', 300)}\"}}")!.Length);
}
