using System.Text.Json.Serialization;

namespace OfficeHub.Modules.News.Domain;

/// <summary>Ai xem được bài: Company = mọi tài khoản; Departments = phòng ban được chọn (và phòng con); Custom = danh sách người; Private = chỉ tác giả.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<PostAudience>))]
public enum PostAudience { Company, Departments, Custom, Private }

[JsonConverter(typeof(JsonStringEnumConverter<MediaKind>))]
public enum MediaKind { Image, Video, File }

[JsonConverter(typeof(JsonStringEnumConverter<TargetType>))]
public enum TargetType { Post, Comment }

[JsonConverter(typeof(JsonStringEnumConverter<TargetKind>))]
public enum TargetKind { Department, User }

[JsonConverter(typeof(JsonStringEnumConverter<ReactionType>))]
public enum ReactionType { Like, Love, Haha, Wow, Sad, Angry }

/// <summary>
/// Bài viết. <see cref="ContentHtml"/> đã được lọc (HtmlSanitizer) trước khi lưu; <see cref="PlainText"/> là bản chữ thuần (email, MCP, xem trước).
/// Seq tăng dần toàn bảng → con trỏ cuộn feed. ReactionCount / CommentCount là bản sao để feed không phải đếm.
/// Ẩn (kiểm duyệt) = <see cref="HiddenAt"/>; xoá = <see cref="DeletedAt"/> (xoá mềm).
/// </summary>
public sealed class Post
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public long Seq { get; set; }
    public Guid AuthorUserId { get; set; }
    public required string AuthorName { get; set; }
    public string ContentHtml { get; set; } = "";
    public string PlainText { get; set; } = "";
    public PostAudience Audience { get; set; }
    public bool CommentsDisabled { get; set; }
    public bool SendEmail { get; set; }
    public DateTimeOffset? PinnedUntil { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? EditedAt { get; set; }
    public DateTimeOffset? HiddenAt { get; set; }
    public string? HiddenReason { get; set; }
    public Guid? HiddenByUserId { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }
    public int ReactionCount { get; set; }
    public int CommentCount { get; set; }
    /// <summary>Bài hẹn giờ: chưa tới giờ thì chỉ tác giả thấy; job <c>NewsScheduler</c> đăng (đổi Seq mới, CreatedAt = lúc đăng, gửi email / @nhắc) rồi đặt null.</summary>
    public DateTimeOffset? PublishAt { get; set; }
    /// <summary>Chia sẻ lại bài khác (luôn trỏ bài gốc, không chuỗi chia sẻ). Người xem chỉ thấy bài gốc nếu tự xem được nó.</summary>
    public Guid? SharedPostId { get; set; }
    public List<PostTarget> Targets { get; set; } = [];
    public List<PostMedia> Media { get; set; } = [];
}

/// <summary>Đối tượng của phạm vi Departments (TargetId = Id phòng ban) hoặc Custom (TargetId = Id tài khoản).</summary>
/// <summary>Lần đầu một người xem bài (thống kê "ai đã đọc" cho tác giả + HR). Tác giả không được tính.</summary>
public sealed class PostView
{
    public Guid PostId { get; set; }
    public Guid UserId { get; set; }
    public DateTimeOffset ViewedAt { get; set; }
}

public sealed class PostTarget
{
    public Guid PostId { get; set; }
    public TargetKind Kind { get; set; }
    public Guid TargetId { get; set; }
}

public sealed class PostMedia
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid PostId { get; set; }
    public int Order { get; set; }
    public MediaKind Kind { get; set; }
    public required string FileKey { get; set; }
    public required string FileName { get; set; }
    public required string ContentType { get; set; }
    public long Size { get; set; }
}

/// <summary>Bình luận (chữ thuần, @nhắc dạng <c>@[Tên](guid)</c>); trả lời một cấp: ParentId trỏ bình luận gốc. Ẩn / xoá giống bài.</summary>
public sealed class Comment
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public long Seq { get; set; }
    public Guid PostId { get; set; }
    public Guid? ParentId { get; set; }
    public Guid AuthorUserId { get; set; }
    public required string AuthorName { get; set; }
    public string Text { get; set; } = "";
    /// <summary>Ảnh đính kèm (tuỳ chọn, S3 <c>feed/</c>).</summary>
    public string? ImageKey { get; set; }
    public string? ImageName { get; set; }
    public string? ImageContentType { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? EditedAt { get; set; }
    public DateTimeOffset? HiddenAt { get; set; }
    public string? HiddenReason { get; set; }
    public Guid? HiddenByUserId { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }
    public int ReactionCount { get; set; }
}

/// <summary>Mỗi người một cảm xúc cho mỗi bài / bình luận.</summary>
public sealed class Reaction
{
    public TargetType TargetType { get; set; }
    public Guid TargetId { get; set; }
    public Guid UserId { get; set; }
    public ReactionType Type { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>Người được @nhắc trong bài / bình luận (chỉ để hiển thị + thông báo; không mở rộng quyền xem).</summary>
public sealed class Mention
{
    public TargetType TargetType { get; set; }
    public Guid TargetId { get; set; }
    public Guid UserId { get; set; }
}

/// <summary>Đã xem feed đến bài <see cref="LastSeenSeq"/> → badge "bài mới".</summary>
public sealed class FeedState
{
    public Guid UserId { get; set; }
    public long LastSeenSeq { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

/// <summary>Vé tải lên: file đã xin presigned PUT nhưng chưa gắn vào bài / bình luận.</summary>
public sealed class UploadTicket
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid UserId { get; set; }
    public MediaKind Kind { get; set; }
    public required string FileKey { get; set; }
    public required string FileName { get; set; }
    public required string ContentType { get; set; }
    public long Size { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
