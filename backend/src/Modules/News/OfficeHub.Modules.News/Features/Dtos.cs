using OfficeHub.Modules.News.Domain;

namespace OfficeHub.Modules.News.Features;

/// <summary>Người đăng: UserId + EmployeeId (null nếu tài khoản không có hồ sơ, vd admin) để FE vẽ ảnh đại diện.</summary>
public sealed record AuthorDto(Guid UserId, Guid? EmployeeId, string Name, string? DepartmentName);

/// <summary>Url = presigned GET (null khi gọi bằng token AI). Video / ảnh xem trực tiếp, tệp khác tải về.</summary>
public sealed record MediaDto(Guid Id, MediaKind Kind, string FileName, string ContentType, long Size, string? Url);

public sealed record AudienceTargetDto(TargetKind Kind, Guid Id, string Name);

/// <summary>
/// PublishAt = giờ hẹn đăng (chỉ tác giả thấy bài chưa đăng). ViewCount = số người đã xem (chỉ tác giả / HR, người khác null).
/// SharedPostId / SharedPost = bài gốc được chia sẻ (SharedPost null khi người xem không xem được bài gốc / bài gốc đã xoá).
/// Reactions = số lượng theo loại (chỉ loại &gt; 0). Với token AI: ContentHtml = null (chỉ có PlainText).</summary>
public sealed record PostDto(Guid Id, long Seq, AuthorDto Author, string? ContentHtml, string PlainText, PostAudience Audience,
    IReadOnlyList<AudienceTargetDto> Targets, bool CommentsDisabled, bool Pinned, DateTimeOffset CreatedAt, DateTimeOffset? EditedAt,
    bool Hidden, string? HiddenReason, IReadOnlyList<MediaDto> Media, int ReactionCount, IReadOnlyDictionary<ReactionType, int> Reactions,
    ReactionType? MyReaction, int CommentCount, bool EmailSent, bool CanEdit, bool CanDelete, bool CanHide,
    DateTimeOffset? PublishAt = null, int? ViewCount = null, Guid? SharedPostId = null, PostDto? SharedPost = null);

public sealed record FeedDto(IReadOnlyList<PostDto> Pinned, IReadOnlyList<PostDto> Items, long? NextCursor);

public sealed record CommentDto(Guid Id, long Seq, Guid PostId, Guid? ParentId, AuthorDto Author, string? Text, string? ImageUrl, DateTimeOffset CreatedAt,
    DateTimeOffset? EditedAt, bool Hidden, string? HiddenReason, bool Deleted, int ReactionCount, ReactionType? MyReaction, bool CanEdit, bool CanDelete, bool CanHide);

/// <summary>Items = bình luận gốc (tăng dần) + mọi trả lời của chúng; HasMore = còn bình luận gốc phía sau.</summary>
public sealed record CommentPageDto(IReadOnlyList<CommentDto> Items, bool HasMore);

public sealed record TargetRequest(TargetKind Kind, Guid Id);

/// <summary>PublishAt = hẹn giờ đăng (null = đăng ngay). SharedPostId = chia sẻ lại bài này (nội dung được để trống).</summary>
public sealed record PostRequest(string? ContentHtml, PostAudience Audience, List<TargetRequest>? Targets, List<Guid>? UploadIds,
    bool SendEmail, bool CommentsDisabled, DateTimeOffset? PublishAt = null, Guid? SharedPostId = null);

/// <summary>Sửa bài: không đổi được SendEmail; RemoveMediaIds gỡ tệp cũ, UploadIds thêm tệp mới.</summary>
/// <summary>Bài đang hẹn giờ: PublishAt = đổi giờ hẹn (null = giữ), PublishNow = đăng ngay. Bài đã đăng bỏ qua hai trường này.</summary>
public sealed record EditPostRequest(string? ContentHtml, PostAudience Audience, List<TargetRequest>? Targets, List<Guid>? UploadIds,
    List<Guid>? RemoveMediaIds, bool CommentsDisabled, DateTimeOffset? PublishAt = null, bool PublishNow = false);

public sealed record ViewsRequest(List<Guid>? PostIds);

public sealed record ViewerDto(Guid UserId, string Name, string? Code, string? DepartmentName, DateTimeOffset ViewedAt);

/// <summary>Count = số người đã xem; AudienceCount = số người trong phạm vi bài (trừ tác giả) để hiện "đã xem x / y".</summary>
public sealed record ViewersDto(int Count, int AudienceCount, IReadOnlyList<ViewerDto> Items);

public sealed record CommentRequest(string? Text, Guid? ParentId, Guid? UploadId);

public sealed record EditCommentRequest(string? Text);

public sealed record ReactionRequest(ReactionType Type);

public sealed record ReactorDto(Guid UserId, string Name, ReactionType Type);

public sealed record UploadRequest(string? FileName, string? ContentType, long Size, bool ForComment);

public sealed record UploadTicketDto(Guid Id, string Url, string ContentType, MediaKind Kind, DateTimeOffset ExpiresAt);

public sealed record UrlDto(string Url);

public sealed record CountDto(int Count);

/// <param name="Title">Chức danh / chức vụ — dòng phụ phân biệt người trùng tên (TEST-71).</param>
public sealed record PersonDto(Guid UserId, string FullName, string Code, string? DepartmentName, string? Title = null, string? AvatarUrl = null, bool IsBot = false);

public sealed record DepartmentDto(Guid Id, string Name, Guid? ParentId);

public sealed record ModerateRequest(string? Reason);

public sealed record PinRequest(int? Days);
