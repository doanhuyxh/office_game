using System.ComponentModel;
using ModelContextProtocol;
using ModelContextProtocol.Server;
using OfficeHub.Mcp.Infrastructure;
using static OfficeHub.Mcp.Tools.ToolHelpers;

namespace OfficeHub.Mcp.Tools;

[McpServerToolType]
public sealed class AttendanceTools
{
    [McpServerTool(Name = "get_today_attendance", Title = "Chấm công hôm nay", ReadOnly = true, OpenWorld = false)]
    [Description("Trạng thái chấm công hôm nay của tôi: đã vào chưa (checkedIn), hành động kế tiếp (in / out), các phiên vào–ra, " +
                 "số phút đã làm / đi muộn, ca làm hôm nay và giờ server.")]
    public static async Task<string> GetTodayAttendance(OfficeHubApi api, CancellationToken ct) =>
        Out(await api.GetAsync("/api/attendance/today", ct));

    [McpServerTool(Name = "check_in_out", Title = "Chấm công vào / ra", Destructive = false, Idempotent = false, OpenWorld = false)]
    [Description("Chấm công: nếu đang 'ra' thì chấm VÀO, đang 'vào' thì chấm RA (giống nút trên web). Chấm qua trợ lý AI LUÔN được " +
                 "ghi là làm việc TỪ XA (Remote), giờ do máy chủ ghi. Chỉ gọi khi người dùng yêu cầu rõ ràng; nên gọi " +
                 "get_today_attendance trước để nói cho người dùng biết sẽ chấm vào hay ra.")]
    public static async Task<string> CheckInOut(OfficeHubApi api, CancellationToken ct) =>
        Out(await api.PostAsync("/api/attendance/check", new { source = "mcp" }, ct));

    [McpServerTool(Name = "get_my_timesheet", Title = "Bảng công tháng", ReadOnly = true, OpenWorld = false)]
    [Description("Bảng công một tháng của tôi: từng ngày (trạng thái, giờ vào / ra, phút làm, đi muộn, về sớm, nghỉ phép, ngày lễ, tăng ca) " +
                 "và phần tổng hợp tháng.")]
    public static async Task<string> GetMyTimesheet(OfficeHubApi api,
        [Description("Tháng dạng yyyy-MM; bỏ trống = tháng hiện tại")] string? month = null, CancellationToken ct = default) =>
        Out(await api.GetAsync("/api/attendance/my" + (OptionalMonth(month) is { } m ? $"?month={Q(m)}" : ""), ct));

    [McpServerTool(Name = "list_holidays", Title = "Ngày lễ", ReadOnly = true, OpenWorld = false)]
    [Description("Danh sách ngày lễ của công ty trong một năm.")]
    public static async Task<string> ListHolidays(OfficeHubApi api,
        [Description("Năm; bỏ trống = năm hiện tại")] int? year = null, CancellationToken ct = default) =>
        Out(await api.GetAsync("/api/attendance/holidays" + (year is { } y ? $"?year={y}" : ""), ct));

    [McpServerTool(Name = "list_shifts", Title = "Ca làm việc", ReadOnly = true, OpenWorld = false)]
    [Description("Các ca làm việc đang có (giờ bắt đầu / kết thúc, nghỉ trưa, ca cố định hay linh hoạt).")]
    public static async Task<string> ListShifts(OfficeHubApi api, CancellationToken ct) =>
        Out(await api.GetAsync("/api/attendance/shifts", ct));

    // ---------------- Giải trình ----------------

    [McpServerTool(Name = "list_my_corrections", Title = "Giải trình của tôi", ReadOnly = true, OpenWorld = false)]
    [Description("Các đơn giải trình chấm công (quên chấm vào / ra) của tôi và trạng thái duyệt.")]
    public static async Task<string> ListMyCorrections(OfficeHubApi api,
        [Description("Tháng dạng yyyy-MM; bỏ trống = tháng hiện tại")] string? month = null, CancellationToken ct = default) =>
        Out(await api.GetAsync("/api/attendance/corrections/my" + (OptionalMonth(month) is { } m ? $"?month={Q(m)}" : ""), ct));

    [McpServerTool(Name = "submit_attendance_correction", Title = "Gửi giải trình chấm công", Destructive = false, OpenWorld = false)]
    [Description("Gửi đơn giải trình khi quên chấm công (đi qua luồng duyệt quản lý → HR). Chỉ trong 31 ngày gần nhất, không cho ngày tương lai. " +
                 "XÁC NHẬN lại ngày, giờ, loại và lý do với người dùng trước khi gửi.")]
    public static async Task<string> SubmitAttendanceCorrection(OfficeHubApi api,
        [Description("Ngày cần giải trình, yyyy-MM-dd")] string workDate,
        [Description("\"In\" = giờ vào, \"Out\" = giờ ra")] string type,
        [Description("Giờ thực tế, HH:mm (24h)")] string time,
        [Description("\"Onsite\" = tại văn phòng, \"Remote\" = từ xa")] string workMode,
        [Description("Lý do (bắt buộc, ≤ 500 ký tự)")] string reason,
        CancellationToken ct = default) =>
        Out(await api.PostAsync("/api/attendance/corrections",
            new { workDate = Date(workDate, "Ngày"), type, time, workMode, reason }, ct));

    // ---------------- Tăng ca ----------------

    [McpServerTool(Name = "list_my_overtime", Title = "Tăng ca của tôi", ReadOnly = true, OpenWorld = false)]
    [Description("Các đơn tăng ca của tôi (số phút, loại ngày & hệ số 150/200/300%, trạng thái duyệt).")]
    public static async Task<string> ListMyOvertime(OfficeHubApi api,
        [Description("Tháng dạng yyyy-MM; bỏ trống = tháng hiện tại")] string? month = null, CancellationToken ct = default) =>
        Out(await api.GetAsync("/api/attendance/overtime/my" + (OptionalMonth(month) is { } m ? $"?month={Q(m)}" : ""), ct));

    [McpServerTool(Name = "preview_overtime", Title = "Xem trước tăng ca", ReadOnly = true, OpenWorld = false)]
    [Description("Tính trước một đơn tăng ca (chưa gửi): số phút, loại ngày, hệ số, tổng tháng / năm và cảnh báo vượt 40 giờ/tháng, 200 giờ/năm.")]
    public static async Task<string> PreviewOvertime(OfficeHubApi api,
        [Description("Ngày tăng ca, yyyy-MM-dd")] string workDate,
        [Description("Giờ bắt đầu HH:mm")] string startTime,
        [Description("Giờ kết thúc HH:mm (cùng ngày)")] string endTime,
        CancellationToken ct = default) =>
        Out(await api.GetAsync($"/api/attendance/overtime/preview?workDate={Date(workDate, "Ngày")}&startTime={Q(startTime)}&endTime={Q(endTime)}", ct));

    [McpServerTool(Name = "register_overtime", Title = "Đăng ký tăng ca", Destructive = false, OpenWorld = false)]
    [Description("Gửi đơn tăng ca (đăng ký trước hoặc khai bù trong 7 ngày; đi qua luồng duyệt). Chưa hỗ trợ qua đêm. " +
                 "Nên gọi preview_overtime trước và XÁC NHẬN với người dùng trước khi gửi.")]
    public static async Task<string> RegisterOvertime(OfficeHubApi api,
        [Description("Ngày tăng ca, yyyy-MM-dd")] string workDate,
        [Description("Giờ bắt đầu HH:mm")] string startTime,
        [Description("Giờ kết thúc HH:mm (cùng ngày)")] string endTime,
        [Description("Lý do / công việc (bắt buộc, ≤ 500 ký tự)")] string reason,
        CancellationToken ct = default) =>
        Out(await api.PostAsync("/api/attendance/overtime",
            new { workDate = Date(workDate, "Ngày"), startTime, endTime, reason }, ct));

    // ---------------- Quản lý / HR ----------------

    [McpServerTool(Name = "get_team_attendance", Title = "Chấm công của nhóm", ReadOnly = true, OpenWorld = false)]
    [Description("(Quản lý / HR) Chấm công trong một ngày của các nhân viên tôi được xem (quản lý: cấp dưới; HR: tất cả).")]
    public static async Task<string> GetTeamAttendance(OfficeHubApi api,
        [Description("Ngày yyyy-MM-dd; bỏ trống = hôm nay")] string? date = null, CancellationToken ct = default) =>
        Out(await api.GetAsync("/api/attendance/board" + (string.IsNullOrWhiteSpace(date) ? "" : $"?date={Date(date, "Ngày")}"), ct));

    [McpServerTool(Name = "get_team_attendance_report", Title = "Tổng hợp công tháng của nhóm", ReadOnly = true, OpenWorld = false)]
    [Description("(Quản lý / HR) Tổng hợp công một tháng theo từng nhân viên tôi được xem.")]
    public static async Task<string> GetTeamAttendanceReport(OfficeHubApi api,
        [Description("Tháng dạng yyyy-MM; bỏ trống = tháng hiện tại")] string? month = null, CancellationToken ct = default) =>
        Out(await api.GetAsync("/api/attendance/report" + (OptionalMonth(month) is { } m ? $"?month={Q(m)}" : ""), ct));

    [McpServerTool(Name = "list_pending_corrections", Title = "Giải trình chấm công đang chờ duyệt", ReadOnly = true, OpenWorld = false)]
    [Description("(Quản lý / HR) Đơn giải trình chấm công ĐANG CHỜ DUYỆT của những người tôi được xem (quản lý: bản thân + cấp dưới; HR: tất cả): " +
                 "nhân viên, ngày, giờ vào / ra bổ sung, hình thức, lý do, approvalRequestId. Gồm cả đơn đang chờ bước khác (vd chờ HR) — " +
                 "list_approval_inbox chỉ có đơn chờ chính tôi quyết. Chỉ xem: duyệt / từ chối không tự làm.")]
    public static async Task<string> ListPendingCorrections(OfficeHubApi api, CancellationToken ct) =>
        Out(await api.GetAsync("/api/attendance/corrections/pending", ct));

    [McpServerTool(Name = "list_pending_overtime", Title = "Tăng ca đang chờ duyệt", ReadOnly = true, OpenWorld = false)]
    [Description("(Quản lý / HR) Đơn tăng ca ĐANG CHỜ DUYỆT của những người tôi được xem (quản lý: bản thân + cấp dưới; HR: tất cả): " +
                 "nhân viên, ngày, giờ, số phút, loại ngày + hệ số %, lý do, approvalRequestId (không có tiền). Gồm cả đơn đang chờ bước khác — " +
                 "list_approval_inbox chỉ có đơn chờ chính tôi quyết. Chỉ xem: duyệt / từ chối không tự làm.")]
    public static async Task<string> ListPendingOvertime(OfficeHubApi api, CancellationToken ct) =>
        Out(await api.GetAsync("/api/attendance/overtime/pending", ct));

    [McpServerTool(Name = "get_employee_timesheet", Title = "Bảng công của một nhân viên", ReadOnly = true, OpenWorld = false)]
    [Description("(Quản lý / HR) Bảng công tháng của một nhân viên (employeeId lấy từ search_colleagues). Quản lý chỉ xem được cấp dưới.")]
    public static async Task<string> GetEmployeeTimesheet(OfficeHubApi api,
        [Description("Id nhân viên")] Guid employeeId,
        [Description("Tháng dạng yyyy-MM; bỏ trống = tháng hiện tại")] string? month = null, CancellationToken ct = default)
    {
        if (employeeId == Guid.Empty) throw new McpException("Thiếu employeeId");
        return Out(await api.GetAsync($"/api/attendance/employees/{employeeId}" + (OptionalMonth(month) is { } m ? $"?month={Q(m)}" : ""), ct));
    }
}
