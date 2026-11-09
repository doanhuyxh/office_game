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
}

/// <summary>Bài đăng (nội dung chung cho mọi trang được chọn). Không sửa sau khi tạo — huỷ rồi tạo lại.</summary>
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
