using System.Globalization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Attendance.Domain;
using OfficeHub.Modules.Attendance.Infrastructure;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Attendance.Features.Shifts;

/// <summary>Giờ dạng "HH:mm".</summary>
public sealed record UpsertShiftRequest(string Name, string Type, string? StartTime, string? EndTime, int GraceMinutes,
    int RequiredMinutes, string? EarliestIn, string? LatestIn, string? BreakStart, string? BreakEnd);

/// <summary>Lịch tuần: 7 phần tử (0 = Chủ nhật … 6 = Thứ 7), ShiftId null = nghỉ.</summary>
public sealed record WeekDay(int DayOfWeek, Guid? ShiftId);
public sealed record ScheduleDto(Guid? EmployeeId, string? EmployeeName, DateOnly EffectiveFrom, IReadOnlyList<WeekDay> Days);
public sealed record SaveScheduleRequest(Guid? EmployeeId, DateOnly EffectiveFrom, WeekDay[] Days);

public sealed record HolidayDto(Guid Id, DateOnly Date, string Name);
public sealed record CreateHolidayRequest(DateOnly Date, string Name);

/// <summary>HR cấu hình ca làm, lịch tuần (công ty / từng nhân viên), ngày lễ. Ai cũng xem được ca và ngày lễ.</summary>
internal static class ShiftEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/shifts", ListShiftsAsync);
        g.MapPost("/shifts", CreateShiftAsync).RequireAuthorization(AuthPolicies.Hr);
        g.MapPut("/shifts/{id:guid}", UpdateShiftAsync).RequireAuthorization(AuthPolicies.Hr);
        g.MapDelete("/shifts/{id:guid}", DeleteShiftAsync).RequireAuthorization(AuthPolicies.Hr);

        g.MapGet("/schedules", ListSchedulesAsync).RequireAuthorization(AuthPolicies.Hr);
        g.MapPut("/schedules", SaveScheduleAsync).RequireAuthorization(AuthPolicies.Hr);
        g.MapDelete("/schedules", DeleteScheduleAsync).RequireAuthorization(AuthPolicies.Hr);

        g.MapGet("/holidays", ListHolidaysAsync);
        g.MapPost("/holidays", CreateHolidayAsync).RequireAuthorization(AuthPolicies.Hr);
        g.MapDelete("/holidays/{id:guid}", DeleteHolidayAsync).RequireAuthorization(AuthPolicies.Hr);
    }

    // ---------------- Ca làm ----------------

    private static async Task<Ok<List<ShiftDto>>> ListShiftsAsync(AttendanceDbContext db, CancellationToken ct) =>
        TypedResults.Ok((await db.Shifts.AsNoTracking().OrderBy(s => s.Name).ToListAsync(ct)).Select(DtoMap.Shift).ToList());

    private static async Task<Results<Ok<ShiftDto>, ValidationProblem>> CreateShiftAsync(UpsertShiftRequest req, AttendanceDbContext db,
        TimeProvider clock, CancellationToken ct)
    {
        var s = new Shift { Name = "", CreatedAt = clock.GetUtcNow() };
        var v = Apply(s, req);
        if (v.Failed) return v.Problem();
        db.Shifts.Add(s);
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(DtoMap.Shift(s));
    }

    private static async Task<Results<Ok<ShiftDto>, NotFound, ValidationProblem>> UpdateShiftAsync(Guid id, UpsertShiftRequest req,
        AttendanceDbContext db, CancellationToken ct)
    {
        var s = await db.Shifts.FindAsync([id], ct);
        if (s is null) return TypedResults.NotFound();
        var v = Apply(s, req);
        if (v.Failed) return v.Problem();
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(DtoMap.Shift(s));
    }

    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> DeleteShiftAsync(Guid id, AttendanceDbContext db,
        AttendanceService svc, CancellationToken ct)
    {
        var s = await db.Shifts.FindAsync([id], ct);
        if (s is null) return TypedResults.NotFound();
        if (await db.Schedules.AnyAsync(x => x.ShiftId == id && x.EffectiveFrom >= svc.Today, ct) || await IsInCurrentScheduleAsync(id, db, svc, ct))
            return Problems.Conflict("Ca đang được dùng trong lịch làm việc, hãy đổi lịch trước");
        s.DeletedAt = svc.Now; // xoá mềm: bảng công cũ vẫn hiện tên ca
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private static async Task<bool> IsInCurrentScheduleAsync(Guid shiftId, AttendanceDbContext db, AttendanceService svc, CancellationToken ct)
    {
        var all = await db.Schedules.AsNoTracking().Where(s => s.EffectiveFrom <= svc.Today).ToListAsync(ct);
        return all.GroupBy(s => s.EmployeeId)
            .Select(g => g.Where(x => x.EffectiveFrom == g.Max(y => y.EffectiveFrom)))
            .Any(cur => cur.Any(x => x.ShiftId == shiftId));
    }

    private static Validation Apply(Shift s, UpsertShiftRequest r)
    {
        var v = new Validation().Required(r.Name, "name", "Tên ca").MaxLength(r.Name, 100, "name", "Tên ca");
        if (!Enum.TryParse<ShiftType>(r.Type, true, out var type)) return v.Add("type", "Loại ca không hợp lệ");
        TimeOnly? Parse(string? x, string field, string label)
        {
            if (string.IsNullOrWhiteSpace(x)) return null;
            if (TimeOnly.TryParseExact(x, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var t)) return t;
            v.Add(field, $"{label} phải có dạng HH:mm");
            return null;
        }
        var start = Parse(r.StartTime, "startTime", "Giờ vào");
        var end = Parse(r.EndTime, "endTime", "Giờ ra");
        var earliest = Parse(r.EarliestIn, "earliestIn", "Vào sớm nhất");
        var latest = Parse(r.LatestIn, "latestIn", "Vào muộn nhất");
        var bs = Parse(r.BreakStart, "breakStart", "Bắt đầu nghỉ");
        var be = Parse(r.BreakEnd, "breakEnd", "Kết thúc nghỉ");

        if (type == ShiftType.Fixed)
        {
            v.When(start is null, "startTime", "Ca cố định cần giờ vào").When(end is null, "endTime", "Ca cố định cần giờ ra");
            v.When(start is { } a && end is { } b && b <= a, "endTime", "Giờ ra phải sau giờ vào (chưa hỗ trợ ca qua đêm)");
            v.When(r.GraceMinutes is < 0 or > 120, "graceMinutes", "Số phút cho phép trễ từ 0 đến 120");
        }
        else
        {
            v.When(r.RequiredMinutes is < 60 or > 960, "requiredMinutes", "Số giờ phải đủ từ 1 đến 16 tiếng");
            v.When(earliest is { } a && latest is { } b && b < a, "latestIn", "Giờ vào muộn nhất phải sau giờ vào sớm nhất");
        }
        v.When((bs is null) != (be is null), "breakEnd", "Nhập đủ cả giờ bắt đầu và kết thúc nghỉ");
        v.When(bs is { } x && be is { } y && y <= x, "breakEnd", "Giờ kết thúc nghỉ phải sau giờ bắt đầu");
        if (v.Failed) return v;

        s.Name = r.Name.Trim();
        s.Type = type;
        s.StartTime = type == ShiftType.Fixed ? start : null;
        s.EndTime = type == ShiftType.Fixed ? end : null;
        s.GraceMinutes = type == ShiftType.Fixed ? r.GraceMinutes : 0;
        s.RequiredMinutes = type == ShiftType.Flexible ? r.RequiredMinutes : 0;
        s.EarliestIn = type == ShiftType.Flexible ? earliest : null;
        s.LatestIn = type == ShiftType.Flexible ? latest : null;
        s.BreakStart = bs;
        s.BreakEnd = be;
        return v;
    }

    // ---------------- Lịch tuần ----------------

    /// <summary>Lịch đang áp dụng (và sắp áp dụng) của công ty + từng nhân viên có lịch riêng.</summary>
    /// <summary>Bộ đang hiệu lực + tương lai của công ty rồi từng nhân viên còn làm. Có <c>page</c> → trang.</summary>
    private static async Task<Results<Ok<List<ScheduleDto>>, Ok<PagedResult<ScheduleDto>>>> ListSchedulesAsync(int? page, int? pageSize, AttendanceDbContext db,
        IEmployeeDirectory dir, AttendanceService svc, CancellationToken ct)
    {
        var all = await db.Schedules.AsNoTracking().ToListAsync(ct);
        var names = (await dir.ListActiveAsync(ct)).ToDictionary(e => e.Id, e => $"{e.Code} · {e.FullName}");
        var result = new List<ScheduleDto>();
        foreach (var byOwner in all.GroupBy(s => s.EmployeeId).OrderBy(g => g.Key is null ? 0 : 1))
        {
            // bộ đang hiệu lực + các bộ tương lai
            var current = byOwner.Where(s => s.EffectiveFrom <= svc.Today).Select(s => s.EffectiveFrom).DefaultIfEmpty().Max();
            foreach (var set in byOwner.GroupBy(s => s.EffectiveFrom).Where(g => g.Key >= current).OrderBy(g => g.Key))
            {
                if (byOwner.Key is { } eid && !names.ContainsKey(eid)) continue; // nhân viên đã nghỉ
                result.Add(new ScheduleDto(byOwner.Key, byOwner.Key is { } id ? names[id] : null, set.Key,
                    [.. set.OrderBy(x => x.DayOfWeek).Select(x => new WeekDay((int)x.DayOfWeek, x.ShiftId))]));
            }
        }
        if (page is { } pg) return TypedResults.Ok(Paging.Of(result, pg, pageSize));
        return TypedResults.Ok(result);
    }

    private static async Task<Results<NoContent, ValidationProblem>> SaveScheduleAsync(SaveScheduleRequest req, AttendanceDbContext db,
        IEmployeeDirectory dir, TimeProvider clock, CancellationToken ct)
    {
        var v = new Validation()
            .When(req.Days is not { Length: 7 } || req.Days.Select(d => d.DayOfWeek).Distinct().Count() != 7 || req.Days.Any(d => d.DayOfWeek is < 0 or > 6),
                "days", "Cần đủ 7 ngày trong tuần");
        var shiftIds = req.Days?.Where(d => d.ShiftId != null).Select(d => d.ShiftId!.Value).Distinct().ToList() ?? [];
        if (shiftIds.Count > 0 && await db.Shifts.CountAsync(s => shiftIds.Contains(s.Id), ct) != shiftIds.Count) v.Add("days", "Có ca không tồn tại");
        if (req.EmployeeId is { } eid && await dir.GetAsync(eid, ct) is null) v.Add("employeeId", "Nhân viên không tồn tại");
        if (v.Failed) return v.Problem();

        // Ghi đè bộ lịch cùng ngày hiệu lực (nếu có), giữ nguyên các bộ khác → bảng công quá khứ không đổi.
        await db.Schedules.Where(s => s.EmployeeId == req.EmployeeId && s.EffectiveFrom == req.EffectiveFrom).ExecuteDeleteAsync(ct);
        var now = clock.GetUtcNow();
        db.Schedules.AddRange(req.Days!.Select(d => new ScheduleEntry
        {
            EmployeeId = req.EmployeeId, EffectiveFrom = req.EffectiveFrom, DayOfWeek = (DayOfWeek)d.DayOfWeek, ShiftId = d.ShiftId, CreatedAt = now,
        }));
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    /// <summary>Xoá một bộ lịch chưa/đang áp dụng. Xoá lịch riêng của nhân viên → quay về lịch công ty.</summary>
    private static async Task<Results<NoContent, ProblemHttpResult>> DeleteScheduleAsync(Guid? employeeId, DateOnly effectiveFrom,
        AttendanceDbContext db, CancellationToken ct)
    {
        if (employeeId is null && await db.Schedules.Where(s => s.EmployeeId == null).Select(s => s.EffectiveFrom).Distinct().CountAsync(ct) <= 1)
            return Problems.Conflict("Không thể xoá lịch công ty duy nhất");
        await db.Schedules.Where(s => s.EmployeeId == employeeId && s.EffectiveFrom == effectiveFrom).ExecuteDeleteAsync(ct);
        return TypedResults.NoContent();
    }

    // ---------------- Ngày lễ ----------------

    private static async Task<Ok<List<HolidayDto>>> ListHolidaysAsync(int? year, AttendanceDbContext db, AttendanceService svc, CancellationToken ct)
    {
        var y = year ?? svc.Today.Year;
        var list = await db.Holidays.AsNoTracking().Where(h => h.Date.Year == y).OrderBy(h => h.Date).ToListAsync(ct);
        return TypedResults.Ok(list.Select(h => new HolidayDto(h.Id, h.Date, h.Name)).ToList());
    }

    private static async Task<Results<Ok<HolidayDto>, ValidationProblem>> CreateHolidayAsync(CreateHolidayRequest req, AttendanceDbContext db, CancellationToken ct)
    {
        var v = new Validation().Required(req.Name, "name", "Tên ngày lễ").When(req.Date == default, "date", "Chọn ngày");
        if (await db.Holidays.AnyAsync(h => h.Date == req.Date, ct)) v.Add("date", "Ngày này đã là ngày lễ");
        if (v.Failed) return v.Problem();
        var h = new Holiday { Date = req.Date, Name = req.Name.Trim() };
        db.Holidays.Add(h);
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(new HolidayDto(h.Id, h.Date, h.Name));
    }

    private static async Task<NoContent> DeleteHolidayAsync(Guid id, AttendanceDbContext db, CancellationToken ct)
    {
        await db.Holidays.Where(h => h.Id == id).ExecuteDeleteAsync(ct);
        return TypedResults.NoContent();
    }
}
