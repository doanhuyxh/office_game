using System.Net;
using ModelContextProtocol;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.Mcp.Infrastructure;
using OfficeHub.Mcp.Tools;

namespace OfficeHub.Mcp.Tests;

/// <summary>Token AI chỉ được gọi các route trong danh sách cho phép — đặc biệt KHÔNG hợp đồng / lương, không quản trị tài khoản.</summary>
public class AccessTokenScopeTests
{
    [Theory]
    [InlineData("GET", "/api/auth/me")]
    [InlineData("GET", "/api/org/employees")]
    [InlineData("GET", "/api/org/employees/me")]
    [InlineData("GET", "/api/attendance/today")]
    [InlineData("POST", "/api/attendance/check")]
    [InlineData("GET", "/api/attendance/my")]
    [InlineData("GET", "/api/attendance/overtime/preview")]
    [InlineData("GET", "/api/attendance/overtime/my")]
    [InlineData("POST", "/api/attendance/overtime")]
    [InlineData("POST", "/api/attendance/corrections")]
    [InlineData("GET", "/api/leave/balance")]
    [InlineData("GET", "/api/leave/requests/my")]
    [InlineData("POST", "/api/leave/requests")]
    [InlineData("GET", "/api/approval/inbox")]
    [InlineData("POST", "/api/approval/0193a000-0000-7000-8000-000000000000/approve")]
    [InlineData("GET", "/api/notifications")]
    [InlineData("POST", "/api/notifications/read-all")]
    public void Allows_self_service_routes(string method, string path) =>
        Assert.True(AccessTokenAuth.IsAllowed(method, path));

    [Theory]
    [InlineData("GET", "/api/contracts")]
    [InlineData("GET", "/api/contracts/my")]
    [InlineData("GET", "/api/contracts/0193a000-0000-7000-8000-000000000000/file")]
    [InlineData("POST", "/api/auth/access-tokens")]
    [InlineData("GET", "/api/auth/access-tokens")]
    [InlineData("POST", "/api/auth/change-password")]
    [InlineData("POST", "/api/auth/logout")]
    [InlineData("GET", "/api/auth/me2")]
    [InlineData("POST", "/api/org/employees")]
    [InlineData("PUT", "/api/org/employees/0193a000-0000-7000-8000-000000000000")]
    [InlineData("POST", "/api/org/employees/0193a000-0000-7000-8000-000000000000/account/reset-password")]
    [InlineData("GET", "/api/leave/balances")]          // quỹ phép mọi người (HR) — không bị mở bởi tiền tố /balance
    [InlineData("POST", "/api/leave/adjustments")]
    [InlineData("POST", "/api/attendance/holidays")]
    [InlineData("PUT", "/api/attendance/schedules")]
    [InlineData("DELETE", "/api/attendance/shifts/0193a000-0000-7000-8000-000000000000")]
    [InlineData("GET", "/api/attendance/../contracts")]
    [InlineData("GET", "/api/reports/_status")]
    [InlineData("GET", "")]
    public void Blocks_everything_else(string method, string path) =>
        Assert.False(AccessTokenAuth.IsAllowed(method, path));

    [Fact]
    public void Bearer_detection_requires_prefix()
    {
        Assert.True(AccessTokenAuth.HasBearerToken("Bearer ohk_abc"));
        Assert.False(AccessTokenAuth.HasBearerToken("Bearer eyJhbGciOi"));
        Assert.False(AccessTokenAuth.HasBearerToken(null));
    }
}

public class ApiErrorTests
{
    [Fact]
    public void Validation_errors_are_flattened()
    {
        var msg = OfficeHubApi.ProblemMessage(HttpStatusCode.BadRequest,
            """{"title":"One or more validation errors occurred.","errors":{"workDate":["Chỉ khai bù tăng ca trong 7 ngày gần nhất"]}}""");
        Assert.Equal("workDate: Chỉ khai bù tăng ca trong 7 ngày gần nhất", msg);
    }

    [Fact]
    public void Problem_detail_is_used()
    {
        Assert.Equal("Chỉ huỷ được đơn đang chờ duyệt",
            OfficeHubApi.ProblemMessage(HttpStatusCode.Conflict, """{"status":409,"detail":"Chỉ huỷ được đơn đang chờ duyệt"}"""));
    }

    [Fact]
    public void Empty_body_falls_back_to_status_message() =>
        Assert.Contains("Token", OfficeHubApi.ProblemMessage(HttpStatusCode.Unauthorized, ""));

    [Fact]
    public void Dates_and_months_are_validated()
    {
        Assert.Equal("2026-11-06", ToolHelpers.Date(" 2026-11-06 ", "Ngày"));
        Assert.Throws<McpException>(() => ToolHelpers.Date("06/11/2026", "Ngày"));
        Assert.Equal("2026-11", ToolHelpers.OptionalMonth("2026-11"));
        Assert.Null(ToolHelpers.OptionalMonth(null));
        Assert.Throws<McpException>(() => ToolHelpers.OptionalMonth("11-2026"));
    }
}
