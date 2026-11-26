namespace OfficeHub.Modules.Notification.Contracts;

/// <summary>
/// Đối tượng một thông báo trỏ tới (TEST-237, G1): web / app mobile / agent tự định tuyến theo <see cref="Type"/> + <see cref="Id"/> + <see cref="Params"/>
/// thay cho tách URL web. Đường dẫn web sinh ở MỘT chỗ (NotificationLinkBuilder, module Notification) — module nghiệp vụ không tự ghép URL.
/// Tạo bằng factory bên dưới (tên factory = <see cref="Type"/> dạng PascalCase — NotificationCatalogTests kiểm tra).
/// </summary>
/// <param name="Type">Hằng <see cref="NotificationTargetTypes"/> — đặt theo tên đối tượng, không theo tên màn hình.</param>
/// <param name="Id">Id đối tượng (null với <see cref="NotificationTargetTypes.Page"/>).</param>
/// <param name="Params">Tham số phụ (chuỗi): projectId, commentId…; <c>page</c> có <c>key</c> = trang + tham số truy vấn.</param>
public sealed record NotificationTarget(string Type, Guid? Id = null, IReadOnlyDictionary<string, string>? Params = null)
{
    /// <summary>Tham số <c>key</c> của loại <see cref="NotificationTargetTypes.Page"/>.</summary>
    public const string KeyParam = "key";

    public string? Param(string name) => Params is not null && Params.TryGetValue(name, out var v) ? v : null;

    private static Dictionary<string, string> P(params (string Key, object? Value)[] items)
    {
        var d = new Dictionary<string, string>();
        foreach (var (k, v) in items)
            if (v is not null && v.ToString() is { Length: > 0 } s) d[k] = s;
        return d;
    }

    private static NotificationTarget Of(string type, Guid id, params (string, object?)[] ps)
    {
        var d = P(ps);
        return new(type, id, d.Count == 0 ? null : d);
    }

    /// <summary>Việc trong dự án; <paramref name="commentId"/> = cuộn tới bình luận.</summary>
    public static NotificationTarget ProjectTask(Guid projectId, Guid taskId, Guid? commentId = null) =>
        Of(NotificationTargetTypes.ProjectTask, taskId, ("projectId", projectId), ("commentId", commentId));

    /// <summary>Dự án; <paramref name="tab"/> = tab mở sẵn (vd guide).</summary>
    public static NotificationTarget Project(Guid projectId, string? tab = null) => Of(NotificationTargetTypes.Project, projectId, ("tab", tab));

    /// <summary>Link chia sẻ công khai sổ tay; <paramref name="pageId"/> = trang được chọn đầu tiên (phạm vi "pages").</summary>
    public static NotificationTarget WikiShare(Guid projectId, Guid shareId, Guid? pageId = null) =>
        Of(NotificationTargetTypes.WikiShare, shareId, ("projectId", projectId), ("pageId", pageId));

    public static NotificationTarget ApprovalRequest(Guid requestId) => Of(NotificationTargetTypes.ApprovalRequest, requestId);
    public static NotificationTarget ApprovalDelegation(Guid delegationId) => Of(NotificationTargetTypes.ApprovalDelegation, delegationId);
    public static NotificationTarget ChatConversation(Guid conversationId, Guid? messageId = null) =>
        Of(NotificationTargetTypes.ChatConversation, conversationId, ("messageId", messageId));
    public static NotificationTarget NewsPost(Guid postId, Guid? commentId = null) => Of(NotificationTargetTypes.NewsPost, postId, ("commentId", commentId));
    public static NotificationTarget MeetingBooking(Guid bookingId) => Of(NotificationTargetTypes.MeetingBooking, bookingId);
    public static NotificationTarget LaborContract(Guid contractId) => Of(NotificationTargetTypes.LaborContract, contractId);
    public static NotificationTarget Payslip(Guid payslipId) => Of(NotificationTargetTypes.Payslip, payslipId);
    public static NotificationTarget AssetDevice(Guid deviceId) => Of(NotificationTargetTypes.AssetDevice, deviceId);
    public static NotificationTarget AssetService(Guid serviceId) => Of(NotificationTargetTypes.AssetService, serviceId);
    public static NotificationTarget AssetReview(Guid reviewId) => Of(NotificationTargetTypes.AssetReview, reviewId);
    public static NotificationTarget AssetHandover(Guid handoverId) => Of(NotificationTargetTypes.AssetHandover, handoverId);

    /// <summary>Nhân viên; <paramref name="view"/> = "assets" → tài sản nhân viên đang giữ (trang Tài sản).</summary>
    public static NotificationTarget Employee(Guid employeeId, string? view = null) => Of(NotificationTargetTypes.Employee, employeeId, ("view", view));

    /// <summary>Tài khoản MXH (Business Manager); <paramref name="view"/> = "posts" → trang Đăng bài MXH, null → Tài sản → MXH.</summary>
    public static NotificationTarget SocialAccount(Guid accountId, string? view = null) => Of(NotificationTargetTypes.SocialAccount, accountId, ("view", view));
    public static NotificationTarget SocialPost(Guid postId) => Of(NotificationTargetTypes.SocialPost, postId);
    public static NotificationTarget DocumentAsset(Guid assetId) => Of(NotificationTargetTypes.DocumentAsset, assetId);
    public static NotificationTarget ExpenseRequest(Guid expenseId) => Of(NotificationTargetTypes.ExpenseRequest, expenseId);
    public static NotificationTarget SalesCustomer(Guid customerId) => Of(NotificationTargetTypes.SalesCustomer, customerId);
    public static NotificationTarget SalesContract(Guid contractId, Guid customerId) =>
        Of(NotificationTargetTypes.SalesContract, contractId, ("customerId", customerId));
    /// <summary>Đợt thu (lịch thu) của hợp đồng bán.</summary>
    public static NotificationTarget SalesReceivable(Guid installmentId, Guid contractId) =>
        Of(NotificationTargetTypes.SalesReceivable, installmentId, ("contractId", contractId));

    /// <summary>Yêu cầu sửa hồ sơ; <paramref name="view"/> = "profile" → người đề nghị xem ở hồ sơ của mình, null → HR duyệt ở Nhân viên.</summary>
    public static NotificationTarget ProfileChangeRequest(Guid requestId, string? view = null) =>
        Of(NotificationTargetTypes.ProfileChangeRequest, requestId, ("view", view));

    /// <summary>Chỉ trỏ tới một trang danh sách (không có đối tượng cụ thể): <paramref name="key"/> = đường dẫn bỏ "/" đầu (vd "attendance"),
    /// <paramref name="query"/> = tham số truy vấn (vd tab=ai). Thông báo có đối tượng cụ thể KHÔNG dùng loại này.</summary>
    public static NotificationTarget Page(string key, params (string Name, string Value)[] query)
    {
        var d = new Dictionary<string, string> { [KeyParam] = key };
        foreach (var (n, v) in query) d[n] = v;
        return new(NotificationTargetTypes.Page, null, d);
    }
}

/// <summary>Loại đối tượng của thông báo — giá trị ỔN ĐỊNH (client lưu / so khớp), đặt theo tên đối tượng. Thêm loại → NotificationLinkBuilder + danh mục
/// targetType của category trong NotificationCatalog (NotificationCatalogTests fail nếu thiếu).</summary>
public static class NotificationTargetTypes
{
    public const string ProjectTask = "project_task";
    public const string Project = "project";
    public const string WikiShare = "wiki_share";
    public const string ApprovalRequest = "approval_request";
    public const string ApprovalDelegation = "approval_delegation";
    public const string ChatConversation = "chat_conversation";
    public const string NewsPost = "news_post";
    public const string MeetingBooking = "meeting_booking";
    public const string LaborContract = "labor_contract";
    public const string Payslip = "payslip";
    public const string AssetDevice = "asset_device";
    public const string AssetService = "asset_service";
    public const string AssetReview = "asset_review";
    public const string AssetHandover = "asset_handover";
    public const string Employee = "employee";
    public const string SocialAccount = "social_account";
    public const string SocialPost = "social_post";
    public const string DocumentAsset = "document_asset";
    public const string ExpenseRequest = "expense_request";
    public const string SalesCustomer = "sales_customer";
    public const string SalesContract = "sales_contract";
    public const string SalesReceivable = "sales_receivable";
    public const string ProfileChangeRequest = "profile_change_request";
    /// <summary>Trang danh sách, không có đối tượng: <c>Params["key"]</c> = đường dẫn.</summary>
    public const string Page = "page";
}
