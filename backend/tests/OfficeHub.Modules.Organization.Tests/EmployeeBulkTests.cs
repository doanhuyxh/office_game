using ClosedXML.Excel;
using OfficeHub.Modules.Organization.Domain;

namespace OfficeHub.Modules.Organization.Tests;

public class EmployeeBulkTests
{
    // Cây: director ← lead ← dev1, dev2 ; outsider không có quản lý
    private static readonly Guid Director = Guid.NewGuid(), Lead = Guid.NewGuid(), Dev1 = Guid.NewGuid(), Dev2 = Guid.NewGuid(), Outsider = Guid.NewGuid();
    private static readonly Dictionary<Guid, Guid?> Tree = new()
    {
        [Director] = null, [Lead] = Director, [Dev1] = Lead, [Dev2] = Lead, [Outsider] = null,
    };

    [Fact]
    public void Manager_inside_the_group_is_a_cycle() =>
        Assert.True(EmployeeBulk.CreatesCycle(Dev1, new HashSet<Guid> { Dev1, Dev2 }, Tree));

    [Fact]
    public void Manager_who_is_a_subordinate_of_someone_in_the_group_is_a_cycle() =>
        // dev1 đang dưới lead (gián tiếp dưới director) → không thể làm quản lý của director
        Assert.True(EmployeeBulk.CreatesCycle(Dev1, new HashSet<Guid> { Director }, Tree));

    [Fact]
    public void Moving_a_team_under_an_unrelated_manager_is_fine()
    {
        Assert.False(EmployeeBulk.CreatesCycle(Outsider, new HashSet<Guid> { Dev1, Dev2 }, Tree));
        Assert.False(EmployeeBulk.CreatesCycle(Director, new HashSet<Guid> { Dev1, Dev2, Outsider }, Tree));
    }

    [Fact]
    public void Existing_cycle_in_data_does_not_loop_forever()
    {
        Guid a = Guid.NewGuid(), b = Guid.NewGuid();
        var broken = new Dictionary<Guid, Guid?> { [a] = b, [b] = a };
        Assert.False(EmployeeBulk.CreatesCycle(a, new HashSet<Guid> { Outsider }, broken));
    }

    [Fact]
    public void Export_sheet_has_header_and_keeps_phone_leading_zero()
    {
        var bytes = EmployeeBulk.ExportSheet([
            new EmployeeExportRow("NV001", "Nguyễn Văn A", "a@x.vn", "0901234567", new DateOnly(1995, 3, 1), "Công nghệ", "Chuyên viên", "Lập trình viên",
                "NV000", "Trần B", EmployeeStatus.Probation, new DateOnly(2026, 1, 5), null, "NV001"),
        ]);
        using var wb = new XLWorkbook(new MemoryStream(bytes));
        var ws = wb.Worksheet("Nhân viên");
        Assert.Equal(EmployeeBulk.ExportHeader, Enumerable.Range(1, EmployeeBulk.ExportHeader.Length).Select(i => ws.Cell(1, i).GetString()));
        Assert.Equal("NV001", ws.Cell(2, 1).GetString());
        Assert.Equal("0901234567", ws.Cell(2, 4).GetString());
        Assert.Equal(new DateTime(1995, 3, 1), ws.Cell(2, 5).GetDateTime());
        Assert.Equal("Thử việc", ws.Cell(2, 11).GetString());
        Assert.True(ws.Cell(2, 13).IsEmpty());
    }
}
