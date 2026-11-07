namespace OfficeHub.Modules.Assets.Domain;

/// <summary>Quy tắc thuần của module Assets (không truy cập DB) — test ở OfficeHub.Modules.Assets.Tests.</summary>
public static class AssetRules
{
    public const int ReminderDays = 30;
    public const int UrgentReminderDays = 7;

    public static string DeviceCode(string categoryCode, int seq) => $"TB-{categoryCode}-{seq:00000}";

    /// <summary>Lỗi (tiếng Việt) nếu không cấp được thiết bị; null = được.</summary>
    public static string? CannotAssign(DeviceStatus status, bool employeeActive)
    {
        if (!employeeActive) return "Nhân viên đã nghỉ việc hoặc không tồn tại";
        return status switch
        {
            DeviceStatus.InStock => null,
            DeviceStatus.InUse => "Thiết bị đang có người dùng, hãy thu hồi trước",
            DeviceStatus.Repair => "Thiết bị đang bảo trì",
            _ => "Thiết bị đã thanh lý hoặc mất",
        };
    }

    /// <summary>Lỗi nếu không đổi được sang trạng thái mới bằng /status (cấp / thu hồi đi đường riêng).</summary>
    public static string? CannotChangeStatus(DeviceStatus from, DeviceStatus to, string? reason)
    {
        if (to == DeviceStatus.InUse) return "Dùng chức năng \"Cấp phát\" để giao thiết bị";
        if (from is DeviceStatus.Retired or DeviceStatus.Lost) return "Thiết bị đã thanh lý hoặc mất, không đổi trạng thái được";
        if (from == to) return "Thiết bị đang ở trạng thái này";
        if (from == DeviceStatus.InUse && to is DeviceStatus.Repair or DeviceStatus.Retired)
            return "Thiết bị đang có người dùng, hãy thu hồi trước";
        if (to is DeviceStatus.Retired or DeviceStatus.Lost && string.IsNullOrWhiteSpace(reason)) return "Cần nhập lý do";
        return null;
    }

    /// <summary>Lỗi nếu không cấp thêm ghế được.</summary>
    public static string? CannotGrantSeat(ServiceStatus status, int? seatLimit, int seatsUsed)
    {
        if (status != ServiceStatus.Active) return "Dịch vụ đã huỷ";
        if (seatLimit is { } limit && seatsUsed >= limit) return "Đã hết ghế";
        return null;
    }

    /// <summary>0 = chưa tới hạn nhắc; 7 / 30 = mốc cần nhắc. Giống nhắc hợp đồng: ≤7 ngày → nhắc 7 (đặt cả cờ 30).</summary>
    public static int DueReminder(DateOnly? deadline, DateOnly today, bool reminded30, bool reminded7)
    {
        if (deadline is not { } d) return 0;
        var left = d.DayNumber - today.DayNumber;
        if (left < 0 || left > ReminderDays) return 0;
        if (left <= UrgentReminderDays) return reminded7 ? 0 : UrgentReminderDays;
        return reminded30 ? 0 : ReminderDays;
    }

    /// <summary>Chi phí quy ra tháng (để tổng quan cộng được).</summary>
    public static decimal MonthlyCost(BillingCycle cycle, decimal? cost) => cycle switch
    {
        BillingCycle.Monthly => cost ?? 0,
        BillingCycle.Yearly => Math.Round((cost ?? 0) / 12m, 0),
        _ => 0,
    };
}
