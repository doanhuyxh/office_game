using ClosedXML.Excel;
using OfficeHub.Modules.Organization.Domain;

namespace OfficeHub.Modules.Organization.Tests;

public class PositionLadderTests
{
    [Fact]
    public void Default_ladder_has_8_ranks_with_strictly_increasing_levels()
    {
        Assert.Equal(["Giám đốc", "Phó giám đốc", "Trưởng phòng", "Phó phòng", "Trưởng nhóm", "Chuyên viên", "Nhân viên", "Thực tập sinh"],
            PositionLadder.Defaults.Select(r => r.Name));
        Assert.Equal(Enumerable.Range(1, 8), PositionLadder.Defaults.Select(r => r.Level));
        Assert.Equal(PositionLadder.StaffLevel, PositionLadder.LevelOf("Nhân viên"));
    }

    [Theory]
    [InlineData("Giám đốc", PositionLadder.Action.SetLevel, 1, null)]
    [InlineData("  trưởng  PHÒNG ", PositionLadder.Action.SetLevel, 3, null)]   // không phân biệt hoa thường / khoảng trắng
    [InlineData("Chuyên viên", PositionLadder.Action.SetLevel, 6, null)]
    [InlineData("Lễ Tân", PositionLadder.Action.ToJobTitle, 7, "Lễ tân")]      // chức danh công việc → JobTitle + cấp Nhân viên
    [InlineData("Kỹ sư phần mềm", PositionLadder.Action.SetLevel, 7, null)]     // không khớp → cấp Nhân viên, HR chỉnh sau
    public void Plan_converts_legacy_positions(string name, PositionLadder.Action action, int level, string? jobTitle) =>
        Assert.Equal((action, level, jobTitle), PositionLadder.Plan(name));

    [Fact]
    public void Import_sheet_reads_job_title_column()
    {
        using var wb = new XLWorkbook();
        var ws = wb.AddWorksheet("Sheet1");
        string[] h = ["Họ tên", "Ngày vào làm", "Chức vụ", "Chức danh"];
        for (var i = 0; i < h.Length; i++) ws.Cell(1, i + 1).Value = h[i];
        ws.Cell(2, 1).Value = "Lê Văn C"; ws.Cell(2, 2).Value = "01/12/2026"; ws.Cell(2, 3).Value = "Nhân viên"; ws.Cell(2, 4).Value = "Lễ tân";
        var ms = new MemoryStream();
        wb.SaveAs(ms);
        ms.Position = 0;
        var rows = EmployeeImportSheet.Read(ms, out var err);
        Assert.Null(err);
        Assert.Equal(("Nhân viên", "Lễ tân"), (rows[0].Position, rows[0].JobTitle));
    }
}
