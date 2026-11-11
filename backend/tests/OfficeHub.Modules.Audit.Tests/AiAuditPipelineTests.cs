using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.Modules.Audit.Domain;
using OfficeHub.Modules.Audit.Infrastructure;

namespace OfficeHub.Modules.Audit.Tests;

/// <summary>Chạy middleware thật: endpoint đọc hết body (như minimal API bind JSON) rồi nhật ký vẫn đọc lại được.</summary>
public class AiAuditPipelineTests
{
    private static readonly AccessTokenCaller Caller = new(Guid.NewGuid(), Guid.NewGuid(), "Claude", false);

    private static async Task<AiRequestLog?> RunAsync(string method, string? body, string contentType = "application/json",
        int status = 200, bool tokenCaller = true, string auth = "Bearer ohk_abc")
    {
        var queue = new AiAuditQueue();
        var filter = new AiAuditStartupFilter(queue, TimeProvider.System);
        var app = new ApplicationBuilder(new ServiceCollection().BuildServiceProvider());
        filter.Configure(a => a.Run(async ctx =>
        {
            // Endpoint tiêu thụ body (giống bind JSON) rồi mới đánh dấu người gọi như AccessTokenHandler.
            using var reader = new StreamReader(ctx.Request.Body, leaveOpen: true);
            _ = await reader.ReadToEndAsync();
            if (tokenCaller) ctx.Items[AccessTokenAuth.CallerItemKey] = Caller;
            ctx.Response.StatusCode = status;
        }))(app);
        var pipeline = app.Build();

        var ctx = new DefaultHttpContext();
        ctx.Request.Method = method;
        ctx.Request.Path = "/api/projects/tasks/x/comments";
        ctx.Request.Headers.Authorization = auth;
        if (body is not null)
        {
            var bytes = Encoding.UTF8.GetBytes(body);
            ctx.Request.Body = new MemoryStream(bytes);
            ctx.Request.ContentLength = bytes.Length;
            ctx.Request.ContentType = contentType;
        }
        await pipeline(ctx);
        return queue.Reader.TryRead(out var log) ? log : null;
    }

    [Fact]
    public async Task Write_by_token_keeps_masked_summary_after_endpoint_consumed_body()
    {
        var log = await RunAsync("POST", """{"body":"Xong rồi","password":"p@ss"}""");
        Assert.NotNull(log?.RequestSummary);
        using var doc = JsonDocument.Parse(log!.RequestSummary!);
        Assert.Equal("Xong rồi", doc.RootElement.GetProperty("body").GetString());
        Assert.Equal(AiRequestSummary.Masked, doc.RootElement.GetProperty("password").GetString());
    }

    [Fact]
    public async Task Read_blocked_and_rate_limited_requests_have_no_summary()
    {
        Assert.Null((await RunAsync("GET", null))!.RequestSummary);
        Assert.Null((await RunAsync("POST", """{"a":1}""", status: 403))!.RequestSummary);
        Assert.Null((await RunAsync("POST", """{"a":1}""", status: 429))!.RequestSummary);
    }

    [Fact]
    public async Task Validation_error_still_keeps_summary()
    {
        Assert.Equal("""{"a":1}""", (await RunAsync("PUT", """{"a":1}""", status: 400))!.RequestSummary);
    }

    [Fact]
    public async Task Cookie_request_is_not_logged()
    {
        Assert.Null(await RunAsync("POST", """{"a":1}""", tokenCaller: false, auth: ""));
    }

    [Fact]
    public async Task Non_json_and_too_large_bodies_only_record_size()
    {
        var form = await RunAsync("POST", "--x--", contentType: "multipart/form-data; boundary=x");
        Assert.Equal("""{"_type":"form","bytes":5}""", form!.RequestSummary);

        var big = JsonSerializer.Serialize(new { body = new string('x', AiRequestSummary.MaxBodyBytes + 10) });
        var large = await RunAsync("POST", big);
        Assert.Equal($$"""{"_type":"too_large","bytes":{{big.Length}}}""", large!.RequestSummary);
    }

    [Fact]
    public async Task Write_without_body_has_no_summary()
    {
        var log = await RunAsync("POST", null);
        Assert.Null(log!.RequestSummary);
    }
}
