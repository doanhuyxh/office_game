namespace OfficeHub.Modules.Attendance.Domain;

public enum DayStatus
{
    /// <summary>Không có ca (ngày nghỉ) và không chấm công.</summary>
    DayOff,
    Holiday,
    /// <summary>Hôm nay, chưa chấm công, chưa hết ca.</summary>
    NotYet,
    /// <summary>Đang trong phiên làm việc (đã vào, chưa ra) — chỉ hôm nay.</summary>
    Working,
    /// <summary>Có đủ cặp vào/ra.</summary>
    Present,
    /// <summary>Ngày đã qua, còn phiên chưa chấm ra.</summary>
    MissingCheckout,
    /// <summary>Có ca nhưng không chấm công (ngày đã qua hoặc đã hết ca).</summary>
    Absent,
    /// <summary>Trước ngày vào làm hoặc sau ngày nghỉ việc — không tính công.</summary>
    NotEmployed,
    /// <summary>Nghỉ phép cả ngày (đơn đã duyệt), không chấm công.</summary>
    Leave,
}

/// <summary>Nghỉ phép đã duyệt trong ngày. Fraction 1 = cả ngày, 0.5 = nửa ngày (Morning / Afternoon).</summary>
public sealed record DayLeave(decimal Fraction, bool Morning, bool Afternoon, string Name);

public sealed record Punch(DateTimeOffset At, PunchType Type, WorkMode Mode);

public sealed record WorkSession(DateTimeOffset In, DateTimeOffset? Out);

public sealed record DayResult(
    DateOnly Date,
    DayStatus Status,
    IReadOnlyList<WorkSession> Sessions,
    DateTimeOffset? FirstIn,
    DateTimeOffset? LastOut,
    int WorkedMinutes,
    int RequiredMinutes,
    int LateMinutes,
    /// <summary>Ca cố định: về sớm. Ca linh hoạt: thiếu giờ so với số giờ phải đủ.</summary>
    int ShortMinutes,
    /// <summary>"Onsite" / "Remote" / "Mixed" / null nếu không chấm công.</summary>
    string? WorkMode,
    /// <summary>Có ca và không phải ngày lễ (ngày phải đi làm theo lịch).</summary>
    bool Scheduled = false,
    /// <summary>Phần ngày nghỉ phép đã duyệt (0, 0.5, 1).</summary>
    decimal LeaveFraction = 0,
    string? LeaveName = null);

/// <summary>
/// Tính công MỘT ngày từ sự kiện thô + ca làm. Hàm thuần (không DB) để test được.
/// Quy tắc: xem docs/ARCHITECTURE_V2.md mục 6.
/// </summary>
public static class TimesheetCalculator
{
    public static DayResult Compute(DateOnly date, IEnumerable<Punch> punches, Shift? shift, bool isHoliday,
        DateTimeOffset now, TimeZoneInfo tz, DayLeave? leave = null)
    {
        var scheduled = shift is not null && !isHoliday;
        var fullLeave = leave is { Fraction: >= 1 };
        var halfLeave = leave is { Fraction: > 0 and < 1 };
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, tz).DateTime);
        var isToday = date == today;
        var ordered = punches.OrderBy(p => p.At).ToList();

        // 1) Ghép cặp vào → ra. Vào lặp khi đang mở phiên: bỏ qua. Ra khi chưa vào: bỏ qua.
        var sessions = new List<WorkSession>();
        DateTimeOffset? open = null;
        foreach (var p in ordered)
        {
            if (p.Type == PunchType.In) open ??= p.At;
            else if (open is { } start) { sessions.Add(new WorkSession(start, p.At)); open = null; }
        }
        if (open is { } o) sessions.Add(new WorkSession(o, null));

        // Nghỉ cả ngày: không phải làm. Nghỉ nửa ngày: phải làm một nửa.
        var required = isHoliday || fullLeave ? 0 : halfLeave ? RequiredMinutes(shift) / 2 : RequiredMinutes(shift);
        var mode = ordered.Count == 0 ? null
            : ordered.Select(p => p.Mode).Distinct().Count() > 1 ? "Mixed"
            : ordered[0].Mode == Domain.WorkMode.Onsite ? "Onsite" : "Remote";

        if (ordered.Count == 0)
        {
            var status = isHoliday ? DayStatus.Holiday
                : shift is null ? DayStatus.DayOff
                : fullLeave ? DayStatus.Leave
                : date > today || (isToday && !ShiftEnded(date, shift, now, tz)) ? DayStatus.NotYet
                : DayStatus.Absent;
            return new DayResult(date, status, [], null, null, 0, required, 0, 0, null, scheduled, leave?.Fraction ?? 0, leave?.Name);
        }

        // 2) Phiên đang mở: hôm nay → tính tới hiện tại; ngày cũ → thiếu giờ ra, không tính.
        var hasOpen = sessions.Any(s => s.Out is null);
        var counted = sessions.Select(s => s with { Out = s.Out ?? (isToday ? now : null) })
            .Where(s => s.Out is not null).ToList();

        var breakWindow = BreakWindow(date, shift, tz);
        var worked = counted.Sum(s => Minutes(s.In, s.Out!.Value) - Overlap(s.In, s.Out!.Value, breakWindow));

        var firstIn = sessions[0].In;
        var lastOut = sessions.LastOrDefault(s => s.Out is not null)?.Out;
        var dayStatus = hasOpen ? (isToday ? DayStatus.Working : DayStatus.MissingCheckout) : DayStatus.Present;

        int late = 0, shortMin = 0;
        // Nghỉ buổi sáng → không xét đi muộn; nghỉ buổi chiều → không xét về sớm (ca cố định).
        if (shift is not null && !isHoliday && !fullLeave)
        {
            var skipLate = leave?.Morning == true;
            var skipEarly = leave?.Afternoon == true;
            if (shift.Type == ShiftType.Fixed && shift.StartTime is { } st && shift.EndTime is { } et)
            {
                var start = At(date, st, tz);
                if (!skipLate && firstIn > start.AddMinutes(shift.GraceMinutes)) late = Minutes(start, firstIn);
                if (!skipEarly && dayStatus == DayStatus.Present && lastOut is { } lo && lo < At(date, et, tz)) shortMin = Minutes(lo, At(date, et, tz));
            }
            else if (shift.Type == ShiftType.Flexible)
            {
                if (!skipLate && shift.LatestIn is { } li && firstIn > At(date, li, tz)) late = Minutes(At(date, li, tz), firstIn);
                if (dayStatus == DayStatus.Present) shortMin = Math.Max(0, required - worked);
            }
        }

        return new DayResult(date, dayStatus, sessions, firstIn, lastOut, worked, required, late, shortMin, mode, scheduled,
            leave?.Fraction ?? 0, leave?.Name);
    }

    public static int RequiredMinutes(Shift? shift)
    {
        if (shift is null) return 0;
        if (shift.Type == ShiftType.Flexible) return shift.RequiredMinutes;
        if (shift.StartTime is not { } s || shift.EndTime is not { } e) return 0;
        var total = (int)(e - s).TotalMinutes;
        if (shift.BreakStart is { } bs && shift.BreakEnd is { } be) total -= (int)(be - bs).TotalMinutes;
        return Math.Max(0, total);
    }

    private static bool ShiftEnded(DateOnly date, Shift shift, DateTimeOffset now, TimeZoneInfo tz) =>
        shift.Type == ShiftType.Fixed && shift.EndTime is { } et ? now >= At(date, et, tz)
        : shift.LatestIn is { } li ? now >= At(date, li, tz).AddMinutes(shift.RequiredMinutes)
        : false;

    private static (DateTimeOffset Start, DateTimeOffset End)? BreakWindow(DateOnly date, Shift? shift, TimeZoneInfo tz) =>
        shift?.BreakStart is { } bs && shift.BreakEnd is { } be && be > bs ? (At(date, bs, tz), At(date, be, tz)) : null;

    /// <summary>Giờ địa phương của văn phòng → mốc thời gian tuyệt đối.</summary>
    public static DateTimeOffset At(DateOnly date, TimeOnly time, TimeZoneInfo tz)
    {
        var local = date.ToDateTime(time, DateTimeKind.Unspecified);
        return new DateTimeOffset(local, tz.GetUtcOffset(local));
    }

    private static int Minutes(DateTimeOffset a, DateTimeOffset b) => Math.Max(0, (int)Math.Floor((b - a).TotalMinutes));

    private static int Overlap(DateTimeOffset a, DateTimeOffset b, (DateTimeOffset Start, DateTimeOffset End)? w)
    {
        if (w is not { } x) return 0;
        var s = a > x.Start ? a : x.Start;
        var e = b < x.End ? b : x.End;
        return e > s ? (int)Math.Floor((e - s).TotalMinutes) : 0;
    }
}
