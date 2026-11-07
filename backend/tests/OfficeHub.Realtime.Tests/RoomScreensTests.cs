using System.Net;
using OfficeHub.Realtime.Screens;

namespace OfficeHub.Realtime.Tests;

public class RoomScreensTests
{
    private const string Detail = """{"asset":{"id":"x","title":"Kế hoạch Q4","status":"Published"},"versions":[]}""";
    private const string File = """{"url":"https://bucket.s3.amazonaws.com/a.pdf?X-Amz-Signature=1","fileName":"ke-hoach.pdf","contentType":"application/pdf","kind":"Document","version":2,"inline":true}""";

    [Fact]
    public void Parse_combines_detail_and_file()
    {
        var id = Guid.NewGuid();
        var s = RoomScreens.Parse(Detail, File, "meeting-large", "Phòng họp lớn", id, "An", "2026-11-07T08:00:00Z");
        Assert.NotNull(s);
        Assert.Equal("Kế hoạch Q4", s.Title);
        Assert.Equal("Document", s.Kind);
        Assert.True(s.Inline);
        Assert.Equal(id.ToString(), s.AssetId);
        Assert.Equal("meeting-large", s.RoomId);
    }

    [Theory]
    [InlineData("""{"url":"javascript:alert(1)","fileName":"a","contentType":"text/plain","kind":"Document","inline":true}""")]
    [InlineData("""{"fileName":"a"}""")]
    [InlineData("not json")]
    public void Parse_rejects_bad_payloads(string file) =>
        Assert.Null(RoomScreens.Parse(Detail, file, "r", "R", Guid.NewGuid(), "An", "t"));

    [Fact]
    public void Errors_are_vietnamese_and_hide_existence()
    {
        Assert.Equal(RoomScreens.ErrorFor(HttpStatusCode.NotFound), RoomScreens.ErrorFor(HttpStatusCode.Forbidden));
        Assert.Contains("huỷ", RoomScreens.ErrorFor(HttpStatusCode.Gone));
    }
}
