using ClosedXML.Excel;
using OfficeHub.Modules.Organization.Domain;

namespace OfficeHub.Modules.Organization.Tests;

public class EmployeeImportSheetTests
{
    private static MemoryStream Xlsx(Action<IXLWorksheet> fill)
    {
        using var wb = new XLWorkbook();
        fill(wb.AddWorksheet("Sheet1"));
        var ms = new MemoryStream();
        wb.SaveAs(ms);
        ms.Position = 0;
        return ms;
    }

    [Fact]
    public void Reads_columns_by_header_in_any_order_without_diacritics()
    {
        using var ms = Xlsx(ws =>
        {
            string[] h = ["ngay vao lam", "HỌ TÊN", "ma nv", "Phòng ban", "Trạng thái", "SĐT"];
            for (var i = 0; i < h.Length; i++) ws.Cell(1, i + 1).Value = h[i];
            ws.Cell(2, 1).Value = new DateTime(2026, 12, 1);      // ô kiểu ngày
            ws.Cell(2, 2).Value = "Nguyễn Văn An";
            ws.Cell(2, 3).Value = "nv100";
            ws.Cell(2, 4).Value = "Kỹ thuật";
            ws.Cell(2, 5).Value = "Chính thức";
            ws.Cell(2, 6).Value = "0901234567";
            ws.Cell(3, 1).Value = "05/01/2027";                   // chữ dd/MM/yyyy
            ws.Cell(3, 2).Value = "Trần Thị Bình";
            ws.Cell(5, 2).Style.Fill.BackgroundColor = XLColor.Yellow; // dòng chỉ có định dạng → bỏ qua
        });
        var rows = EmployeeImportSheet.Read(ms, out var err);
        Assert.Null(err);
        Assert.Equal(2, rows.Count);
        Assert.Equal(("NV100", "Nguyễn Văn An", new DateOnly(2026, 12, 1), "Kỹ thuật", "0901234567"),
            (rows[0].Code, rows[0].FullName, rows[0].JoinedAt, rows[0].Department, rows[0].Phone));
        Assert.Equal(new DateOnly(2027, 1, 5), rows[1].JoinedAt);
        Assert.Null(rows[1].Code);
        Assert.Equal(3, rows[1].RowNumber);
    }

    [Fact]
    public void Bad_date_is_row_error_not_crash()
    {
        using var ms = Xlsx(ws =>
        {
            ws.Cell(1, 1).Value = "Họ tên"; ws.Cell(1, 2).Value = "Ngày vào làm";
            ws.Cell(2, 1).Value = "A"; ws.Cell(2, 2).Value = "31/13/2026";
        });
        var rows = EmployeeImportSheet.Read(ms, out var err);
        Assert.Null(err);
        Assert.Contains(rows[0].Errors, e => e.Contains("31/13/2026"));
    }

    [Fact]
    public void Missing_required_column_is_file_error()
    {
        using var ms = Xlsx(ws => { ws.Cell(1, 1).Value = "Họ tên"; ws.Cell(2, 1).Value = "A"; });
        EmployeeImportSheet.Read(ms, out var err);
        Assert.Contains("Ngày vào làm", err);
    }

    [Theory]
    [InlineData(null, EmployeeStatus.Probation)]
    [InlineData("Thử việc", EmployeeStatus.Probation)]
    [InlineData("chinh thuc", EmployeeStatus.Active)]
    [InlineData("Active", EmployeeStatus.Active)]
    [InlineData("Nghỉ việc", null)]
    public void Parses_status(string? s, EmployeeStatus? expected) => Assert.Equal(expected, EmployeeImportSheet.ParseStatus(s));

    [Fact]
    public void Template_round_trips_through_reader()
    {
        using var ms = new MemoryStream(EmployeeImportSheet.Template(["Kỹ thuật"], ["Chuyên viên"]));
        var rows = EmployeeImportSheet.Read(ms, out var err);
        Assert.Null(err);
        var sample = Assert.Single(rows);
        Assert.Equal(("Nguyễn Văn An", "Kỹ thuật", "Chuyên viên", "Lập trình viên", new DateOnly(2026, 12, 1)), (sample.FullName, sample.Department, sample.Position, sample.JobTitle, sample.JoinedAt));
        Assert.Empty(sample.Errors);
    }
}
