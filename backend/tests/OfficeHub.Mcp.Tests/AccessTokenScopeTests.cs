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
    [InlineData("GET", "/api/org/employees/me/role")]
    [InlineData("GET", "/api/org/departments/0193a000-0000-7000-8000-000000000000")]
    [InlineData("GET", "/api/org/positions/0193a000-0000-7000-8000-000000000000")]
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
    [InlineData("GET", "/api/approval/delegations")]
    [InlineData("GET", "/api/notifications")]
    [InlineData("POST", "/api/notifications/read-all")]
    [InlineData("GET", "/api/news/feed")]
    [InlineData("GET", "/api/news/posts/0193a000-0000-7000-8000-000000000000")]
    [InlineData("GET", "/api/news/posts/0193a000-0000-7000-8000-000000000000/comments")]
    [InlineData("POST", "/api/news/posts")]                  // đăng bài: Api tự giới hạn admin / HR
    [InlineData("GET", "/api/chat/conversations")]           // chat: Api tự giới hạn tài khoản bot
    [InlineData("GET", "/api/chat/unread-count")]
    [InlineData("GET", "/api/chat/conversations/office/messages")]
    [InlineData("GET", "/api/chat/conversations/0193a000-0000-7000-8000-000000000000/messages")]
    [InlineData("POST", "/api/chat/conversations/office/messages")]
    [InlineData("POST", "/api/chat/conversations/0193a000-0000-7000-8000-000000000000/read")]
    public void Allows_self_service_routes(string method, string path) =>
        Assert.True(AccessTokenAuth.IsAllowed(method, path));

    [Theory]
    [InlineData("GET", "/api/contracts")]
    [InlineData("GET", "/api/contracts/my")]
    [InlineData("POST", "/api/chat/conversations/direct")]  // bot không tự mở 1-1
    [InlineData("GET", "/api/chat/conversations/room:meeting-large/messages")] // kênh phòng
    [InlineData("POST", "/api/chat/conversations/room:kt/messages")]
    [InlineData("POST", "/api/chat/uploads")]
    [InlineData("DELETE", "/api/chat/messages/0193a000-0000-7000-8000-000000000000")]
    [InlineData("GET", "/api/chat/people")]
    [InlineData("GET", "/api/chat/attachments/0193a000-0000-7000-8000-000000000000/url")]
    [InlineData("POST", "/api/chat/internal/rooms/kt/members")]
    [InlineData("GET", "/api/contracts/0193a000-0000-7000-8000-000000000000/file")]
    [InlineData("POST", "/api/auth/access-tokens")]
    [InlineData("GET", "/api/auth/access-tokens")]
    [InlineData("POST", "/api/auth/change-password")]
    [InlineData("POST", "/api/auth/logout")]
    [InlineData("GET", "/api/auth/me2")]
    [InlineData("POST", "/api/org/employees")]
    [InlineData("PUT", "/api/org/employees/0193a000-0000-7000-8000-000000000000")]
    [InlineData("POST", "/api/org/employees/0193a000-0000-7000-8000-000000000000/account/reset-password")]
    [InlineData("GET", "/api/org/profile/me")]                 // CCCD, tài khoản ngân hàng: không bao giờ ra MCP
    [InlineData("GET", "/api/org/profile/employees/0193a000-0000-7000-8000-000000000000")]
    [InlineData("POST", "/api/org/profile/me/requests")]
    [InlineData("POST", "/api/org/positions/0193a000-0000-7000-8000-000000000000/guide")] // hướng dẫn chỉ mở PUT
    [InlineData("GET", "/api/leave/balances")]          // quỹ phép mọi người (HR) — không bị mở bởi tiền tố /balance
    [InlineData("POST", "/api/leave/adjustments")]
    [InlineData("POST", "/api/attendance/holidays")]
    [InlineData("PUT", "/api/attendance/schedules")]
    [InlineData("DELETE", "/api/attendance/shifts/0193a000-0000-7000-8000-000000000000")]
    [InlineData("GET", "/api/attendance/../contracts")]
    [InlineData("GET", "/api/reports/_status")]
    [InlineData("POST", "/api/approval/delegations")]       // trao quyền duyệt thay: chỉ trên web
    [InlineData("POST", "/api/approval/delegations/0193a000-0000-7000-8000-000000000000/revoke")]
    [InlineData("PUT", "/api/news/posts/0193a000-0000-7000-8000-000000000000")]   // sửa bài chỉ trên web
    [InlineData("POST", "/api/news/posts/0193a000-0000-7000-8000-000000000000/comments")]
    [InlineData("PUT", "/api/news/posts/0193a000-0000-7000-8000-000000000000/reaction")]
    [InlineData("DELETE", "/api/news/posts/0193a000-0000-7000-8000-000000000000")]
    [InlineData("POST", "/api/news/admin/posts/0193a000-0000-7000-8000-000000000000/hide")]
    [InlineData("GET", "/api/news/media/0193a000-0000-7000-8000-000000000000/url")]   // không trao link tệp cho AI
    [InlineData("POST", "/api/news/uploads")]
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

public class ProjectDocumentScopeTests
{
    private const string G = "0193a000-0000-7000-8000-000000000000";

    [Theory]
    [InlineData("GET", "/api/projects")]
    [InlineData("GET", "/api/projects/")]
    [InlineData("GET", "/api/projects/" + G)]
    [InlineData("GET", "/api/projects/" + G + "/tasks")]
    [InlineData("GET", "/api/projects/" + G + "/effort")]
    [InlineData("GET", "/api/projects/" + G + "/columns")]
    [InlineData("GET", "/api/projects/tasks/mine")]
    [InlineData("GET", "/api/projects/tasks/" + G + "/comments")]
    [InlineData("GET", "/api/projects/tasks/" + G)]
    [InlineData("PUT", "/api/projects/tasks/" + G)]
    [InlineData("POST", "/api/projects/" + G + "/tasks")]
    [InlineData("POST", "/api/projects/tasks/" + G + "/move")]
    [InlineData("POST", "/api/projects/tasks/" + G + "/comments")]
    [InlineData("PUT", "/api/projects/" + G + "/guide")]                  // chỉ hướng dẫn làm việc (TEST-35)
    [InlineData("GET", "/api/documents/spaces")]
    [InlineData("GET", "/api/documents/folders")]
    [InlineData("GET", "/api/documents/assets")]
    [InlineData("GET", "/api/documents/recent")]
    [InlineData("GET", "/api/documents/assets/" + G)]
    [InlineData("GET", "/api/documents/assets/" + G + "/file")]
    [InlineData("POST", "/api/documents/assets/text")]                     // TEST-54: tạo tài liệu chữ (nháp)
    [InlineData("POST", "/api/documents/assets/" + G + "/submit")]          // TEST-54: gửi duyệt (luôn qua người duyệt)
    public void Allows_project_tasks_and_document_reads(string method, string path) => Assert.True(AccessTokenAuth.IsAllowed(method, path));

    [Theory]
    [InlineData("GET", "/api/projects/financials")]                       // lãi / lỗ: không bao giờ ra MCP
    [InlineData("GET", "/api/projects/" + G + "/financials")]
    [InlineData("GET", "/api/projects/" + G + "/installments")]
    [InlineData("GET", "/api/projects/sales-contracts")]
    [InlineData("GET", "/api/projects/sales-contracts/" + G + "/installments")]
    [InlineData("GET", "/api/projects/" + G + "/change-requests")]
    [InlineData("POST", "/api/projects")]                                 // tạo / sửa dự án, thành viên, phân bổ, mốc: chỉ web
    [InlineData("PUT", "/api/projects/" + G)]
    [InlineData("GET", "/api/projects/agent-settings")]                   // giới hạn bot: chỉ admin trên web, bot không tự nới (TEST-36)
    [InlineData("PUT", "/api/projects/agent-settings")]
    [InlineData("GET", "/api/projects/" + G + "/guide")]
    [InlineData("PUT", "/api/projects/" + G + "/guide/x")]
    [InlineData("POST", "/api/projects/" + G + "/members")]
    [InlineData("PUT", "/api/projects/" + G + "/allocations")]
    [InlineData("POST", "/api/projects/" + G + "/milestones")]
    [InlineData("POST", "/api/projects/milestones/" + G + "/accept")]
    [InlineData("DELETE", "/api/projects/tasks/" + G)]
    [InlineData("DELETE", "/api/projects/comments/" + G)]              // xoá bình luận: chỉ người viết, trên web (TEST-39)
    [InlineData("POST", "/api/projects/" + G + "/columns")]
    [InlineData("PUT", "/api/projects/columns/" + G)]
    [InlineData("PUT", "/api/projects/" + G + "/columns/order")]
    [InlineData("DELETE", "/api/projects/columns/" + G)]
    [InlineData("GET", "/api/projects/" + G + "/tasks/extra")]
    [InlineData("GET", "/api/projects/" + G + "/tasks\n")]
    [InlineData("GET", "/api/projects/not-a-guid/tasks")]
    [InlineData("POST", "/api/documents/uploads")]                        // tài liệu: chỉ tạo chữ + gửi duyệt
    [InlineData("POST", "/api/documents/assets")]
    [InlineData("PUT", "/api/documents/assets/" + G)]
    [InlineData("DELETE", "/api/documents/assets/" + G)]
    [InlineData("GET", "/api/documents/assets/" + G + "/protected-file")]
    [InlineData("POST", "/api/documents/assets/" + G + "/archive")]
    [InlineData("POST", "/api/documents/assets/text/submit")]
    [InlineData("GET", "/api/documents/assets/" + G + "/access-log")]
    [InlineData("GET", "/api/documents/trash")]
    [InlineData("GET", "/api/documents/admin/stats")]
    [InlineData("POST", "/api/documents/folders")]
    [InlineData("GET", "/api/documents/doc-types")]
    public void Blocks_finance_admin_and_document_writes(string method, string path) => Assert.False(AccessTokenAuth.IsAllowed(method, path));

    private static readonly List<(Guid Id, string Name, bool IsDone)> Cols =
    [
        (Guid.NewGuid(), "Cần làm", false), (Guid.NewGuid(), "Đang làm", false), (Guid.NewGuid(), "Chờ QA", false), (Guid.NewGuid(), "Hoàn tất", true),
    ];

    [Theory]
    [InlineData("todo", 0)]
    [InlineData("Đang làm", 1)]
    [InlineData(" dang lam ", 1)]
    [InlineData("CHỜ QA", 2)]
    [InlineData("xong", 3)]
    [InlineData("done", 3)]
    public void Task_columns_match_name_or_alias(string input, int expected) => Assert.Equal(Cols[expected].Id, ProjectTools.MatchColumn(Cols, input));

    [Fact]
    public void Task_column_by_id() => Assert.Equal(Cols[2].Id, ProjectTools.MatchColumn(Cols, Cols[2].Id.ToString()));

    [Fact]
    public void Unknown_task_column_is_rejected() => Assert.Throws<McpException>(() => ProjectTools.MatchColumn(Cols, "blocked"));
}

public class DepartmentAdminScopeTests
{
    private const string G = "0193a000-0000-7000-8000-000000000000";

    [Theory]
    [InlineData("POST", "/api/org/departments")]
    [InlineData("PUT", "/api/org/departments/" + G)]
    [InlineData("DELETE", "/api/org/departments/" + G)]
    [InlineData("PUT", "/api/org/departments/" + G + "/guide")]      // mô tả + hướng dẫn: HR / trưởng phòng (Api kiểm tra)
    [InlineData("PUT", "/api/org/positions/" + G + "/guide")]        // chức vụ: chỉ HR (Api kiểm tra)
    public void Hr_department_writes_allowed(string method, string path) => Assert.True(AccessTokenAuth.IsAllowed(method, path));

    [Theory]
    [InlineData("DELETE", "/api/org/departments/" + G + "/guide")]
    [InlineData("PUT", "/api/org/departments/" + G + "/guide/x")]
    [InlineData("PUT", "/api/org/positions/" + G)]                    // sửa chức vụ (tên, cấp, quyền tài chính): chỉ web
    [InlineData("DELETE", "/api/org/departments")]
    [InlineData("POST", "/api/org/departments/" + G)]
    [InlineData("POST", "/api/org/employees/bulk/update")]           // chuyển nhân viên: chỉ web
    [InlineData("POST", "/api/org/positions")]
    public void Other_org_writes_still_blocked(string method, string path) => Assert.False(AccessTokenAuth.IsAllowed(method, path));

    private static List<System.Text.Json.Nodes.JsonObject> Depts() =>
    [
        new() { ["id"] = "0193a000-0000-7000-8000-000000000001", ["name"] = "Kế toán", ["code"] = "KT" },
        new() { ["id"] = "0193a000-0000-7000-8000-000000000002", ["name"] = "Kế toán quản trị", ["code"] = "KTQT" },
        new() { ["id"] = "0193a000-0000-7000-8000-000000000003", ["name"] = "Kỹ thuật", ["code"] = "IT" },
    ];

    [Fact]
    public void Department_resolves_by_name_code_and_partial()
    {
        Assert.Equal(Guid.Parse("0193a000-0000-7000-8000-000000000001"), DepartmentAdminTools.Resolve(Depts(), "kế toán"));
        Assert.Equal(Guid.Parse("0193a000-0000-7000-8000-000000000003"), DepartmentAdminTools.Resolve(Depts(), "it"));
        Assert.Equal(Guid.Parse("0193a000-0000-7000-8000-000000000003"), DepartmentAdminTools.Resolve(Depts(), "thuật"));
        Assert.Throws<McpException>(() => DepartmentAdminTools.Resolve(Depts(), "toán"));                   // nhiều phòng
        Assert.Throws<McpException>(() => DepartmentAdminTools.Resolve(Depts(), "thuật", partial: false));  // sửa / xoá: phải khớp đúng
    }
}

public class MeetingToolTests
{
    [Fact]
    public void Office_wall_clock_becomes_instant_with_offset()
    {
        var tz = TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh");
        Assert.Equal("2026-11-07T09:30:00+07:00", MeetingTools.Instant(new DateOnly(2026, 11, 7), new TimeOnly(9, 30), tz));
    }

    [Theory]
    [InlineData("GET", "/api/meetings/rooms")]
    [InlineData("GET", "/api/meetings/bookings")]
    [InlineData("GET", "/api/meetings/bookings/now")]
    [InlineData("GET", "/api/meetings/sessions")]
    [InlineData("GET", "/api/meetings/sessions/0193a000-0000-7000-8000-000000000000")]
    [InlineData("POST", "/api/meetings/bookings")]
    [InlineData("DELETE", "/api/meetings/bookings/0193a000-0000-7000-8000-000000000000")]
    public void Meetings_routes_allowed_for_ai(string method, string path) => Assert.True(AccessTokenAuth.IsAllowed(method, path));

    [Theory]
    [InlineData("GET", "/api/reports/overtime-pay")]
    [InlineData("GET", "/api/reports/leave-payout/me")]
    [InlineData("GET", "/api/contracts/templates")]
    [InlineData("DELETE", "/api/meetings/bookings")]
    public void Salary_reports_and_templates_blocked_for_ai(string method, string path) => Assert.False(AccessTokenAuth.IsAllowed(method, path));

    // TEST-74: chỉ người thật mở / dừng họp agent; trần họp chỉ admin trên web.
    [Theory]
    [InlineData("POST", "/api/meetings/sessions")]
    [InlineData("POST", "/api/meetings/sessions/0193a000-0000-7000-8000-000000000000/stop")]
    [InlineData("GET", "/api/meetings/agent-settings")]
    [InlineData("PUT", "/api/meetings/agent-settings")]
    [InlineData("GET", "/api/meetings")]
    public void Agent_meeting_open_stop_and_settings_blocked_for_ai(string method, string path) =>
        Assert.False(AccessTokenAuth.IsAllowed(method, path));
}
