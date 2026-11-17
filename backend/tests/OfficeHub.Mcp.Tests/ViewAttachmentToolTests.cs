using System.Net;
using System.Text;
using Microsoft.AspNetCore.Http;
using ModelContextProtocol;
using ModelContextProtocol.Protocol;
using OfficeHub.Mcp.Infrastructure;
using OfficeHub.Mcp.Tools;

namespace OfficeHub.Mcp.Tests;

/// <summary>Tool view_attachment (TEST-151): ảnh → text + image content; tệp khác → text kèm link hạn ngắn.</summary>
public class ViewAttachmentToolTests
{
    private const string Id = "0193a000-0000-7000-8000-000000000001";
    private static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xD9];

    private sealed class FakeApi(Func<string, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public List<string> Paths { get; } = [];
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Paths.Add(request.RequestUri!.AbsolutePath);
            return Task.FromResult(respond(request.RequestUri.AbsolutePath));
        }
    }

    private static OfficeHubApi Api(FakeApi handler)
    {
        var http = new DefaultHttpContext();
        http.Request.Headers.Authorization = "Bearer ohk_test";
        return new OfficeHubApi(new HttpClient(handler) { BaseAddress = new Uri("http://api.test") }, new HttpContextAccessor { HttpContext = http });
    }

    private static HttpResponseMessage Json(string json) => new(HttpStatusCode.OK) { Content = new StringContent(json, Encoding.UTF8, "application/json") };

    private static string Info(bool isImage) =>
        $$"""{"id":"{{Id}}","fileName":"{{(isImage ? "anh.png" : "bao-cao.pdf")}}","contentType":"{{(isImage ? "image/png" : "application/pdf")}}","size":12345,"isImage":{{(isImage ? "true" : "false")}},"url":"https://s3.test/x?sig=1"}""";

    [Fact]
    public async Task Image_returns_metadata_and_thumbnail_without_url()
    {
        var handler = new FakeApi(path => path.EndsWith("/preview")
            ? new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(Jpeg) { Headers = { ContentType = new("image/jpeg") } } }
            : Json(Info(true)));

        var r = await ChatTools.ViewAttachment(Api(handler), Id);

        Assert.Equal([$"/api/chat/attachments/{Id}", $"/api/chat/attachments/{Id}/preview"], handler.Paths);
        Assert.Equal(2, r.Content.Count);
        var text = Assert.IsType<TextContentBlock>(r.Content[0]).Text;
        Assert.Contains("anh.png", text);
        Assert.DoesNotContain("s3.test", text);
        var img = Assert.IsType<ImageContentBlock>(r.Content[1]);
        Assert.Equal("image/jpeg", img.MimeType);
        Assert.Equal(Jpeg, img.DecodedData.ToArray());
    }

    [Fact]
    public async Task Non_image_returns_short_lived_link()
    {
        var handler = new FakeApi(_ => Json(Info(false)));

        var r = await ChatTools.ViewAttachment(Api(handler), Id);

        Assert.Equal([$"/api/chat/attachments/{Id}"], handler.Paths);
        var text = Assert.IsType<TextContentBlock>(Assert.Single(r.Content)).Text;
        Assert.Contains("https://s3.test/x?sig=1", text);
        Assert.Contains("\"urlExpiresInMinutes\":10", text);
    }

    [Fact]
    public async Task Not_member_or_recalled_message_surfaces_api_404()
    {
        var handler = new FakeApi(_ => new HttpResponseMessage(HttpStatusCode.NotFound)
        {
            Content = new StringContent("""{"title":"x","detail":"Không tìm thấy tệp"}""", Encoding.UTF8, "application/problem+json"),
        });

        var e = await Assert.ThrowsAsync<ApiException>(() => ChatTools.ViewAttachment(Api(handler), Id));
        Assert.Equal("Không tìm thấy tệp", e.Message);
    }

    [Theory]
    [InlineData("")]
    [InlineData("../auth/me")]
    [InlineData("00000000-0000-0000-0000-000000000000")]
    public async Task Rejects_bad_id_without_calling_api(string id)
    {
        var handler = new FakeApi(_ => throw new InvalidOperationException("không được gọi Api"));
        await Assert.ThrowsAsync<McpException>(() => ChatTools.ViewAttachment(Api(handler), id));
        Assert.Empty(handler.Paths);
    }
}
