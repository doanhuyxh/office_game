using OfficeHub.Modules.Attendance.Domain;
using OfficeHub.Modules.Attendance.Infrastructure;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Attendance.Features;

public sealed record ShiftDto(Guid Id, string Name, string Type, string? StartTime, string? EndTime, int GraceMinutes,
    int RequiredMinutes, string? EarliestIn, string? LatestIn, string? BreakStart, string? BreakEnd, int PlannedMinutes);

public sealed record SessionDto(DateTimeOffset In, DateTimeOffset? Out);

public sealed record DayDto(DateOnly Date, string Status, IReadOnlyList<SessionDto> Sessions, DateTimeOffset? FirstIn, DateTimeOffset? LastOut,
    int WorkedMinutes, int RequiredMinutes, int LateMinutes, int ShortMinutes, string? WorkMode, string? ShiftName, string? HolidayName);

public sealed record SummaryDto(int WorkDays, int PresentDays, int AbsentDays, int LateCount, int LateMinutes, int ShortMinutes,
    int WorkedMinutes, int RequiredMinutes, int OnsiteDays, int RemoteDays, int MixedDays, int MissingCheckoutDays);

public sealed record EmployeeBrief(Guid Id, string Code, string FullName, string? DepartmentName);

public sealed record TodayDto(EmployeeBrief Employee, bool CheckedIn, string NextAction, DayDto Day, ShiftDto? Shift, DateTimeOffset ServerTime,
    string CurrentWorkMode);

public sealed record MonthDto(EmployeeBrief Employee, string Month, IReadOnlyList<DayDto> Days, SummaryDto Summary);

public sealed record BoardRow(EmployeeBrief Employee, DayDto Day);

public sealed record ReportRow(EmployeeBrief Employee, SummaryDto Summary);

internal static class DtoMap
{
    private static string? T(TimeOnly? t) => t?.ToString("HH:mm");

    public static ShiftDto Shift(Shift s) => new(s.Id, s.Name, s.Type.ToString(), T(s.StartTime), T(s.EndTime), s.GraceMinutes,
        s.RequiredMinutes, T(s.EarliestIn), T(s.LatestIn), T(s.BreakStart), T(s.BreakEnd), TimesheetCalculator.RequiredMinutes(s));

    public static DayDto Day(AttendanceService.ComputedDay c) => new(c.Result.Date, c.Result.Status.ToString(),
        [.. c.Result.Sessions.Select(s => new SessionDto(s.In, s.Out))], c.Result.FirstIn, c.Result.LastOut,
        c.Result.WorkedMinutes, c.Result.RequiredMinutes, c.Result.LateMinutes, c.Result.ShortMinutes, c.Result.WorkMode,
        c.Shift?.Name, c.HolidayName);

    public static EmployeeBrief Brief(EmployeeRef e) => new(e.Id, e.Code, e.FullName, e.DepartmentName);

    public static SummaryDto Summary(IEnumerable<AttendanceService.ComputedDay> days)
    {
        var list = days.Select(d => d.Result).ToList();
        bool attended(DayResult r) => r.Status is DayStatus.Present or DayStatus.Working or DayStatus.MissingCheckout;
        return new SummaryDto(
            WorkDays: list.Count(r => r.RequiredMinutes > 0),
            PresentDays: list.Count(attended),
            AbsentDays: list.Count(r => r.Status == DayStatus.Absent),
            LateCount: list.Count(r => r.LateMinutes > 0),
            LateMinutes: list.Sum(r => r.LateMinutes),
            ShortMinutes: list.Sum(r => r.ShortMinutes),
            WorkedMinutes: list.Sum(r => r.WorkedMinutes),
            RequiredMinutes: list.Where(r => r.Status != DayStatus.NotYet).Sum(r => r.RequiredMinutes),
            OnsiteDays: list.Count(r => r.WorkMode == "Onsite"),
            RemoteDays: list.Count(r => r.WorkMode == "Remote"),
            MixedDays: list.Count(r => r.WorkMode == "Mixed"),
            MissingCheckoutDays: list.Count(r => r.Status == DayStatus.MissingCheckout));
    }
}
