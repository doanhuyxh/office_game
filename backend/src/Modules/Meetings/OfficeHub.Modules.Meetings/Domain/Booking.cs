namespace OfficeHub.Modules.Meetings.Domain;

/// <summary>Lịch đặt phòng họp. Huỷ = đặt <see cref="CancelledAt"/> (giữ lịch sử). Thời điểm lưu UTC.</summary>
public sealed class Booking
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    /// <summary>Id phòng trong shared/office-map.json (rooms[kind = meeting]).</summary>
    public required string RoomId { get; set; }
    public required string Title { get; set; }
    public DateTimeOffset StartAt { get; set; }
    public DateTimeOffset EndAt { get; set; }
    public Guid OrganizerEmployeeId { get; set; }
    public Guid OrganizerUserId { get; set; }
    public required string OrganizerName { get; set; }
    public string? Note { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? CancelledAt { get; set; }
    public List<BookingAttendee> Attendees { get; set; } = [];
}

public sealed class BookingAttendee
{
    public Guid BookingId { get; set; }
    public Guid EmployeeId { get; set; }
    public Guid? UserId { get; set; }
    public required string Name { get; set; }
}

/// <summary>Phòng họp lấy từ bản đồ văn phòng (cùng nguồn với văn phòng 3D).</summary>
public sealed record MeetingRoom(string Id, string Name, int Capacity);

/// <summary>Quy tắc đặt phòng — hàm thuần, test ở tests/OfficeHub.Modules.Meetings.Tests.</summary>
public static class BookingRules
{
    public static readonly TimeSpan MinDuration = TimeSpan.FromMinutes(15);
    public static readonly TimeSpan MaxDuration = TimeSpan.FromHours(8);
    public const int MaxDaysAhead = 60;
    /// <summary>Cho đặt lịch đã bắt đầu tối đa 5 phút trước (đặt gấp khi đang vào họp).</summary>
    public static readonly TimeSpan StartGrace = TimeSpan.FromMinutes(5);
    public const int MaxAttendees = 50;

    /// <summary>Lỗi theo field (rỗng = hợp lệ).</summary>
    public static List<(string Field, string Message)> Validate(DateTimeOffset start, DateTimeOffset end, DateTimeOffset now)
    {
        var e = new List<(string, string)>();
        if (end <= start) e.Add(("endAt", "Giờ kết thúc phải sau giờ bắt đầu"));
        else if (end - start < MinDuration) e.Add(("endAt", "Tối thiểu 15 phút"));
        else if (end - start > MaxDuration) e.Add(("endAt", "Tối đa 8 giờ mỗi lần đặt"));
        if (start < now - StartGrace) e.Add(("startAt", "Không đặt lịch trong quá khứ"));
        if (start > now.AddDays(MaxDaysAhead)) e.Add(("startAt", $"Chỉ đặt trước tối đa {MaxDaysAhead} ngày"));
        return e;
    }

    /// <summary>Hai khoảng [aStart, aEnd) và [bStart, bEnd) giao nhau — sát nhau (10:00 kết thúc / 10:00 bắt đầu) không tính trùng.</summary>
    public static bool Overlaps(DateTimeOffset aStart, DateTimeOffset aEnd, DateTimeOffset bStart, DateTimeOffset bEnd) =>
        aStart < bEnd && bStart < aEnd;
}
