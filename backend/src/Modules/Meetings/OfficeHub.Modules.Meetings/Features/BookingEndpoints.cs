using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Meetings.Domain;
using OfficeHub.Modules.Meetings.Infrastructure;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Meetings.Features;

/// <summary>startAt / endAt: ISO 8601 kèm múi giờ (BE từ chối nếu thiếu).</summary>
public sealed record CreateBookingRequest(string RoomId, string Title, DateTimeOffset StartAt, DateTimeOffset EndAt, Guid[]? AttendeeIds, string? Note);
public sealed record AttendeeDto(Guid EmployeeId, string Name);
public sealed record BookingDto(Guid Id, string RoomId, string RoomName, string Title, DateTimeOffset StartAt, DateTimeOffset EndAt,
    Guid OrganizerEmployeeId, string OrganizerName, string? Note, IReadOnlyList<AttendeeDto> Attendees, bool IsMine, bool CanCancel);
public sealed record BookingCreatedDto(BookingDto Booking, IReadOnlyList<string> Warnings);
public sealed record RoomNowDto(string RoomId, string RoomName, int Capacity, BookingDto? Current, BookingDto? Next);

/// <summary>Đặt phòng họp: xem lịch, đặt (chặn trùng giờ), huỷ; trạng thái "đang họp" cho văn phòng 3D.</summary>
internal static class BookingEndpoints
{
    private const int MaxRangeDays = 62;

    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/rooms", (MeetingRooms rooms) => TypedResults.Ok(rooms.All));
        g.MapGet("/bookings", ListAsync);
        g.MapGet("/bookings/now", NowAsync);
        g.MapPost("/bookings", CreateAsync);
        g.MapDelete("/bookings/{id:guid}", CancelAsync);
    }

    private static async Task<EmployeeRef?> MeAsync(ClaimsPrincipal user, IEmployeeDirectory dir, CancellationToken ct) =>
        user.GetUserId() is { } uid ? await dir.GetByUserIdAsync(uid, ct) : null;

    private static BookingDto ToDto(Booking b, MeetingRooms rooms, Guid? meEmployeeId, bool isHr, DateTimeOffset now) =>
        new(b.Id, b.RoomId, rooms.Find(b.RoomId)?.Name ?? b.RoomId, b.Title, b.StartAt, b.EndAt, b.OrganizerEmployeeId, b.OrganizerName, b.Note,
            b.Attendees.OrderBy(a => a.Name).Select(a => new AttendeeDto(a.EmployeeId, a.Name)).ToList(),
            IsMine: b.OrganizerEmployeeId == meEmployeeId || b.Attendees.Any(a => a.EmployeeId == meEmployeeId),
            CanCancel: b.EndAt > now && (b.OrganizerEmployeeId == meEmployeeId || isHr));

    /// <summary>from / to: ISO 8601 kèm múi giờ; mặc định hôm nay (giờ VN) → +7 ngày. roomId, mine=true để lọc.</summary>
    private static async Task<Results<Ok<List<BookingDto>>, ValidationProblem>> ListAsync(string? from, string? to, string? roomId, bool? mine,
        ClaimsPrincipal user, MeetingsDbContext db, MeetingRooms rooms, IEmployeeDirectory dir, IOptions<OfficeSettings> office, TimeProvider clock,
        CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var v = new Validation();
        DateTimeOffset start, end;
        if (string.IsNullOrWhiteSpace(from)) start = StartOfTodayVn(now, office.Value.TimeZone);
        else if (!Instants.TryParse(from, out start)) v.Add("from", Instants.MissingZoneMessage);
        if (string.IsNullOrWhiteSpace(to)) end = (v.Has("from") ? now : start).AddDays(7);
        else if (!Instants.TryParse(to, out end)) v.Add("to", Instants.MissingZoneMessage);
        if (!v.Failed && end <= start) v.Add("to", "Thời điểm kết thúc phải sau thời điểm bắt đầu");
        if (!v.Failed && end - start > TimeSpan.FromDays(MaxRangeDays)) v.Add("to", $"Tối đa {MaxRangeDays} ngày mỗi lần xem");
        if (v.Failed) return v.Problem();

        var me = await MeAsync(user, dir, ct);
        var q = db.Bookings.AsNoTracking().Include(b => b.Attendees)
            .Where(b => b.CancelledAt == null && b.StartAt < end && b.EndAt > start);
        if (!string.IsNullOrWhiteSpace(roomId)) q = q.Where(b => b.RoomId == roomId);
        if (mine == true && me is not null) q = q.Where(b => b.OrganizerEmployeeId == me.Id || b.Attendees.Any(a => a.EmployeeId == me.Id));
        var rows = await q.OrderBy(b => b.StartAt).ToListAsync(ct);
        return TypedResults.Ok(rows.Select(b => ToDto(b, rooms, me?.Id, user.IsHr(), now)).ToList());
    }

    /// <summary>Mỗi phòng: lịch đang diễn ra + lịch kế tiếp trong hôm nay (văn phòng 3D hiển thị "Đang họp").</summary>
    private static async Task<Ok<List<RoomNowDto>>> NowAsync(ClaimsPrincipal user, MeetingsDbContext db, MeetingRooms rooms, IEmployeeDirectory dir,
        IOptions<OfficeSettings> office, TimeProvider clock, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var endOfDay = StartOfTodayVn(now, office.Value.TimeZone).AddDays(1);
        var me = await MeAsync(user, dir, ct);
        var rows = await db.Bookings.AsNoTracking().Include(b => b.Attendees)
            .Where(b => b.CancelledAt == null && b.EndAt > now && b.StartAt < endOfDay).OrderBy(b => b.StartAt).ToListAsync(ct);
        return TypedResults.Ok(rooms.All.Select(r =>
        {
            var mineRows = rows.Where(b => b.RoomId == r.Id).ToList();
            var current = mineRows.FirstOrDefault(b => b.StartAt <= now);
            var next = mineRows.FirstOrDefault(b => b.StartAt > now);
            return new RoomNowDto(r.Id, r.Name, r.Capacity,
                current is null ? null : ToDto(current, rooms, me?.Id, user.IsHr(), now),
                next is null ? null : ToDto(next, rooms, me?.Id, user.IsHr(), now));
        }).ToList());
    }

    private static async Task<Results<Ok<BookingCreatedDto>, ValidationProblem, ProblemHttpResult>> CreateAsync(CreateBookingRequest req,
        ClaimsPrincipal user, MeetingsDbContext db, MeetingRooms rooms, IEmployeeDirectory dir, INotifier notifier, IOptions<OfficeSettings> office,
        TimeProvider clock, CancellationToken ct)
    {
        if (await MeAsync(user, dir, ct) is not { } me)
            return TypedResults.Problem("Tài khoản chưa gắn hồ sơ nhân viên nên chưa đặt phòng được. Liên hệ HR.", statusCode: StatusCodes.Status409Conflict);
        var now = clock.GetUtcNow();
        var room = rooms.Find(req.RoomId);
        var v = new Validation()
            .When(room is null, "roomId", "Phòng họp không tồn tại")
            .Required(req.Title, "title", "Tiêu đề").MaxLength(req.Title?.Trim(), 200, "title", "Tiêu đề")
            .MaxLength(req.Note, 1000, "note", "Ghi chú");
        foreach (var (field, msg) in BookingRules.Validate(req.StartAt, req.EndAt, now)) v.Add(field, msg);
        var attendeeIds = (req.AttendeeIds ?? []).Where(id => id != me.Id).Distinct().ToList();
        if (attendeeIds.Count > BookingRules.MaxAttendees) v.Add("attendeeIds", $"Tối đa {BookingRules.MaxAttendees} người");
        var attendees = new List<EmployeeRef>();
        foreach (var id in attendeeIds)
            if (await dir.GetAsync(id, ct) is { IsActive: true } e) attendees.Add(e);
            else { v.Add("attendeeIds", "Có người được mời không tồn tại hoặc đã nghỉ việc"); break; }
        if (v.Failed) return v.Problem();

        var booking = new Booking
        {
            RoomId = room!.Id,
            Title = req.Title!.Trim(),
            StartAt = req.StartAt,
            EndAt = req.EndAt,
            OrganizerEmployeeId = me.Id,
            OrganizerUserId = me.UserId!.Value,
            OrganizerName = me.FullName,
            Note = string.IsNullOrWhiteSpace(req.Note) ? null : req.Note.Trim(),
            CreatedAt = now,
            Attendees = attendees.Select(a => new BookingAttendee { EmployeeId = a.Id, UserId = a.UserId, Name = a.FullName }).ToList(),
        };

        // Khoá theo phòng trong transaction: hai người bấm đặt cùng lúc không thể cùng lọt qua bước kiểm tra trùng.
        await using (var tx = await db.Database.BeginTransactionAsync(ct))
        {
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtext({"meetings:" + room.Id}))", ct);
            var clash = await db.Bookings.AsNoTracking()
                .Where(b => b.RoomId == room.Id && b.CancelledAt == null && b.StartAt < req.EndAt && b.EndAt > req.StartAt)
                .OrderBy(b => b.StartAt).FirstOrDefaultAsync(ct);
            if (clash is not null)
            {
                var tz = TimeZoneInfo.FindSystemTimeZoneById(office.Value.TimeZone);
                return TypedResults.Problem($"{room.Name} đã có lịch \"{clash.Title}\" ({Range(clash.StartAt, clash.EndAt, tz)}) của {clash.OrganizerName}",
                    statusCode: StatusCodes.Status409Conflict);
            }
            db.Bookings.Add(booking);
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }

        var warnings = new List<string>();
        if (room.Capacity > 0 && attendees.Count + 1 > room.Capacity)
            warnings.Add($"{room.Name} chỉ có {room.Capacity} chỗ, lịch có {attendees.Count + 1} người");

        var tzInfo = TimeZoneInfo.FindSystemTimeZoneById(office.Value.TimeZone);
        var recipients = attendees.Where(a => a.UserId is not null).Select(a => a.UserId!.Value).ToList();
        if (recipients.Count > 0)
            await notifier.NotifyAsync(new NotificationRequest(recipients, NotificationCategories.MeetingInvited,
                $"Mời họp: {booking.Title}",
                $"{me.FullName} mời bạn họp tại {room.Name}, {Range(booking.StartAt, booking.EndAt, tzInfo)}.", "/meetings"), ct);

        return TypedResults.Ok(new BookingCreatedDto(ToDto(booking, rooms, me.Id, user.IsHr(), now), warnings));
    }

    /// <summary>Người đặt hoặc HR; lịch đã kết thúc không huỷ được. Báo cho người được mời.</summary>
    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> CancelAsync(Guid id, ClaimsPrincipal user, MeetingsDbContext db,
        MeetingRooms rooms, IEmployeeDirectory dir, INotifier notifier, IOptions<OfficeSettings> office, TimeProvider clock, CancellationToken ct)
    {
        var b = await db.Bookings.Include(x => x.Attendees).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (b is null || b.CancelledAt is not null) return TypedResults.NotFound();
        var me = await MeAsync(user, dir, ct);
        if (b.OrganizerEmployeeId != me?.Id && !user.IsHr())
            return TypedResults.Problem("Chỉ người đặt hoặc HR được huỷ lịch", statusCode: StatusCodes.Status403Forbidden);
        var now = clock.GetUtcNow();
        if (b.EndAt <= now) return TypedResults.Problem("Lịch đã kết thúc", statusCode: StatusCodes.Status409Conflict);
        b.CancelledAt = now;
        await db.SaveChangesAsync(ct);

        var tz = TimeZoneInfo.FindSystemTimeZoneById(office.Value.TimeZone);
        var recipients = b.Attendees.Where(a => a.UserId is not null).Select(a => a.UserId!.Value).ToList();
        if (b.OrganizerEmployeeId != me?.Id) recipients.Add(b.OrganizerUserId); // HR huỷ hộ → báo cả người đặt
        if (recipients.Count > 0)
            await notifier.NotifyAsync(new NotificationRequest(recipients, NotificationCategories.MeetingCancelled,
                $"Huỷ họp: {b.Title}",
                $"Lịch họp tại {rooms.Find(b.RoomId)?.Name ?? b.RoomId}, {Range(b.StartAt, b.EndAt, tz)} đã bị huỷ.", "/meetings"), ct);
        return TypedResults.NoContent();
    }

    internal static DateTimeOffset StartOfTodayVn(DateTimeOffset now, string timeZone)
    {
        var tz = TimeZoneInfo.FindSystemTimeZoneById(timeZone);
        var local = TimeZoneInfo.ConvertTime(now, tz);
        return new DateTimeOffset(local.Date, local.Offset).ToUniversalTime();
    }

    /// <summary>"Thứ Sáu 07/11 09:00–10:30" theo giờ văn phòng.</summary>
    internal static string Range(DateTimeOffset start, DateTimeOffset end, TimeZoneInfo tz)
    {
        var s = TimeZoneInfo.ConvertTime(start, tz);
        var e = TimeZoneInfo.ConvertTime(end, tz);
        var vi = CultureInfo.GetCultureInfo("vi-VN");
        var day = vi.TextInfo.ToTitleCase(s.ToString("dddd", vi));
        return s.Date == e.Date ? $"{day} {s:dd/MM} {s:HH:mm}–{e:HH:mm}" : $"{s:dd/MM HH:mm} – {e:dd/MM HH:mm}";
    }
}
