namespace OfficeHub.Modules.Organization.Domain;

/// <summary>Mô tả + hướng dẫn của phòng ban / chức vụ (cho nhân viên và trợ lý AI). Hàm thuần — test ở tests/OfficeHub.Modules.Organization.Tests.</summary>
public static class OrgGuide
{
    public const int DescriptionMax = 500;
    public const int GuideMax = 10_000;

    /// <summary>Khung gợi ý khi soạn hướng dẫn phòng ban.</summary>
    public const string DepartmentTemplate = """
        ## Trách nhiệm chính
        - 

        ## Quy trình / cách làm việc
        - 

        ## Đầu mối liên hệ
        - Việc … → liên hệ …

        ## Quy định riêng của phòng
        - 
        """;

    /// <summary>Khung gợi ý khi soạn hướng dẫn chức vụ (cấp bậc).</summary>
    public const string PositionTemplate = """
        ## Trách nhiệm
        - 

        ## Quyền hạn
        - 

        ## Kết quả kỳ vọng (KPI)
        - 

        ## Kỹ năng cần có
        - 
        """;

    /// <summary>Chuẩn hoá: trim, rỗng → null, đổi xuống dòng CRLF → LF.</summary>
    public static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Replace("\r\n", "\n").Trim();

    /// <summary>
    /// Chuỗi phòng ban từ phòng của nhân viên lên tới gốc (phòng mình trước). Dừng khi gặp vòng lặp / cha không tồn tại.
    /// </summary>
    public static List<T> Chain<T>(IReadOnlyDictionary<Guid, T> byId, Guid? start, Func<T, Guid?> parentOf)
    {
        var chain = new List<T>();
        var seen = new HashSet<Guid>();
        for (var id = start; id is { } cur && seen.Add(cur) && byId.TryGetValue(cur, out var d); id = parentOf(d))
            chain.Add(d);
        return chain;
    }
}
