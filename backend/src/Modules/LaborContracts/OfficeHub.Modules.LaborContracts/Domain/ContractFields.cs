using System.Globalization;

namespace OfficeHub.Modules.LaborContracts.Domain;

/// <summary>Trường dùng được trong mẫu hợp đồng Word: <c>{{Ten}}</c>. Thông tin cố định của công ty (tên, địa chỉ, người đại diện) gõ thẳng vào mẫu.</summary>
public static class ContractFields
{
    public sealed record Field(string Name, string Description, string Example);

    public static readonly IReadOnlyList<Field> All =
    [
        new("HoTen", "Họ tên nhân viên", "Nguyễn Văn An"),
        new("MaNhanVien", "Mã nhân viên", "NV012"),
        new("NgaySinh", "Ngày sinh", "15/08/1995"),
        new("Email", "Email", "an.nguyen@congty.vn"),
        new("SoDienThoai", "Số điện thoại", "0901234567"),
        new("SoCCCD", "Số CCCD", "079095001234"),
        new("NgayCapCCCD", "Ngày cấp CCCD", "10/05/2021"),
        new("NoiCapCCCD", "Nơi cấp CCCD", "Cục Cảnh sát QLHC về TTXH"),
        new("DiaChiThuongTru", "Địa chỉ thường trú", "12 Lê Lợi, P. Bến Nghé, Q.1, TP.HCM"),
        new("DiaChiHienTai", "Địa chỉ hiện tại (trống → thường trú)", "34 Nguyễn Trãi, Q.5, TP.HCM"),
        new("PhongBan", "Phòng ban", "Kỹ thuật"),
        new("ChucVu", "Chức vụ (hồ sơ nhân viên)", "Chuyên viên"),
        new("ChucDanh", "Chức danh trên hợp đồng (trống → chức vụ)", "Lập trình viên"),
        new("SoHopDong", "Số hợp đồng", "HĐLĐ-2026/012"),
        new("LoaiHopDong", "Loại hợp đồng", "Hợp đồng lao động xác định thời hạn"),
        new("ThoiHan", "Thời hạn", "12 tháng"),
        new("NgayKy", "Ngày ký", "01/11/2026"),
        new("NgayBatDau", "Ngày bắt đầu", "01/11/2026"),
        new("NgayKetThuc", "Ngày kết thúc (vô thời hạn → \"Không xác định\")", "31/10/2027"),
        new("Luong", "Mức lương", "15.000.000"),
        new("LuongBangChu", "Mức lương bằng chữ", "Mười lăm triệu đồng"),
        new("PhuCap", "Phụ cấp", "1.000.000"),
        new("PhuCapBangChu", "Phụ cấp bằng chữ", "Một triệu đồng"),
        new("NgayHienTai", "Ngày xuất hợp đồng", "ngày 06 tháng 11 năm 2026"),
        new("Ngay", "Ngày (hôm nay)", "06"),
        new("Thang", "Tháng (hôm nay)", "11"),
        new("Nam", "Năm (hôm nay)", "2026"),
    ];

    public static readonly HashSet<string> Names = All.Select(f => f.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);

    public sealed record Source(string FullName, string Code, DateOnly? DateOfBirth, string? Email, string? Phone, string? Department, string? Position,
        string Number, ContractType Type, DateOnly? SignedDate, DateOnly StartDate, DateOnly? EndDate, string? JobTitle,
        decimal? Salary, decimal? Allowance, DateOnly Today,
        string? IdNumber = null, DateOnly? IdIssuedOn = null, string? IdIssuedPlace = null, string? PermanentAddress = null, string? CurrentAddress = null);

    private static readonly CultureInfo Vi = CultureInfo.GetCultureInfo("vi-VN");

    public static Dictionary<string, string> Values(Source s)
    {
        static string D(DateOnly? d) => d?.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture) ?? "";
        string M(decimal? v) => v is { } x ? Math.Round(x, 0).ToString("#,##0", Vi) : "";
        return new(StringComparer.OrdinalIgnoreCase)
        {
            ["HoTen"] = s.FullName,
            ["MaNhanVien"] = s.Code,
            ["NgaySinh"] = D(s.DateOfBirth),
            ["Email"] = s.Email ?? "",
            ["SoDienThoai"] = s.Phone ?? "",
            ["SoCCCD"] = s.IdNumber ?? "",
            ["NgayCapCCCD"] = D(s.IdIssuedOn),
            ["NoiCapCCCD"] = s.IdIssuedPlace ?? "",
            ["DiaChiThuongTru"] = s.PermanentAddress ?? "",
            ["DiaChiHienTai"] = s.CurrentAddress ?? s.PermanentAddress ?? "",
            ["PhongBan"] = s.Department ?? "",
            ["ChucVu"] = s.Position ?? "",
            ["ChucDanh"] = string.IsNullOrWhiteSpace(s.JobTitle) ? s.Position ?? "" : s.JobTitle,
            ["SoHopDong"] = s.Number,
            ["LoaiHopDong"] = TypeLabel(s.Type),
            ["ThoiHan"] = Duration(s.Type, s.StartDate, s.EndDate),
            ["NgayKy"] = D(s.SignedDate),
            ["NgayBatDau"] = D(s.StartDate),
            ["NgayKetThuc"] = s.EndDate is null ? "Không xác định" : D(s.EndDate),
            ["Luong"] = M(s.Salary),
            ["LuongBangChu"] = s.Salary is { } sal ? VietnameseNumber.MoneyToWords(sal) : "",
            ["PhuCap"] = M(s.Allowance),
            ["PhuCapBangChu"] = s.Allowance is { } al ? VietnameseNumber.MoneyToWords(al) : "",
            ["NgayHienTai"] = $"ngày {s.Today:dd} tháng {s.Today:MM} năm {s.Today:yyyy}",
            ["Ngay"] = s.Today.ToString("dd", CultureInfo.InvariantCulture),
            ["Thang"] = s.Today.ToString("MM", CultureInfo.InvariantCulture),
            ["Nam"] = s.Today.ToString("yyyy", CultureInfo.InvariantCulture),
        };
    }

    public static string TypeLabel(ContractType t) => t switch
    {
        ContractType.Indefinite => "Hợp đồng lao động không xác định thời hạn",
        ContractType.Fixed => "Hợp đồng lao động xác định thời hạn",
        _ => "Hợp đồng thử việc",
    };

    /// <summary>Thử việc tính theo ngày; có thời hạn: tròn tháng → "N tháng", lẻ → "N ngày"; vô thời hạn → "Không xác định thời hạn".</summary>
    public static string Duration(ContractType type, DateOnly start, DateOnly? end)
    {
        if (end is not { } e) return "Không xác định thời hạn";
        var days = e.DayNumber - start.DayNumber + 1;
        if (type == ContractType.Probation) return $"{days} ngày";
        var months = (e.Year - start.Year) * 12 + e.Month - start.Month;
        if (start.AddMonths(months).AddDays(-1) == e) return $"{months} tháng";
        if (start.AddMonths(months + 1).AddDays(-1) == e) return $"{months + 1} tháng";
        return $"{days} ngày";
    }
}
