using ClosedXML.Excel;
using OfficeHub.Modules.Attendance.Contracts;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Reporting.Infrastructure;

/// <summary>Xuất Excel (.xlsx) bằng ClosedXML. Excel không có múi giờ → mọi giờ vào / ra đã đổi sang giờ Việt Nam và ghi rõ ở tiêu đề.</summary>
internal static class ExcelExport
{
    public const string ContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    private const string Money = "#,##0";

    private static readonly Dictionary<string, string> KindLabel = new()
    {
        ["Weekday"] = "Ngày thường (150%)", ["RestDay"] = "Ngày nghỉ tuần (200%)", ["Holiday"] = "Ngày lễ (300%)",
    };

    // ---------------- Bảng công ----------------

    /// <summary>Mã ô trong lưới công: số giờ làm (có chấm công), P / ½P nghỉ phép, L lễ, V vắng, Q quên chấm ra, – ngoài thời gian làm việc.</summary>
    internal static string DayCode(TimesheetDay d)
    {
        var hours = d.WorkedMinutes > 0 ? (d.WorkedMinutes / 60m).ToString("0.#", System.Globalization.CultureInfo.InvariantCulture) : null;
        return d.Status switch
        {
            "NotEmployed" => "–",
            "Leave" => "P",
            "Holiday" => hours ?? "L",
            "Absent" => d.LeaveFraction > 0 ? "½P" : "V",
            "MissingCheckout" => "Q",
            "Present" or "Working" => d.LeaveFraction > 0 ? $"{hours}+½P" : hours ?? "X",
            "NotYet" => d.LeaveFraction > 0 ? "½P" : "",
            _ => hours ?? "", // DayOff (có chấm công ngày nghỉ → hiện số giờ)
        };
    }

    public static byte[] Timesheet(DateOnly month, IReadOnlyList<EmployeeRef> employees, IReadOnlyDictionary<Guid, TimesheetMonth> data, TimeZoneInfo tz)
    {
        using var wb = new XLWorkbook();
        var title = $"Bảng công tháng {month:MM/yyyy}";

        // Sheet 1: tổng hợp
        var s = wb.AddWorksheet("Tổng hợp");
        s.Cell(1, 1).Value = title;
        s.Cell(1, 1).Style.Font.SetBold().Font.SetFontSize(14);
        string[] head = ["Mã NV", "Họ tên", "Phòng ban", "Ngày phải làm", "Ngày có mặt", "Vắng", "Nghỉ phép (ngày)", "Đi muộn (lần)",
            "Đi muộn (phút)", "Về sớm / thiếu (phút)", "Giờ làm", "Giờ phải làm", "Tại VP (ngày)", "Từ xa (ngày)", "Quên chấm ra", "Tăng ca (giờ)"];
        Header(s, 3, head);
        var r = 4;
        foreach (var e in employees)
        {
            if (data.GetValueOrDefault(e.Id) is not { } m) continue;
            var t = m.Totals;
            object[] v = [e.Code, e.FullName, e.DepartmentName ?? "", t.WorkDays, t.PresentDays, t.AbsentDays, t.LeaveDays, t.LateCount, t.LateMinutes,
                t.ShortMinutes, Math.Round(t.WorkedMinutes / 60m, 2), Math.Round(t.RequiredMinutes / 60m, 2), t.OnsiteDays, t.RemoteDays,
                t.MissingCheckoutDays, Math.Round(t.OvertimeMinutes / 60m, 2)];
            Row(s, r++, v);
        }
        Finish(s, 3, r - 1, head.Length);

        // Sheet 2: lưới nhân viên × ngày
        var g = wb.AddWorksheet("Lưới công");
        g.Cell(1, 1).Value = title + " — ô = số giờ làm · P nghỉ phép · ½P nửa ngày phép · L lễ · V vắng · Q quên chấm ra · – ngoài thời gian làm việc";
        g.Cell(1, 1).Style.Font.SetBold();
        var days = DateTime.DaysInMonth(month.Year, month.Month);
        var gh = new List<string> { "Mã NV", "Họ tên" };
        for (var d = 1; d <= days; d++) gh.Add($"{d:00}\n{Weekday(new DateOnly(month.Year, month.Month, d))}");
        Header(g, 3, [.. gh]);
        g.Row(3).Height = 30;
        r = 4;
        foreach (var e in employees)
        {
            if (data.GetValueOrDefault(e.Id) is not { } m) continue;
            g.Cell(r, 1).Value = e.Code;
            g.Cell(r, 2).Value = e.FullName;
            for (var i = 0; i < m.Days.Count; i++)
            {
                var c = g.Cell(r, 3 + i);
                c.Value = DayCode(m.Days[i]);
                c.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
                if (m.Days[i].Status == "Absent" && m.Days[i].LeaveFraction == 0) c.Style.Font.FontColor = XLColor.Red;
                if (m.Days[i].Status is "DayOff" or "Holiday" or "NotEmployed") c.Style.Fill.BackgroundColor = XLColor.FromHtml("#F1F5F9");
            }
            r++;
        }
        Finish(g, 3, r - 1, gh.Count, freezeCols: 2);
        for (var col = 3; col <= gh.Count; col++) g.Column(col).Width = 6;

        // Sheet 3: chi tiết theo ngày
        var dsh = wb.AddWorksheet("Chi tiết");
        string[] dh = ["Mã NV", "Họ tên", "Ngày", "Thứ", "Trạng thái", "Vào (giờ VN)", "Ra (giờ VN)", "Giờ làm", "Đi muộn (phút)",
            "Về sớm / thiếu (phút)", "Nghỉ phép", "Ngày lễ", "Hình thức", "Tăng ca (giờ)"];
        Header(dsh, 1, dh);
        r = 2;
        foreach (var e in employees)
        {
            if (data.GetValueOrDefault(e.Id) is not { } m) continue;
            foreach (var d in m.Days.Where(x => x.Status != "NotEmployed"))
            {
                object[] v = [e.Code, e.FullName, d.Date.ToDateTime(TimeOnly.MinValue), Weekday(d.Date), StatusLabel(d.Status),
                    Local(d.FirstIn, tz), Local(d.LastOut, tz), Math.Round(d.WorkedMinutes / 60m, 2), d.LateMinutes, d.ShortMinutes,
                    d.LeaveFraction > 0 ? $"{d.LeaveFraction:0.#} · {d.LeaveName}" : "", d.HolidayName ?? "",
                    d.WorkMode switch { "Onsite" => "Tại VP", "Remote" => "Từ xa", "Mixed" => "Kết hợp", _ => "" },
                    Math.Round(d.OvertimeMinutes / 60m, 2)];
                Row(dsh, r, v);
                dsh.Cell(r, 3).Style.DateFormat.Format = "dd/MM/yyyy";
                r++;
            }
        }
        Finish(dsh, 1, r - 1, dh.Length);
        return Save(wb);
    }

    // ---------------- Tiền tăng ca ----------------

    public static byte[] OvertimePay(OvertimePayReport report)
    {
        using var wb = new XLWorkbook();
        var s = wb.AddWorksheet("Tổng hợp");
        s.Cell(1, 1).Value = $"Tiền tăng ca tháng {report.Month} — lương giờ = lương HĐ ÷ ngày công chuẩn ÷ 8 (không gồm phụ cấp)";
        s.Cell(1, 1).Style.Font.SetBold();
        string[] head = ["Mã NV", "Họ tên", "Phòng ban", "Số HĐ", "Lương HĐ", "Ngày công chuẩn", "Lương giờ", "Giờ ngày thường (150%)",
            "Giờ nghỉ tuần (200%)", "Giờ lễ (300%)", "Tổng giờ", "Tiền ngày thường", "Tiền nghỉ tuần", "Tiền lễ", "Tổng tiền", "Ghi chú"];
        Header(s, 3, head);
        var r = 4;
        foreach (var x in report.Rows.Where(x => x.TotalMinutes > 0))
        {
            object?[] v = [x.Employee.Code, x.Employee.FullName, x.Employee.DepartmentName ?? "", x.ContractNumber ?? "", x.Salary, x.StandardDays,
                x.HourlyWage, H(x.WeekdayMinutes), H(x.RestDayMinutes), H(x.HolidayMinutes), H(x.TotalMinutes),
                x.WeekdayAmount, x.RestDayAmount, x.HolidayAmount, x.TotalAmount, x.Warning ?? ""];
            Row(s, r, v);
            foreach (var col in new[] { 5, 7, 12, 13, 14, 15 }) s.Cell(r, col).Style.NumberFormat.Format = Money;
            r++;
        }
        s.Cell(r, 2).Value = "Tổng";
        s.Cell(r, 11).Value = H(report.TotalMinutes);
        s.Cell(r, 15).Value = report.TotalAmount;
        s.Cell(r, 15).Style.NumberFormat.Format = Money;
        s.Row(r).Style.Font.SetBold();
        Finish(s, 3, r, head.Length);

        var names = report.Rows.ToDictionary(x => x.Employee.Id, x => x.Employee);
        var d = wb.AddWorksheet("Chi tiết");
        string[] dh = ["Mã NV", "Họ tên", "Ngày", "Từ", "Đến", "Giờ", "Loại ngày", "Hệ số (%)", "Lương giờ", "Thành tiền", "Lý do"];
        Header(d, 1, dh);
        r = 2;
        foreach (var l in report.Lines)
        {
            var e = names.GetValueOrDefault(l.EmployeeId);
            object?[] v = [e?.Code ?? "", e?.FullName ?? "", l.WorkDate.ToDateTime(TimeOnly.MinValue), l.StartTime, l.EndTime, H(l.Minutes),
                KindLabel.GetValueOrDefault(l.Kind, l.Kind), l.Percent, l.HourlyWage, l.Amount, l.Reason];
            Row(d, r, v);
            d.Cell(r, 3).Style.DateFormat.Format = "dd/MM/yyyy";
            d.Cell(r, 9).Style.NumberFormat.Format = Money;
            d.Cell(r, 10).Style.NumberFormat.Format = Money;
            r++;
        }
        Finish(d, 1, r - 1, dh.Length);
        return Save(wb);
    }

    // ---------------- Phép năm ----------------

    public static byte[] Leave(IReadOnlyList<LeavePayoutRow> rows, DateOnly today)
    {
        using var wb = new XLWorkbook();
        var s = wb.AddWorksheet("Phép năm");
        s.Cell(1, 1).Value = $"Quỹ phép năm {today.Year} (tính tới {today:dd/MM/yyyy}) — tiền phép chưa dùng trả khi nghỉ việc = ngày còn lại × lương ngày";
        s.Cell(1, 1).Style.Font.SetBold();
        string[] head = ["Mã NV", "Họ tên", "Phòng ban", "Trạng thái", "Ngày nghỉ việc", "Được hưởng năm nay", "Đã tích luỹ", "Chuyển năm trước",
            "Điều chỉnh", "Đã dùng", "Đang chờ duyệt", "Còn lại", "Lương HĐ", "Ngày công chuẩn", "Lương ngày", "Tiền phép", "Loại", "Ghi chú"];
        Header(s, 3, head);
        var r = 4;
        foreach (var x in rows)
        {
            object?[] v = [x.Employee.Code, x.Employee.FullName, x.Employee.DepartmentName ?? "", x.Employee.IsActive ? "Đang làm" : "Đã nghỉ",
                x.Employee.LeftAt?.ToDateTime(TimeOnly.MinValue), x.Entitlement, x.Accrued, x.Carried, x.Adjusted, x.Used, x.Pending, x.Available,
                x.Salary, x.StandardDays, x.DailyWage, x.PayoutAmount, x.PayoutDue ? "Phải trả (đã nghỉ việc)" : "Ước tính", x.Warning ?? ""];
            Row(s, r, v);
            s.Cell(r, 5).Style.DateFormat.Format = "dd/MM/yyyy";
            foreach (var col in new[] { 13, 15, 16 }) s.Cell(r, col).Style.NumberFormat.Format = Money;
            r++;
        }
        Finish(s, 3, r - 1, head.Length);
        return Save(wb);
    }

    // ---------------- Tiện ích ----------------

    private static decimal H(int minutes) => Math.Round(minutes / 60m, 2);

    private static string Local(DateTimeOffset? t, TimeZoneInfo tz) =>
        t is { } v ? TimeZoneInfo.ConvertTime(v, tz).ToString("HH:mm") : "";

    private static string Weekday(DateOnly d) => d.DayOfWeek switch
    {
        DayOfWeek.Monday => "T2", DayOfWeek.Tuesday => "T3", DayOfWeek.Wednesday => "T4", DayOfWeek.Thursday => "T5",
        DayOfWeek.Friday => "T6", DayOfWeek.Saturday => "T7", _ => "CN",
    };

    private static string StatusLabel(string s) => s switch
    {
        "Present" => "Có mặt", "Working" => "Đang làm", "Absent" => "Vắng", "MissingCheckout" => "Quên chấm ra", "Leave" => "Nghỉ phép",
        "Holiday" => "Ngày lễ", "DayOff" => "Ngày nghỉ", "NotYet" => "Chưa tới", _ => s,
    };

    private static void Header(IXLWorksheet s, int row, string[] titles)
    {
        for (var i = 0; i < titles.Length; i++) s.Cell(row, i + 1).Value = titles[i];
        var range = s.Range(row, 1, row, titles.Length);
        range.Style.Font.SetBold().Fill.SetBackgroundColor(XLColor.FromHtml("#E2E8F0")).Alignment.SetWrapText().Alignment
            .SetVertical(XLAlignmentVerticalValues.Center);
    }

    private static void Row(IXLWorksheet s, int row, object?[] values)
    {
        for (var i = 0; i < values.Length; i++)
            s.Cell(row, i + 1).Value = values[i] switch
            {
                null => Blank.Value,
                string v => v,
                int v => v,
                decimal v => v,
                DateTime v => v,
                var v => v.ToString(),
            };
    }

    private static void Finish(IXLWorksheet s, int headerRow, int lastRow, int cols, int freezeCols = 0)
    {
        if (lastRow > headerRow) s.Range(headerRow, 1, lastRow, cols).SetAutoFilter();
        s.SheetView.Freeze(headerRow, freezeCols);
        s.Columns(1, cols).AdjustToContents(headerRow, Math.Max(headerRow, lastRow), 8, 40);
    }

    private static byte[] Save(XLWorkbook wb)
    {
        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }
}
