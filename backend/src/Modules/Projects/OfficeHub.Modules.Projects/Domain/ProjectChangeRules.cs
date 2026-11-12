namespace OfficeHub.Modules.Projects.Domain;

/// <summary>
/// Thông tin dự án tại một thời điểm, đã đổi sẵn ra chữ hiển thị (tên phòng ban, mã hợp đồng) để <see cref="ProjectChangeRules.Diff"/> là hàm thuần.
/// Mảng kinh doanh chỉ so id (tên nằm ở module Finance, Projects không tra được).
/// </summary>
public sealed record ProjectSnapshot(string Name, ProjectKind Kind, ProjectStatus Status, string? Description, string? Department, Guid? BusinessLineId,
    IReadOnlyCollection<string> Contracts, DateOnly? StartOn, DateOnly? EndOn, decimal? BudgetManDays, bool Sequential, string? WorkGuide);

/// <summary>
/// Chuông "Dự án … đã được cập nhật" cho mọi thành viên (TEST-38, chủ dự án chốt 2026-11-12): sửa qua web bỏ người sửa;
/// sửa qua token AI (bot / MCP) thì chủ token CŨNG nhận. Không đổi gì → không gửi.
/// Hàm thuần — test: tests/OfficeHub.Modules.Projects.Tests/ProjectChangeRulesTests.cs.
/// </summary>
public static class ProjectChangeRules
{
    public const string GuideField = "Hướng dẫn làm việc";

    private static string Kind(ProjectKind k) => k == ProjectKind.Client ? "Làm cho khách" : "Nội bộ";
    private static string Status(ProjectStatus s) => s == ProjectStatus.Closed ? "Đã đóng" : "Đang chạy";
    private static string Day(DateOnly? d) => d is { } x ? x.ToString("dd/MM/yyyy") : "trống";
    private static string Text(string? s) => string.IsNullOrWhiteSpace(s) ? "trống" : s;
    private static string Num(decimal? n) => n is { } x ? x.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture) : "trống";

    /// <summary>Các thay đổi, mỗi mục một dòng ngắn ("Trạng thái: Đang chạy → Đã đóng"). Mô tả / hướng dẫn chỉ ghi "đã sửa", không chép nội dung.</summary>
    public static List<string> Diff(ProjectSnapshot a, ProjectSnapshot b)
    {
        var c = new List<string>();
        if (a.Name != b.Name) c.Add($"Tên: \"{a.Name}\" → \"{b.Name}\"");
        if (a.Kind != b.Kind) c.Add($"Loại: {Kind(a.Kind)} → {Kind(b.Kind)}");
        if (a.Status != b.Status) c.Add($"Trạng thái: {Status(a.Status)} → {Status(b.Status)}");
        if ((a.Description ?? "") != (b.Description ?? "")) c.Add("Mô tả: đã sửa");
        if (a.Department != b.Department) c.Add($"Phòng ban chủ trì: {Text(a.Department)} → {Text(b.Department)}");
        if (a.BusinessLineId != b.BusinessLineId) c.Add("Mảng kinh doanh: đã đổi");
        var added = b.Contracts.Except(a.Contracts).Order().ToList();
        var removed = a.Contracts.Except(b.Contracts).Order().ToList();
        if (added.Count + removed.Count > 0)
            c.Add("Hợp đồng bán: " + string.Join(", ", added.Select(x => "thêm " + x).Concat(removed.Select(x => "bỏ " + x))));
        if (a.StartOn != b.StartOn) c.Add($"Bắt đầu: {Day(a.StartOn)} → {Day(b.StartOn)}");
        if (a.EndOn != b.EndOn) c.Add($"Kết thúc dự kiến: {Day(a.EndOn)} → {Day(b.EndOn)}");
        if (a.BudgetManDays != b.BudgetManDays) c.Add($"Ngân sách ngày công: {Num(a.BudgetManDays)} → {Num(b.BudgetManDays)}");
        if (a.Sequential != b.Sequential) c.Add($"Đi lần lượt: {(a.Sequential ? "bật" : "tắt")} → {(b.Sequential ? "bật" : "tắt")}");
        if ((a.WorkGuide ?? "") != (b.WorkGuide ?? "")) c.Add($"{GuideField}: đã sửa");
        return c;
    }

    /// <summary>Người sửa hiển thị trong chuông: qua token AI → "BOT (token của X)".</summary>
    public static string Actor(string name, bool byToken) => byToken ? $"BOT (token của {name})" : name;

    public static string Body(string actor, IReadOnlyCollection<string> changes) => TaskNotifyRules.Body($"{actor} đã sửa: {string.Join("; ", changes)}.");

    /// <summary>Thành viên nhận chuông: còn làm, có tài khoản; sửa trên web bỏ người sửa, qua token AI thì chủ token vẫn nhận.</summary>
    public static List<Guid> Recipients(IEnumerable<(Guid? UserId, bool IsActive)> members, Guid actorUserId, bool byToken) =>
        TaskNotifyRules.Recipients(members, byToken ? Guid.Empty : actorUserId, []);
}
