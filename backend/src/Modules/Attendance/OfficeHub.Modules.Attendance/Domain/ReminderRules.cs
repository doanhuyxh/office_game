namespace OfficeHub.Modules.Attendance.Domain;

public enum ReminderKind
{
    /// <summary>Trong ngày: hết ca mà vẫn đang "vào" (chưa chấm ra).</summary>
    Checkout = 0,
    /// <summary>Sáng hôm sau: hôm qua thiếu giờ ra và chưa gửi giải trình.</summary>
    MissingCheckout = 1,
}

/// <summary>Đã nhắc (nhân viên, ngày công, loại) — chống nhắc lặp. Chỉ thêm.</summary>
public sealed class AttendanceReminder
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid EmployeeId { get; set; }
    public DateOnly WorkDate { get; set; }
    public ReminderKind Kind { get; set; }
    public DateTimeOffset SentAt { get; set; }
}

/// <summary>Cấu hình nhắc chấm công (.env, tuỳ chọn): Attendance__Reminders__Enabled, __Email, __GraceMinutes, __FlexibleAt, __NextMorningAt.</summary>
public sealed class ReminderSettings
{
    public const string Section = "Attendance:Reminders";
    public bool Enabled { get; set; } = true;
    /// <summary>Gửi kèm email (mặc định chỉ chuông — tránh spam email).</summary>
    public bool Email { get; set; }
    /// <summary>Ca cố định: nhắc sau giờ kết thúc ca N phút.</summary>
    [System.ComponentModel.DataAnnotations.Range(0, 240)] public int GraceMinutes { get; set; } = 30;
    /// <summary>Ca linh hoạt / ngày không có ca mà vẫn chấm vào: nhắc lúc này (giờ văn phòng).</summary>
    public TimeOnly FlexibleAt { get; set; } = new(21, 0);
    /// <summary>Nhắc gửi giải trình cho ngày hôm qua từ giờ này.</summary>
    public TimeOnly NextMorningAt { get; set; } = new(8, 0);
}

/// <summary>Quy tắc nhắc — hàm thuần, test ở tests/OfficeHub.Modules.Attendance.Tests/ReminderRulesTests.cs.</summary>
public static class ReminderRules
{
    /// <summary>
    /// Giờ (đồng hồ văn phòng) bắt đầu nhắc chấm ra trong ngày: ca cố định = giờ kết thúc + grace; ca linh hoạt / không ca = FlexibleAt.
    /// Ca cố định kết thúc quá muộn (+ grace vượt nửa đêm) → 23:59.
    /// </summary>
    public static TimeOnly CheckoutDueAt(Shift? shift, ReminderSettings s)
    {
        if (shift is { Type: ShiftType.Fixed, EndTime: { } end })
        {
            var due = end.ToTimeSpan() + TimeSpan.FromMinutes(s.GraceMinutes);
            return due >= TimeSpan.FromDays(1) ? new TimeOnly(23, 59) : TimeOnly.FromTimeSpan(due);
        }
        return s.FlexibleAt;
    }

    /// <summary>Đang mở phiên (lần chấm cuối trong ngày là VÀO) và đã tới giờ nhắc.</summary>
    public static bool CheckoutDue(PunchType? lastPunchToday, TimeOnly nowLocal, Shift? shift, ReminderSettings s) =>
        lastPunchToday == PunchType.In && nowLocal >= CheckoutDueAt(shift, s);

    /// <summary>Hôm qua lần chấm cuối là VÀO, chưa có giải trình giờ ra (chờ duyệt / đã duyệt), và đã tới giờ nhắc buổi sáng.</summary>
    public static bool MissingCheckoutDue(PunchType? lastPunchYesterday, bool hasOutCorrection, TimeOnly nowLocal, ReminderSettings s) =>
        lastPunchYesterday == PunchType.In && !hasOutCorrection && nowLocal >= s.NextMorningAt;
}
