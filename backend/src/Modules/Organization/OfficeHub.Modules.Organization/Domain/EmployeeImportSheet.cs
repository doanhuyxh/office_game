using System.Globalization;
using System.Text;
using ClosedXML.Excel;

namespace OfficeHub.Modules.Organization.Domain;

/// <summary>Một dòng đọc từ file Excel (chưa tra phòng ban / chức vụ / quản lý). RowNumber = số dòng trong Excel.</summary>
public sealed record ImportSheetRow(int RowNumber, string? Code, string? FullName, string? Email, string? Phone, DateOnly? DateOfBirth,
    string? Department, string? Position, string? JobTitle, string? ManagerCode, DateOnly? JoinedAt, string? Status, string? Note, List<string> Errors);

/// <summary>
/// Đọc / tạo file Excel nhập nhân viên. Cột nhận diện theo TIÊU ĐỀ dòng 1 (không phân biệt hoa thường, bỏ dấu, thứ tự tuỳ ý).
/// Ngày: ô kiểu ngày của Excel hoặc chữ dd/MM/yyyy (yyyy-MM-dd cũng nhận). Hàm thuần — test ở tests/OfficeHub.Modules.Organization.Tests.
/// </summary>
public static class EmployeeImportSheet
{
    public const int MaxRows = 500;

    public sealed record Column(string Key, string Header, bool Required, string Hint, params string[] Aliases);

    public static readonly Column[] Columns =
    [
        new("code", "Mã NV", false, "Bỏ trống = tự cấp (NV0xx)", "ma nhan vien", "ma"),
        new("fullName", "Họ tên", true, "Bắt buộc", "ho va ten", "ten"),
        new("email", "Email", false, "Email công việc / cá nhân (dùng để mời tạo tài khoản)"),
        new("phone", "Điện thoại", false, "", "so dien thoai", "sdt"),
        new("dateOfBirth", "Ngày sinh", false, "dd/MM/yyyy"),
        new("department", "Phòng ban", false, "Tên hoặc mã phòng ban đã có", "phong"),
        new("position", "Chức vụ", false, "Cấp bậc — tên chức vụ đã có (Trưởng phòng, Chuyên viên, Nhân viên…)", "cap bac"),
        new("jobTitle", "Chức danh", false, "Công việc cụ thể, gõ tự do (Lễ tân, Lập trình viên…)", "chuc danh cong viec", "vi tri"),
        new("managerCode", "Mã quản lý", false, "Mã NV của quản lý trực tiếp (đã có, hoặc có trong file)", "quan ly", "ma ql"),
        new("joinedAt", "Ngày vào làm", true, "Bắt buộc, dd/MM/yyyy", "ngay vao"),
        new("status", "Trạng thái", false, "Thử việc (mặc định) / Chính thức", "tinh trang"),
        new("note", "Ghi chú", false, ""),
    ];

    public static string Normalize(string s)
    {
        var d = s.Trim().ToLowerInvariant().Replace('đ', 'd').Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder();
        foreach (var c in d)
            if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark) sb.Append(c);
        return string.Join(' ', sb.ToString().Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }

    /// <summary>Đọc sheet đầu tiên. Lỗi cấu trúc (thiếu cột bắt buộc, quá nhiều dòng) → <paramref name="fileError"/>.</summary>
    public static List<ImportSheetRow> Read(Stream xlsx, out string? fileError)
    {
        fileError = null;
        OfficeHub.BuildingBlocks.Documents.ZipGuard.Check(xlsx); // TEST-13: chống zip bomb trước khi ClosedXML giải nén
        using var wb = new XLWorkbook(xlsx);
        var ws = wb.Worksheets.First();
        var headerRow = ws.FirstRowUsed();
        if (headerRow is null) { fileError = "File trống"; return []; }

        var map = new Dictionary<string, int>();
        foreach (var cell in headerRow.CellsUsed())
        {
            var h = Normalize(cell.GetString());
            var col = Columns.FirstOrDefault(c => Normalize(c.Header) == h || c.Aliases.Any(a => a == h));
            if (col is not null) map.TryAdd(col.Key, cell.Address.ColumnNumber);
        }
        var missing = Columns.Where(c => c.Required && !map.ContainsKey(c.Key)).Select(c => c.Header).ToList();
        if (missing.Count > 0) { fileError = $"Thiếu cột: {string.Join(", ", missing)} (dòng 1 là tiêu đề — dùng file mẫu)"; return []; }

        var rows = new List<ImportSheetRow>();
        foreach (var r in ws.RowsUsed().Where(r => r.RowNumber() > headerRow.RowNumber()))
        {
            string? Text(string key) => map.TryGetValue(key, out var c) && r.Cell(c).GetString().Trim() is { Length: > 0 } t ? t : null;
            var errors = new List<string>();
            DateOnly? Date(string key, string label)
            {
                if (!map.TryGetValue(key, out var c)) return null;
                var cell = r.Cell(c);
                if (cell.IsEmpty()) return null;
                if (cell.DataType == XLDataType.DateTime) return DateOnly.FromDateTime(cell.GetDateTime());
                var s = cell.GetString().Trim();
                if (DateOnly.TryParseExact(s, ["dd/MM/yyyy", "d/M/yyyy", "yyyy-MM-dd"], CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)) return d;
                errors.Add($"{label} \"{s}\" không đúng dạng dd/MM/yyyy");
                return null;
            }
            var row = new ImportSheetRow(r.RowNumber(), Text("code")?.ToUpperInvariant(), Text("fullName"), Text("email"), Text("phone"),
                Date("dateOfBirth", "Ngày sinh"), Text("department"), Text("position"), Text("jobTitle"), Text("managerCode")?.ToUpperInvariant(),
                Date("joinedAt", "Ngày vào làm"), Text("status"), Text("note"), errors);
            // Dòng hoàn toàn trống (chỉ có định dạng) → bỏ qua
            if (row is { Code: null, FullName: null, Email: null, Phone: null, Department: null, Position: null, JoinedAt: null } && errors.Count == 0) continue;
            rows.Add(row);
        }
        if (rows.Count > MaxRows) { fileError = $"Tối đa {MaxRows} dòng mỗi lần nhập"; return []; }
        if (rows.Count == 0) fileError = "Không có dòng dữ liệu nào";
        return rows;
    }

    /// <summary>"Thử việc" / "Chính thức" / tên enum → EmployeeStatus; trống → Thử việc; sai → null.</summary>
    public static EmployeeStatus? ParseStatus(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return EmployeeStatus.Probation;
        return Normalize(s) switch
        {
            "thu viec" or "probation" => EmployeeStatus.Probation,
            "chinh thuc" or "active" => EmployeeStatus.Active,
            _ => null,
        };
    }

    /// <summary>File mẫu: sheet "Nhân viên" (tiêu đề + 1 dòng ví dụ) và sheet "Hướng dẫn" (giải thích cột, danh sách phòng ban / chức vụ hiện có).</summary>
    public static byte[] Template(IEnumerable<string> departments, IEnumerable<string> positions)
    {
        using var wb = new XLWorkbook();
        var ws = wb.AddWorksheet("Nhân viên");
        for (var i = 0; i < Columns.Length; i++)
        {
            var c = ws.Cell(1, i + 1);
            c.Value = Columns[i].Header;
            c.Style.Font.SetBold().Fill.SetBackgroundColor(Columns[i].Required ? XLColor.FromHtml("#FDE68A") : XLColor.FromHtml("#E2E8F0"));
            if (Columns[i].Hint.Length > 0) c.CreateComment().AddText(Columns[i].Hint);
        }
        object[] sample = ["", "Nguyễn Văn An", "an.nguyen@congty.vn", "0901234567", "15/08/1995", departments.FirstOrDefault() ?? "", positions.FirstOrDefault() ?? "", "Lập trình viên", "", "01/12/2026", "Thử việc", "Dòng ví dụ — xoá trước khi nhập"];
        // phải khớp thứ tự Columns (test Template_round_trips_through_reader)
        for (var i = 0; i < sample.Length; i++) { ws.Cell(2, i + 1).Value = sample[i]?.ToString(); ws.Cell(2, i + 1).Style.Font.Italic = true; }
        ws.Range(2, 1, MaxRows + 1, Columns.Length).Style.NumberFormat.Format = "@"; // giữ nguyên chữ (mã, SĐT có số 0 đầu, ngày dd/MM/yyyy)
        ws.Columns(1, Columns.Length).Width = 18;
        ws.SheetView.Freeze(1, 0);

        var help = wb.AddWorksheet("Hướng dẫn");
        help.Cell(1, 1).Value = "Cột"; help.Cell(1, 2).Value = "Bắt buộc"; help.Cell(1, 3).Value = "Ghi chú";
        help.Row(1).Style.Font.Bold = true;
        for (var i = 0; i < Columns.Length; i++)
        {
            help.Cell(i + 2, 1).Value = Columns[i].Header;
            help.Cell(i + 2, 2).Value = Columns[i].Required ? "Có" : "";
            help.Cell(i + 2, 3).Value = Columns[i].Hint;
        }
        var r0 = Columns.Length + 3;
        help.Cell(r0, 1).Value = "Phòng ban hiện có"; help.Cell(r0, 1).Style.Font.Bold = true;
        help.Cell(r0, 3).Value = "Chức vụ hiện có"; help.Cell(r0, 3).Style.Font.Bold = true;
        var i0 = 1;
        foreach (var d in departments) help.Cell(r0 + i0++, 1).Value = d;
        i0 = 1;
        foreach (var p in positions) help.Cell(r0 + i0++, 3).Value = p;
        help.Cell(r0 - 1, 1).Value = $"Nhập tối đa {MaxRows} dòng / lần. Có lỗi ở bất kỳ dòng nào thì KHÔNG dòng nào được nhập — sửa rồi tải lại. Nhập xong vào từng nhân viên để cấp tài khoản.";
        help.Columns(1, 3).AdjustToContents();
        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }
}
