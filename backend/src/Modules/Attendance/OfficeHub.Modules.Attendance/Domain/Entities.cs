namespace OfficeHub.Modules.Attendance.Domain;

public enum ShiftType
{
    /// <summary>Ca cố định: giờ vào / ra cụ thể.</summary>
    Fixed = 0,
    /// <summary>Ca linh hoạt: đủ số giờ, vào trong khung cho phép.</summary>
    Flexible = 1,
}

public sealed class Shift
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public required string Name { get; set; }
    public ShiftType Type { get; set; }

    // ---- Ca cố định ----
    public TimeOnly? StartTime { get; set; }
    public TimeOnly? EndTime { get; set; }
    /// <summary>Số phút được phép trễ trước khi tính đi muộn.</summary>
    public int GraceMinutes { get; set; } = 5;

    // ---- Ca linh hoạt ----
    /// <summary>Số phút làm việc phải đủ (không tính nghỉ trưa).</summary>
    public int RequiredMinutes { get; set; } = 480;
    public TimeOnly? EarliestIn { get; set; }
    public TimeOnly? LatestIn { get; set; }

    // ---- Chung ----
    /// <summary>Nghỉ trưa: thời gian làm trong khung này không được tính.</summary>
    public TimeOnly? BreakStart { get; set; }
    public TimeOnly? BreakEnd { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }
}

/// <summary>
/// Lịch làm việc theo tuần: ngày trong tuần → ca. EmployeeId = null là lịch mặc định của công ty.
/// Đổi lịch = thêm bộ dòng mới với EffectiveFrom mới; không sửa dòng cũ → bảng công quá khứ vẫn đúng.
/// </summary>
public sealed class ScheduleEntry
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid? EmployeeId { get; set; }
    public DateOnly EffectiveFrom { get; set; }
    public DayOfWeek DayOfWeek { get; set; }
    /// <summary>Null = ngày nghỉ.</summary>
    public Guid? ShiftId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public enum PunchType { In = 0, Out = 1 }

public enum PunchSource
{
    /// <summary>Nút trên web nhân sự</summary>
    Web = 0,
    /// <summary>Văn phòng 3D (máy chấm công ở lễ tân / HUD)</summary>
    Office3D = 1,
    /// <summary>Máy chấm công (webhook) — giai đoạn sau</summary>
    Device = 2,
    /// <summary>Giải trình được duyệt</summary>
    Manual = 3,
}

public enum WorkMode { Onsite = 0, Remote = 1 }

/// <summary>Sự kiện chấm công thô. CHỈ THÊM, không bao giờ sửa / xoá.</summary>
public sealed class AttendanceEvent
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid EmployeeId { get; set; }
    /// <summary>Giờ server (UTC).</summary>
    public DateTimeOffset OccurredAt { get; set; }
    /// <summary>Ngày làm việc theo giờ văn phòng.</summary>
    public DateOnly WorkDate { get; set; }
    public PunchType Type { get; set; }
    public PunchSource Source { get; set; }
    public WorkMode WorkMode { get; set; }
    public string? Ip { get; set; }
    public string? UserAgent { get; set; }
    public string? Note { get; set; }
    /// <summary>Chống ghi trùng (webhook gửi lại).</summary>
    public string? IdempotencyKey { get; set; }
}

public sealed class Holiday
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public DateOnly Date { get; set; }
    public required string Name { get; set; }
}
