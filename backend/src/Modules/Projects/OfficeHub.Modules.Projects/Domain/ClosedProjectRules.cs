namespace OfficeHub.Modules.Projects.Domain;

/// <summary>
/// Dự án đã đóng (<c>ProjectStatus.Closed</c>) — chủ dự án chốt 2026-11-23 (TEST-213). Hàm thuần — test: tests/OfficeHub.Modules.Projects.Tests/ClosedProjectRulesTests.cs.
/// <list type="bullet">
/// <item>Quản lý dự án + HR / admin (trên web): làm việc đầy đủ như khi dự án đang chạy (tạo / sửa / chuyển / xoá việc, việc phải chờ, người theo dõi).</item>
/// <item>Thành viên thường: chỉ bình luận (kèm ảnh / tệp) và xoá bình luận của chính mình.</item>
/// <item>Token AI / bot: không ghi việc, không đánh thức bot (agent-runner bỏ qua việc có <c>projectActive = false</c>).</item>
/// </list>
/// Mốc nghiệm thu, CR, cột trạng thái, hướng dẫn / mô tả dự án, link tải lên từ thiết bị khác vẫn chặn khi dự án đóng (không thuộc quy tắc này).
/// </summary>
public static class ClosedProjectRules
{
    public const string Closed = "Dự án đã đóng";
    public const string MemberOnlyComment = "Dự án đã đóng — bạn chỉ bình luận được";
    public const string NoAgent = "Dự án đã đóng — trợ lý AI không sửa việc ở dự án đã đóng";

    /// <summary>
    /// Ghi việc (tạo / sửa / chuyển / xoá việc, việc phải chờ, người theo dõi) — người gọi đã có quyền làm việc (<c>CanWork</c>) ở dự án.
    /// Dự án đang chạy → luôn được; đã đóng → chỉ người quản lý (quản lý dự án / HR), không qua token AI.
    /// </summary>
    public static bool CanWriteTasks(bool active, bool canManage, bool byToken) => active || (canManage && !byToken);

    /// <summary>Lỗi 409 khi ghi việc (null = được).</summary>
    public static string? TaskWriteError(bool active, bool canManage, bool byToken) =>
        CanWriteTasks(active, canManage, byToken) ? null : canManage ? NoAgent : MemberOnlyComment;

    /// <summary>Bình luận kèm ảnh / tệp: dự án đóng vẫn được, trừ link tải lên từ thiết bị khác (<c>/u/{token}</c>) — link đó hết hiệu lực khi dự án đóng.</summary>
    public static bool CanAttachFiles(bool active, bool viaUploadLink) => active || !viaUploadLink;

    /// <summary>Đánh thức bot (Telegram / webhook) khi việc đổi — chỉ ở dự án đang chạy.</summary>
    public static bool WakesBots(bool active) => active;
}
