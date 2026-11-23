using System.Text.Json.Serialization;
using OfficeHub.BuildingBlocks.Auditing;

namespace OfficeHub.Modules.Assets.Domain;

/// <summary>Nền tảng mạng xã hội. Hiện chỉ Facebook (Business Manager → Fanpage); Zalo OA / TikTok để sau.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<SocialPlatform>))]
public enum SocialPlatform { Facebook = 0 }

/// <summary>Đang dùng ↔ Ngừng dùng (phải thu hồi người giữ trước khi ngừng).</summary>
[JsonConverter(typeof(JsonStringEnumConverter<SocialAccountStatus>))]
public enum SocialAccountStatus { Active = 0, Disabled = 1 }

/// <summary>Chưa có token · token dùng được · token lỗi (hết hạn / bị thu hồi / thiếu quyền).</summary>
[JsonConverter(typeof(JsonStringEnumConverter<SocialTokenStatus>))]
public enum SocialTokenStatus { None = 0, Valid = 1, Invalid = 2 }

[JsonConverter(typeof(JsonStringEnumConverter<SocialMediaKind>))]
public enum SocialMediaKind { Image = 0, Video = 1 }

/// <summary>Trạng thái đăng lên một trang: Chờ (tới giờ) → Đang đăng → Đã đăng / Lỗi; Chờ → Đã huỷ.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<SocialTargetStatus>))]
public enum SocialTargetStatus { Pending = 0, Publishing = 1, Published = 2, Failed = 3, Cancelled = 4 }

/// <summary>Trạng thái tổng của bài (tính từ các đích, không lưu).</summary>
[JsonConverter(typeof(JsonStringEnumConverter<SocialPostStatus>))]
public enum SocialPostStatus { Scheduled = 0, Publishing = 1, Published = 2, PartiallyFailed = 3, Failed = 4, Cancelled = 5 }

/// <summary>
/// Tài khoản mạng xã hội của công ty (Facebook: một Business Manager). Token System User mã hoá (AES-GCM, <c>Encryption__Key</c>),
/// không bao giờ trả ra API; lịch sử sửa chỉ ghi "đã đổi". Không lưu mật khẩu đăng nhập.
/// </summary>
[Audited]
public sealed class SocialAccount
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public SocialPlatform Platform { get; set; }
    public required string Name { get; set; }
    /// <summary>ID Business Manager (tham khảo, không bắt buộc).</summary>
    public string? ExternalId { get; set; }
    /// <summary>Email / SĐT tài khoản quản trị BM (không lưu mật khẩu).</summary>
    public string? LoginHint { get; set; }
    public Guid? OwnerDepartmentId { get; set; }
    public SocialAccountStatus Status { get; set; }
    public Guid? HolderEmployeeId { get; set; }
    public string? Note { get; set; }
    /// <summary>Token System User (mã hoá). Tên kết thúc bằng Encrypted → lịch sử sửa tự che.</summary>
    public string? TokenEncrypted { get; set; }
    public SocialTokenStatus TokenStatus { get; set; }
    public string? TokenError { get; set; }
    public DateTimeOffset? TokenCheckedAt { get; set; }
    /// <summary>Tên System User trên Facebook (lấy từ /me khi kiểm tra token).</summary>
    public string? TokenOwnerName { get; set; }
    /// <summary>
    /// Quyền của token (JSON <c>[{"permission","status"}]</c> từ <c>GET /me/permissions</c>, xem <see cref="SocialRules.SerializePermissions"/>).
    /// null = chưa lấy được. Token lỗi → giữ danh sách cũ; thay token → xoá.
    /// </summary>
    public string? TokenPermissions { get; set; }
    /// <summary>Token hợp lệ nhưng không lấy được danh sách quyền (lý do).</summary>
    public string? TokenPermissionsError { get; set; }
    public DateTimeOffset? PagesSyncedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? UpdatedAt { get; set; }
}

/// <summary>Lịch sử bàn giao BM cho nhân viên: chỉ thêm / đóng, không xoá.</summary>
public sealed class SocialAccountAssignment
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid AccountId { get; set; }
    public Guid EmployeeId { get; set; }
    public DateTimeOffset AssignedAt { get; set; }
    public string? AssignedByName { get; set; }
    public string? AssignNote { get; set; }
    public DateTimeOffset? ReturnedAt { get; set; }
    public string? ReturnedByName { get; set; }
    public string? ReturnNote { get; set; }
}

/// <summary>Fanpage thuộc BM (đồng bộ từ Graph API). Trang không còn trong BM → <see cref="IsActive"/> = false (giữ để lịch sử bài).</summary>
public sealed class SocialPage
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid AccountId { get; set; }
    public required string ExternalId { get; set; }
    public required string Name { get; set; }
    public string? Category { get; set; }
    public string? Link { get; set; }
    public string? PictureUrl { get; set; }
    /// <summary>Page access token (mã hoá).</summary>
    public string? TokenEncrypted { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTimeOffset SyncedAt { get; set; }
    /// <summary>Lần đồng bộ bài viết thành công gần nhất (TEST-206).</summary>
    public DateTimeOffset? PostsSyncedAt { get; set; }
    /// <summary>Lỗi lần đồng bộ bài gần nhất (thiếu quyền, lỗi Facebook…); null = lần gần nhất thành công.</summary>
    public string? PostsSyncError { get; set; }
}

/// <summary>
/// Bài viết hiện có trên Fanpage, đồng bộ từ Facebook (<c>/{page}/published_posts</c>, 100 bài mới nhất mỗi lần — TEST-206). Chỉ thêm / cập nhật,
/// không xoá bài ngoài khoảng 100 bài. Ẩn / hiện / xoá trên Facebook từ OfficeHub (TEST-211): xoá chỉ đánh dấu <see cref="DeletedAt"/>. <see cref="PictureUrl"/> là link CDN Facebook (có thể hết hạn), không chép về S3.
/// </summary>
public sealed class SocialPagePost
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid PageId { get; set; }
    /// <summary>ID bài trên Facebook (<c>{pageId}_{postId}</c>). Duy nhất theo <c>(PageId, ExternalPostId)</c>.</summary>
    public required string ExternalPostId { get; set; }
    public string? Message { get; set; }
    /// <summary>Giờ đăng trên Facebook (UTC).</summary>
    public DateTimeOffset CreatedTime { get; set; }
    public string? Permalink { get; set; }
    public string? PictureUrl { get; set; }
    public string? StatusType { get; set; }
    public int ReactionCount { get; set; }
    public int CommentCount { get; set; }
    public int ShareCount { get; set; }
    public DateTimeOffset SyncedAt { get; set; }
    /// <summary>Bài đăng từ OfficeHub: đích <c>social_post_targets</c> có cùng <c>ExternalPostId</c> trên trang này.</summary>
    public Guid? PostTargetId { get; set; }
    /// <summary>Bài đang ẩn khỏi dòng thời gian trang (TEST-211): ẩn từ OfficeHub, hoặc Facebook trả <c>is_hidden</c> khi đồng bộ.</summary>
    public bool IsHidden { get; set; }
    /// <summary>Lần ẩn gần nhất từ OfficeHub (hiện lại → xoá); ẩn trên Facebook rồi đồng bộ về → null.</summary>
    public DateTimeOffset? HiddenAt { get; set; }
    public string? HiddenByName { get; set; }
    /// <summary>Đã xoá trên Facebook (từ OfficeHub, hoặc Facebook báo bài không còn) — không xoá cứng dòng; đồng bộ sau bỏ qua bài này.</summary>
    public DateTimeOffset? DeletedAt { get; set; }
    public string? DeletedByName { get; set; }
}

/// <summary>
/// Bài đăng (nội dung chung cho mọi trang được chọn). Sửa được khi chưa đích nào được gửi đi (<see cref="SocialRules.CannotEditPost"/>, TEST-208).
/// </summary>
public sealed class SocialPost
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public required string Message { get; set; }
    public string? Link { get; set; }
    /// <summary>null = đăng ngay.</summary>
    public DateTimeOffset? ScheduledAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public Guid AuthorUserId { get; set; }
    public Guid? AuthorEmployeeId { get; set; }
    public required string AuthorName { get; set; }
    /// <summary>Lần sửa gần nhất (TEST-208); null = chưa sửa.</summary>
    public DateTimeOffset? EditedAt { get; set; }
    public string? EditedByName { get; set; }
    /// <summary>Xoá mềm khỏi danh sách OfficeHub (TEST-214): giữ dòng, đích, ảnh / video; bài trên Facebook không đổi. null = chưa xoá.</summary>
    public DateTimeOffset? DeletedAt { get; set; }
    public string? DeletedByName { get; set; }
    public List<SocialPostTarget> Targets { get; set; } = [];
}

/// <summary>Một trang đích của bài.</summary>
public sealed class SocialPostTarget
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid PostId { get; set; }
    public Guid PageId { get; set; }
    public SocialTargetStatus Status { get; set; }
    /// <summary>Thời điểm được phép đăng (= giờ hẹn hoặc lúc tạo; đăng lại → lùi theo backoff).</summary>
    public DateTimeOffset DueAt { get; set; }
    public int Attempts { get; set; }
    public DateTimeOffset? StartedAt { get; set; }
    public DateTimeOffset? PublishedAt { get; set; }
    public string? ExternalPostId { get; set; }
    public string? Permalink { get; set; }
    public string? Error { get; set; }
    public DateTimeOffset? CancelledAt { get; set; }
    public string? CancelledByName { get; set; }
}

/// <summary>Ảnh / video của bài (S3 <c>assets/social/</c>). Tải lên trước (PostId null) → gắn vào bài khi tạo.</summary>
public sealed class SocialMedia
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid? PostId { get; set; }
    public SocialMediaKind Kind { get; set; }
    public int SortOrder { get; set; }
    public required string FileName { get; set; }
    public required string ContentType { get; set; }
    public long Size { get; set; }
    public required string FileKey { get; set; }
    public bool Ready { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public Guid CreatedByUserId { get; set; }
}

/// <summary>
/// Nhật ký trả lời bình luận gửi từ OfficeHub (TEST-212). Bình luận không lưu (lấy từ Facebook mỗi lần xem); chỉ lưu trả lời để biết ai trong
/// OfficeHub đã trả lời (trên Facebook chỉ hiện tên Trang) + chặn gửi dồn.
/// </summary>
public sealed class SocialCommentReply
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid PagePostId { get; set; }
    /// <summary>Bình luận được trả lời (id Facebook).</summary>
    public required string FacebookCommentId { get; set; }
    /// <summary>Id Facebook của trả lời mới (khớp với danh sách trả lời để hiện "Trả lời bởi …").</summary>
    public required string ReplyFacebookId { get; set; }
    public required string Message { get; set; }
    public Guid ByUserId { get; set; }
    public required string ByName { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
