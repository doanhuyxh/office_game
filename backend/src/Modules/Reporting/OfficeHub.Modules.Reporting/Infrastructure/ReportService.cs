using System.Globalization;
using System.Security.Claims;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.Modules.Attendance.Contracts;
using OfficeHub.Modules.LaborContracts.Contracts;
using OfficeHub.Modules.Leave.Contracts;
using OfficeHub.Modules.Organization.Contracts;
using OfficeHub.Modules.Payroll.Contracts;

namespace OfficeHub.Modules.Reporting.Infrastructure;

public sealed record EmployeeBrief(Guid Id, string Code, string FullName, string? DepartmentName, bool IsActive, DateOnly JoinedAt, DateOnly? LeftAt);

/// <param name="Warning">Vd thiếu hợp đồng / chưa nhập lương → không quy ra tiền được.</param>
public sealed record OvertimePayRow(EmployeeBrief Employee, string? ContractNumber, decimal? Salary, int StandardDays, decimal? HourlyWage,
    int WeekdayMinutes, int RestDayMinutes, int HolidayMinutes, int TotalMinutes,
    decimal? WeekdayAmount, decimal? RestDayAmount, decimal? HolidayAmount, decimal? TotalAmount, string? Warning);

public sealed record OvertimePayLine(Guid EmployeeId, DateOnly WorkDate, string StartTime, string EndTime, int Minutes, string Kind, int Percent,
    decimal? HourlyWage, decimal? Amount, string Reason);

public sealed record OvertimePayReport(string Month, IReadOnlyList<OvertimePayRow> Rows, IReadOnlyList<OvertimePayLine> Lines, int TotalMinutes, decimal TotalAmount);

/// <param name="AsOf">Người đã nghỉ: ngày nghỉ việc; đang làm: hôm nay.</param>
/// <param name="PayoutDue">true = đã nghỉ việc → số tiền phải trả; false = ước tính.</param>
public sealed record LeavePayoutRow(EmployeeBrief Employee, int Year, int Entitlement, decimal Accrued, decimal Carried, decimal Adjusted,
    decimal Used, decimal Pending, decimal Available, DateOnly AsOf, decimal? Salary, int StandardDays, decimal? DailyWage, decimal? PayoutAmount,
    bool PayoutDue, string? Warning);

/// <summary>Gom dữ liệu báo cáo từ các module khác (chỉ qua *.Contracts) + quy ra tiền theo <see cref="PayRules"/>.</summary>
internal sealed class ReportService(IEmployeeDirectory dir, IAttendanceReports attendance, IWorkCalendar calendar, ILeaveBalances leave,
    ISalaryLookup salaries, IOptions<OfficeSettings> office, TimeProvider clock)
{
    private readonly TimeZoneInfo _tz = TimeZoneInfo.FindSystemTimeZoneById(office.Value.TimeZone);
    public TimeZoneInfo Tz => _tz;
    public DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), _tz).DateTime);

    /// <summary>"yyyy-MM" → ngày 1 của tháng; trống = tháng hiện tại (giờ VN); sai → null.</summary>
    public DateOnly? ParseMonth(string? month)
    {
        if (string.IsNullOrWhiteSpace(month)) return new DateOnly(Today.Year, Today.Month, 1);
        return DateOnly.TryParseExact(month.Trim() + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;
    }

    public static EmployeeBrief Brief(EmployeeRef e) => new(e.Id, e.Code, e.FullName, e.DepartmentName, e.IsActive, e.JoinedAt, e.LeftAt);

    /// <summary>HR: mọi người làm việc trong kỳ. Quản lý: bản thân + cấp dưới (trực tiếp, gián tiếp).</summary>
    public async Task<IReadOnlyList<EmployeeRef>> VisibleAsync(ClaimsPrincipal user, DateOnly from, DateOnly to, CancellationToken ct)
    {
        var all = await dir.ListEmployedAsync(from, to, ct);
        if (user.IsHr()) return all;
        if (user.GetUserId() is not { } uid || await dir.GetByUserIdAsync(uid, ct) is not { } me) return [];
        var visible = (await dir.GetSubordinateIdsAsync(me.Id, ct)).Append(me.Id).ToHashSet();
        return all.Where(e => visible.Contains(e.Id)).ToList();
    }

    public Task<IReadOnlyDictionary<Guid, TimesheetMonth>> TimesheetAsync(IReadOnlyCollection<EmployeeRef> employees, DateOnly month, CancellationToken ct) =>
        attendance.MonthAsync(employees.Select(e => e.Id).ToList(), month, ct);

    // ---------------- Tiền tăng ca ----------------

    public async Task<OvertimePayReport> OvertimePayAsync(DateOnly month, CancellationToken ct)
    {
        var from = month;
        var to = month.AddMonths(1).AddDays(-1);
        var employees = await dir.ListEmployedAsync(from, to, ct);
        var ids = employees.Select(e => e.Id).ToList();
        var entries = await attendance.ApprovedOvertimeAsync(ids, from, to, ct);

        var standard = new Dictionary<Guid, int>();
        foreach (var e in employees) standard[e.Id] = await calendar.StandardDaysAsync(e.Id, from, to, ct);
        // Lương hiệu lực theo từng NGÀY tăng ca (đổi lương giữa tháng → mỗi dòng đúng mức lương của ngày đó).
        var salaryByDate = new Dictionary<DateOnly, IReadOnlyDictionary<Guid, SalaryInfo>>();
        foreach (var d in entries.Select(x => x.WorkDate).Distinct())
            salaryByDate[d] = await salaries.GetAsync(entries.Where(x => x.WorkDate == d).Select(x => x.EmployeeId).Distinct().ToList(), d, ct);
        var salaryAtEnd = await salaries.GetAsync(ids, to < Today ? to : Today, ct);

        var lines = entries.Select(x =>
        {
            var sal = salaryByDate[x.WorkDate].GetValueOrDefault(x.EmployeeId)?.Salary;
            var hourly = PayRules.HourlyWage(sal, standard.GetValueOrDefault(x.EmployeeId));
            return new OvertimePayLine(x.EmployeeId, x.WorkDate, x.StartTime, x.EndTime, x.Minutes, x.Kind, x.Percent,
                hourly is { } h ? Math.Round(h, 0) : null, PayRules.OvertimeAmount(x.Minutes, hourly, x.Percent), x.Reason);
        }).ToList();

        var rows = employees.Select(e =>
        {
            var mine = lines.Where(l => l.EmployeeId == e.Id).ToList();
            int min(string k) => mine.Where(l => l.Kind == k).Sum(l => l.Minutes);
            decimal? amt(string k) => mine.Where(l => l.Kind == k).Aggregate((decimal?)0m, (s, l) => s is null || l.Amount is null ? null : s + l.Amount);
            var sal = salaryAtEnd.GetValueOrDefault(e.Id);
            var std = standard.GetValueOrDefault(e.Id);
            string? warning = mine.Count == 0 ? null
                : mine.Any(l => l.Amount is null) ? (std == 0 ? "Không có ca làm trong tháng" : "Thiếu hợp đồng hoặc chưa nhập lương ở ngày tăng ca")
                : null;
            var w = amt("Weekday"); var r = amt("RestDay"); var h = amt("Holiday");
            return new OvertimePayRow(Brief(e), sal?.ContractNumber, sal?.Salary, std,
                PayRules.HourlyWage(sal?.Salary, std) is { } hw ? Math.Round(hw, 0) : null,
                min("Weekday"), min("RestDay"), min("Holiday"), mine.Sum(l => l.Minutes),
                w, r, h, w is null || r is null || h is null ? null : w + r + h, warning);
        }).ToList();

        return new OvertimePayReport(month.ToString("yyyy-MM", CultureInfo.InvariantCulture), rows, lines,
            rows.Sum(r => r.TotalMinutes), rows.Sum(r => r.TotalAmount ?? 0));
    }

    // ---------------- Phép năm → tiền khi nghỉ việc ----------------

    /// <summary>Người đang làm + người đã nghỉ trong năm nay.</summary>
    public async Task<IReadOnlyList<LeavePayoutRow>> LeavePayoutAsync(CancellationToken ct) =>
        await LeavePayoutForAsync(await LeavePayoutEmployeesAsync(ct), ct);

    /// <summary>Người đang làm + người đã nghỉ trong năm nay, sắp theo mã NV (để cắt trang trước khi tính).</summary>
    public async Task<IReadOnlyList<EmployeeRef>> LeavePayoutEmployeesAsync(CancellationToken ct)
    {
        var today = Today;
        return await dir.ListEmployedAsync(new DateOnly(today.Year, 1, 1), today, ct);
    }

    public async Task<IReadOnlyList<LeavePayoutRow>> LeavePayoutForAsync(IReadOnlyList<EmployeeRef> employees, CancellationToken ct)
    {
        var today = Today;
        var balances = await leave.GetAsync(employees.Select(e => e.Id).ToList(), ct);
        var rows = new List<LeavePayoutRow>();
        foreach (var e in employees)
        {
            if (balances.GetValueOrDefault(e.Id) is not { } b) continue;
            var asOf = e.LeftAt is { } left && left <= today ? left : today;
            var monthStart = new DateOnly(asOf.Year, asOf.Month, 1);
            var std = await calendar.StandardDaysAsync(e.Id, monthStart, monthStart.AddMonths(1).AddDays(-1), ct);
            var sal = (await salaries.GetAsync([e.Id], asOf, ct)).GetValueOrDefault(e.Id);
            var daily = PayRules.DailyWage(sal?.Salary, std);
            var warning = sal?.Salary is null ? "Thiếu hợp đồng hoặc chưa nhập lương" : b.Available < 0 ? $"Đã dùng vượt {-b.Available:0.#} ngày" : null;
            rows.Add(new LeavePayoutRow(Brief(e), b.Year, b.EntitlementThisYear, b.AccruedThisYear, b.CarriedFromPreviousYears, b.AdjustedThisYear,
                b.UsedThisYear, b.Pending, b.Available, asOf, sal?.Salary, std, daily is { } dw ? Math.Round(dw, 0) : null,
                PayRules.LeavePayout(b.Available, daily), PayoutDue: !e.IsActive, warning));
        }
        return rows;
    }
}
