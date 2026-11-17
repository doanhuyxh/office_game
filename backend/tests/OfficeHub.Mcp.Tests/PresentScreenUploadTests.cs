using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;
using ModelContextProtocol;
using OfficeHub.Mcp.Infrastructure;
using OfficeHub.Mcp.Tools;

namespace OfficeHub.Mcp.Tests;

/// <summary>present_screen lấy ảnh từ S3 qua uploadId thay vì base64 (TEST-154): create_upload target = screen + chọn nguồn ảnh.</summary>
public class PresentScreenUploadTests
{
    private sealed class FakeApi : HttpMessageHandler
    {
        public List<(string Method, string Path, string? Body)> Calls { get; } = [];
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Calls.Add((request.Method.Method, request.RequestUri!.AbsolutePath, request.Content is null ? null : await request.Content.ReadAsStringAsync(ct)));
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("""{"id":"0193a000-0000-7000-8000-000000000009","url":"https://s3.test/put?sig=1","contentType":"image/png","expiresAt":"2026-11-17T10:30:00Z"}""",
                    Encoding.UTF8, "application/json"),
            };
        }
    }

    private static OfficeHubApi Api(FakeApi handler)
    {
        var http = new DefaultHttpContext();
        http.Request.Headers.Authorization = "Bearer ohk_test";
        return new OfficeHubApi(new HttpClient(handler) { BaseAddress = new Uri("http://api.test") }, new HttpContextAccessor { HttpContext = http });
    }

    [Theory]
    [InlineData(null, true)]
    [InlineData("", true)]
    [InlineData(" Upload ", true)]
    [InlineData("chat", false)]
    [InlineData("task-comment", false)]
    public void Source_defaults_to_own_upload(string? source, bool fromUpload) => Assert.Equal(fromUpload, OfficeTools.ScreenFromUpload(source));

    [Fact]
    public void Unknown_source_is_rejected() => Assert.Throws<McpException>(() => OfficeTools.ScreenFromUpload("base64"));

    [Theory]
    [InlineData("man-hinh.png", true)]
    [InlineData("a.JPG", true)]
    [InlineData("a.jpeg", true)]
    [InlineData("a.webp", true)]
    [InlineData("a.gif", false)]
    [InlineData("a.svg", false)]
    [InlineData("a.pdf", false)]
    public void Screen_upload_accepts_png_jpeg_webp(string name, bool ok) => Assert.Equal(ok, ChatTools.ScreenImage(name));

    [Fact]
    public async Task Create_upload_screen_uses_own_chat_ticket_and_points_to_present_screen()
    {
        var handler = new FakeApi();

        var text = await ChatTools.CreateUpload(Api(handler), "screen", "man-hinh.png", 1234);

        var call = Assert.Single(handler.Calls);
        Assert.Equal(("POST", "/api/chat/uploads"), (call.Method, call.Path));
        var body = JsonNode.Parse(call.Body!)!;
        Assert.Equal("office", (string?)body["conversationId"]);
        Assert.Equal(1234, (long)body["size"]!);
        Assert.Contains("present_screen", text);
        Assert.Contains("0193a000-0000-7000-8000-000000000009", text);
    }

    [Fact]
    public async Task Create_upload_screen_rejects_non_image_before_calling_api()
    {
        var handler = new FakeApi();
        await Assert.ThrowsAsync<McpException>(() => ChatTools.CreateUpload(Api(handler), "screen", "bao-cao.pdf", 10));
        Assert.Empty(handler.Calls);
    }
}
