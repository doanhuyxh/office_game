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

    // ---------------- Khấu hao (đường thẳng theo tháng, không giá trị thu hồi) ----------------

    public const int MaxDepreciationMonths = 600;

    /// <summary>Số tháng khấu hao mặc định khi tạo loại mới theo mã (seed + migration).</summary>
    public static int? DefaultDepreciationMonths(string categoryCode) => categoryCode switch
    {
        "MT" or "MH" or "KH" => 36,
        "DT" or "PK" => 24,
        _ => null,
    };

    /// <summary>Số tháng trọn vẹn từ <paramref name="from"/> tới <paramref name="to"/> (15/01 → 14/02 = 0, → 15/02 = 1).</summary>
    public static int FullMonthsBetween(DateOnly from, DateOnly to)
    {
        if (to <= from) return 0;
        var m = (to.Year - from.Year) * 12 + to.Month - from.Month;
        // ngày cuối tháng: mua 31/01 → 28/02 tính đủ 1 tháng
        var anchorDay = Math.Min(from.Day, DateTime.DaysInMonth(to.Year, to.Month));
        if (to.Day < anchorDay) m--;
        return Math.Max(0, m);
    }

    /// <summary>Kết quả khấu hao tại một ngày. <c>BookValue</c> = giá mua − đã khấu hao.</summary>
    public sealed record Depreciation(int Months, int MonthsUsed, decimal Accumulated, decimal BookValue);

    /// <summary>
    /// Đường thẳng theo tháng: mỗi tháng trọn vẹn từ ngày mua trừ giá mua / số tháng (làm tròn đồng), tháng cuối về 0.
    /// null khi thiếu giá mua / ngày mua. Không khấu hao (số tháng null / 0) → còn nguyên giá. Thanh lý / mất → giá trị còn lại 0.
    /// </summary>
    public static Depreciation? Depreciate(decimal? price, DateOnly? purchaseDate, int? months, DateOnly today, DeviceStatus status)
    {
        if (price is not { } p || purchaseDate is not { } pd) return null;
        if (months is not { } n || n <= 0) return new(0, 0, 0, status is DeviceStatus.Retired or DeviceStatus.Lost ? 0 : p);
        var used = Math.Min(n, FullMonthsBetween(pd, today));
        var acc = used >= n ? p : Math.Round(p * used / n, 0, MidpointRounding.AwayFromZero);
        var book = status is DeviceStatus.Retired or DeviceStatus.Lost ? 0 : p - acc;
        return new(n, used, acc, book);
    }

    /// <summary>Số tháng khấu hao áp dụng: riêng của thiết bị, không có thì theo loại.</summary>
    public static int? EffectiveMonths(int? deviceMonths, int? categoryMonths) => deviceMonths ?? categoryMonths;

    // ---------------- Tệp đính kèm thiết bị ----------------

    public const long MaxAttachmentBytes = 20 * 1024 * 1024;
    public const int MaxAttachmentsPerDevice = 30;
    public static readonly TimeSpan UploadUrlTtl = TimeSpan.FromMinutes(15);

    private static readonly HashSet<string> ImageExt = [".png", ".jpg", ".jpeg", ".webp", ".heic"];
    private static readonly HashSet<string> InvoiceExt = [".pdf", ".png", ".jpg", ".jpeg", ".webp", ".heic", ".xml", ".zip"];
    private static readonly HashSet<string> OtherExt = [".pdf", ".png", ".jpg", ".jpeg", ".webp", ".heic", ".xml", ".zip", ".docx", ".doc", ".xlsx", ".xls", ".txt"];

    /// <summary>Tên hiển thị: bỏ đường dẫn + ký tự điều khiển, tối đa 200 ký tự (giữ đuôi).</summary>
    public static string CleanFileName(string? name)
    {
        var n = new string((Path.GetFileName(name?.Replace('\\', '/') ?? "") ?? "").Where(c => !char.IsControl(c)).ToArray()).Trim();
        if (n.Length <= 200) return n;
        var ext = Path.GetExtension(n);
        return n[..(200 - ext.Length)] + ext;
    }


    /// <summary>Ảnh: png / jpg / webp / heic. Hoá đơn: + PDF, XML (hoá đơn điện tử), zip. Khác: + Word / Excel / txt. Tối đa 20 MB.</summary>
    public static List<(string Field, string Message)> ValidateAttachment(AttachmentKind kind, string fileName, long size)
    {
        var e = new List<(string, string)>();
        var ext = Path.GetExtension(fileName).ToLowerInvariant();
        if (fileName.Length == 0) e.Add(("fileName", "Thiếu tên tệp"));
        else if (kind == AttachmentKind.Photo && !ImageExt.Contains(ext)) e.Add(("fileName", "Ảnh chỉ nhận PNG, JPG, WEBP, HEIC"));
        else if (kind == AttachmentKind.Invoice && !InvoiceExt.Contains(ext)) e.Add(("fileName", "Hoá đơn chỉ nhận PDF, ảnh, XML hoá đơn điện tử, zip"));
        else if (kind == AttachmentKind.Other && !OtherExt.Contains(ext)) e.Add(("fileName", "Chỉ nhận PDF, ảnh, Word, Excel, XML, zip, txt"));
        if (size <= 0) e.Add(("size", "Tệp rỗng"));
        else if (size > MaxAttachmentBytes) e.Add(("size", "Tệp tối đa 20 MB"));
        return e;
    }

    /// <summary>assets/devices/{thiết bị}/{id}/{tên an toàn}.</summary>
    public static string AttachmentKey(Guid deviceId, Guid id, string fileName)
    {
        var safe = new string(fileName.Select(c => char.IsAsciiLetterOrDigit(c) || c is '.' or '-' or '_' ? c : '_').ToArray()).Trim('_');
        return $"assets/devices/{deviceId:N}/{id:N}/{(safe.Length == 0 ? "file" : safe)}";
    }

    public static bool IsInline(string contentType) => contentType == "application/pdf" || contentType.StartsWith("image/", StringComparison.Ordinal);

    // ---------------- Biên bản giao nhận ----------------

    /// <summary>Nhắc nhân viên xác nhận biên bản sau 3 ngày (một lần).</summary>
    public const int HandoverRemindAfterDays = 3;

    public static string HandoverNumber(int year, int seq) => $"BB-{year}-{seq:00000}";

    /// <summary>Lỗi nếu nhân viên không xác nhận được biên bản này; null = được.</summary>
    public static string? CannotConfirmHandover(bool isOwner, bool requiresConfirmation, bool alreadyConfirmed)
    {
        if (!isOwner) return "Chỉ người nhận / trả thiết bị xác nhận biên bản";
        if (!requiresConfirmation) return "Biên bản này không cần xác nhận";
        if (alreadyConfirmed) return "Biên bản đã được xác nhận";
        return null;
    }

    /// <summary>Đến lúc nhắc xác nhận: chưa xác nhận, chưa nhắc, đã quá <see cref="HandoverRemindAfterDays"/> ngày.</summary>
    public static bool HandoverReminderDue(bool requiresConfirmation, DateTimeOffset? confirmedAt, DateTimeOffset? remindedAt, DateTimeOffset createdAt,
        DateTimeOffset now) =>
        requiresConfirmation && confirmedAt is null && remindedAt is null && now - createdAt >= TimeSpan.FromDays(HandoverRemindAfterDays);
}
