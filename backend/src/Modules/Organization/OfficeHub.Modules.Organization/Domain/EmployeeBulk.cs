using ClosedXML.Excel;

namespace OfficeHub.Modules.Organization.Domain;

/// <summary>Một dòng Excel "Xuất danh sách nhân viên" (đã tra sẵn tên phòng ban / chức vụ / quản lý).</summary>
public sealed record EmployeeExportRow(
    string Code, string FullName, string? Email, string? Phone, DateOnly? DateOfBirth,
    string? Department, string? Position, string? JobTitle, string? ManagerCode, string? ManagerName,
    EmployeeStatus Status, DateOnly JoinedAt, DateOnly? LeftAt, string? UserName);

/// <summary>Quy tắc thao tác hàng loạt trên danh sách nhân viên (HR): đổi quản lý không tạo vòng lặp, xuất Excel.</summary>
public static class EmployeeBulk
{
    /// <summary>Số nhân viên tối đa trong một lần thao tác.</summary>
    public const int MaxIds = 1000;

    public static readonly string[] ExportHeader =
        ["Mã NV", "Họ tên", "Email", "Số điện thoại", "Ngày sinh", "Phòng ban", "Chức vụ", "Chức danh",
         "Mã NV quản lý", "Quản lý", "Trạng thái", "Ngày vào làm", "Ngày nghỉ việc", "Tài khoản"];

    public static string StatusLabel(EmployeeStatus s) => s switch
    {
        EmployeeStatus.Probation => "Thử việc",
        EmployeeStatus.Active => "Chính thức",
        EmployeeStatus.Resigned => "Đã nghỉ",
        _ => s.ToString(),
    };

    /// <summary>
    /// Gán <paramref name="managerId"/> làm quản lý cho cả nhóm <paramref name="ids"/> có tạo vòng lặp không:
    /// quản lý nằm trong nhóm (tự quản lý mình) hoặc đang là cấp dưới (trực tiếp / gián tiếp) của một người trong nhóm.
    /// </summary>
    /// <param name="managerOf">Quản lý hiện tại của mọi nhân viên (id → ManagerId).</param>
    public static bool CreatesCycle(Guid managerId, IReadOnlySet<Guid> ids, IReadOnlyDictionary<Guid, Guid?> managerOf)
    {
        if (ids.Contains(managerId)) return true;
        var seen = new HashSet<Guid>();
        // Đi ngược chuỗi quản lý từ người được chọn làm quản lý; gặp người trong nhóm = người đó sẽ quản lý chính cấp trên của mình
        for (Guid? cur = managerOf.GetValueOrDefault(managerId); cur is { } c && seen.Add(c); cur = managerOf.GetValueOrDefault(c))
            if (ids.Contains(c)) return true;
        return false;
    }

    /// <summary>File Excel một sheet "Nhân viên", dòng tiêu đề cố định, ngày dạng dd/MM/yyyy.</summary>
    public static byte[] ExportSheet(IEnumerable<EmployeeExportRow> rows)
    {
        using var wb = new XLWorkbook();
        var ws = wb.AddWorksheet("Nhân viên");
        for (var i = 0; i < ExportHeader.Length; i++) ws.Cell(1, i + 1).Value = ExportHeader[i];
        ws.Range(1, 1, 1, ExportHeader.Length).Style.Font.SetBold().Fill.SetBackgroundColor(XLColor.LightGray);
        var r = 2;
        foreach (var e in rows)
        {
            object?[] values = [e.Code, e.FullName, e.Email, e.Phone, e.DateOfBirth, e.Department, e.Position, e.JobTitle,
                e.ManagerCode, e.ManagerName, StatusLabel(e.Status), e.JoinedAt, e.LeftAt, e.UserName];
            for (var i = 0; i < values.Length; i++)
            {
                var c = ws.Cell(r, i + 1);
                switch (values[i])
                {
                    case null: break;
                    case DateOnly d: c.Value = d.ToDateTime(TimeOnly.MinValue); c.Style.DateFormat.Format = "dd/MM/yyyy"; break;
                    default: c.SetValue(values[i]!.ToString()); c.Style.NumberFormat.Format = "@"; break; // SĐT giữ số 0 đầu
                }
            }
            r++;
        }
        ws.SheetView.FreezeRows(1);
        ws.Columns().AdjustToContents(60);
        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }
}
