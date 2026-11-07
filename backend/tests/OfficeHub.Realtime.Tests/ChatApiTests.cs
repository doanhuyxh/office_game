using System.Net;
using System.Text;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.Realtime.Auth;
using OfficeHub.Realtime.Chat;

namespace OfficeHub.Realtime.Tests;

/// <summary>ChatApi: gọi Api bằng cookie người dùng, báo vào phòng bằng khoá nội bộ, đổi lỗi Api thành câu tiếng Việt.</summary>
public class ChatApiTests
{
    private const string Key = "0123456789abcdef0123456789abcdef";
    private const string Cookie = "officehub.auth=abc";

    private sealed class FakeHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public HttpRequestMessage? Last;
        public string? LastBody;

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Last = request;
            LastBody = request.Content is null ? null : await request.Content.ReadAsStringAsync(ct);
            return respond(request);
        }
    }

    private sealed class Factory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false) { BaseAddress = new Uri("http://api") };
    }

    private static (ChatApi Api, FakeHandler Handler) Make(Func<HttpRequestMessage, HttpResponseMessage> respond)
    {
        var h = new FakeHandler(respond);
        return (new ChatApi(new Factory(h), Options.Create(new ChatSettings { InternalKey = Key })), h);
    }

    private static HttpResponseMessage Json(HttpStatusCode code, string body) =>
        new(code) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    private const string SendOk = """
        {"message":{"id":"33333333-3333-3333-3333-333333333333","seq":5,"conversationId":"44444444-4444-4444-4444-444444444444",
        "senderId":"11111111-1111-1111-1111-111111111111","senderName":"An","text":"hi","createdAt":"2026-11-07T03:00:00Z","deleted":false,
        "attachments":[],"clientId":"c1"},"conversationType":"Office","roomId":null,"roomName":null,"recipients":null}
        """;

    [Fact]
    public async Task Send_posts_with_user_cookie_and_parses_result()
    {
        var (api, h) = Make(_ => Json(HttpStatusCode.OK, SendOk));
        var r = await api.SendAsync(Cookie, "room:meeting-large", "hi", null, "c1", default);
        Assert.Equal(HttpMethod.Post, h.Last!.Method);
        Assert.Equal("/api/chat/conversations/room:meeting-large/messages", Uri.UnescapeDataString(h.Last.RequestUri!.AbsolutePath));
        Assert.Equal(Cookie, Assert.Single(h.Last.Headers.GetValues("Cookie")));
        Assert.False(h.Last.Headers.Contains(ChatApi.KeyHeader));
        Assert.Contains("\"text\":\"hi\"", h.LastBody);
        Assert.Contains("\"clientId\":\"c1\"", h.LastBody);
        Assert.Equal("Office", r.ConversationType);
        Assert.Null(r.Recipients);
        Assert.Equal(5, r.Message.Seq);
    }

    [Fact]
    public async Task Join_room_sends_internal_key_and_no_cookie()
    {
        var (api, h) = Make(_ => new HttpResponseMessage(HttpStatusCode.NoContent));
        await api.JoinRoomAsync("11111111-1111-1111-1111-111111111111", "kt");
        Assert.Equal("/api/chat/internal/rooms/kt/members", h.Last!.RequestUri!.AbsolutePath);
        Assert.Equal(Key, Assert.Single(h.Last.Headers.GetValues(ChatApi.KeyHeader)));
        Assert.False(h.Last.Headers.Contains("Cookie"));
        Assert.Contains("11111111-1111-1111-1111-111111111111", h.LastBody);
    }

    [Fact]
    public async Task Validation_problem_returns_first_field_message()
    {
        var (api, _) = Make(_ => Json(HttpStatusCode.BadRequest, """{"errors":{"text":["Tin nhắn tối đa 1000 ký tự"]}}"""));
        var ex = await Assert.ThrowsAsync<HubException>(() => api.SendAsync(Cookie, "office", "x", null, null, default));
        Assert.Equal("Tin nhắn tối đa 1000 ký tự", ex.Message);
    }

    [Fact]
    public async Task Problem_details_returns_detail()
    {
        var (api, _) = Make(_ => Json(HttpStatusCode.NotFound, """{"title":"Not Found","detail":"Không tìm thấy tin nhắn"}"""));
        var ex = await Assert.ThrowsAsync<HubException>(() => api.DeleteAsync(Cookie, Guid.NewGuid(), default));
        Assert.Equal("Không tìm thấy tin nhắn", ex.Message);
    }

    [Fact]
    public async Task Unauthorized_means_session_expired()
    {
        var (api, _) = Make(_ => new HttpResponseMessage(HttpStatusCode.Unauthorized));
        var ex = await Assert.ThrowsAsync<HubException>(() => api.SendAsync(Cookie, "office", "x", null, null, default));
        Assert.Equal(SessionWatch.ExpiredReason, ex.Message);
    }

    [Fact]
    public async Task Missing_cookie_means_session_expired_without_calling_api()
    {
        var (api, h) = Make(_ => Json(HttpStatusCode.OK, SendOk));
        var ex = await Assert.ThrowsAsync<HubException>(() => api.SendAsync(null, "office", "x", null, null, default));
        Assert.Equal(SessionWatch.ExpiredReason, ex.Message);
        Assert.Null(h.Last);
    }

    [Fact]
    public async Task Forbidden_with_detail_shows_detail_without_detail_means_expired()
    {
        var (api, _) = Make(_ => Json(HttpStatusCode.Forbidden, """{"detail":"Bạn không thuộc kênh này"}"""));
        Assert.Equal("Bạn không thuộc kênh này", (await Assert.ThrowsAsync<HubException>(() => api.SendAsync(Cookie, "office", "x", null, null, default))).Message);
        var (api2, _) = Make(_ => new HttpResponseMessage(HttpStatusCode.Forbidden));
        Assert.Equal(SessionWatch.ExpiredReason, (await Assert.ThrowsAsync<HubException>(() => api2.SendAsync(Cookie, "office", "x", null, null, default))).Message);
    }

    [Fact]
    public async Task Too_many_requests_keeps_api_message_or_falls_back()
    {
        var (api, _) = Make(_ => Json((HttpStatusCode)429, """{"detail":"Gửi chậm lại một chút"}"""));
        Assert.Equal("Gửi chậm lại một chút", (await Assert.ThrowsAsync<HubException>(() => api.SendAsync(Cookie, "office", "x", null, null, default))).Message);
        var (api2, _) = Make(_ => new HttpResponseMessage((HttpStatusCode)429));
        Assert.Equal("Gửi chậm lại một chút", (await Assert.ThrowsAsync<HubException>(() => api2.SendAsync(Cookie, "office", "x", null, null, default))).Message);
    }

    [Fact]
    public async Task Timeout_and_server_errors_mean_unreachable()
    {
        var (api, _) = Make(_ => throw new TaskCanceledException("timeout"));
        Assert.Equal(ChatApi.Unreachable, (await Assert.ThrowsAsync<HubException>(() => api.SendAsync(Cookie, "office", "x", null, null, default))).Message);
        var (api2, _) = Make(_ => new HttpResponseMessage(HttpStatusCode.BadGateway));
        Assert.Equal(ChatApi.Unreachable, (await Assert.ThrowsAsync<HubException>(() => api2.SendAsync(Cookie, "office", "x", null, null, default))).Message);
    }
}
