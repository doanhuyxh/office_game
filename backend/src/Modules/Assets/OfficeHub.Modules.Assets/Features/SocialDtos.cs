using OfficeHub.Modules.Assets.Domain;

namespace OfficeHub.Modules.Assets.Features;

// Token không bao giờ có trong DTO — chỉ trạng thái (HasToken, TokenStatus, TokenError).

public sealed record SocialAccountDto(Guid Id, SocialPlatform Platform, string Name, string? ExternalId, string? LoginHint, Guid? OwnerDepartmentId,
    string? OwnerDepartmentName, SocialAccountStatus Status, Guid? HolderEmployeeId, string? HolderName, string? HolderCode, string? Note,
    bool HasToken, SocialTokenStatus TokenStatus, string? TokenError, DateTimeOffset? TokenCheckedAt, string? TokenOwnerName,
    DateTimeOffset? PagesSyncedAt, int PageCount, DateTimeOffset CreatedAt, IReadOnlyList<SocialPermissionDto>? TokenPermissions,
    string? TokenPermissionsError, IReadOnlyList<SocialMissingPermissionDto> MissingPermissions);

/// <summary>Một quyền của token (null danh sách = chưa lấy được): <c>Required</c> = OfficeHub cần quyền này.</summary>
public sealed record SocialPermissionDto(string Permission, string Status, bool Required);

/// <summary>Quyền OfficeHub cần mà token không có + hậu quả. Chỉ tính khi đã lấy được danh sách quyền.</summary>
public sealed record SocialMissingPermissionDto(string Permission, string Impact);

public sealed record SocialPageDto(Guid Id, Guid AccountId, string AccountName, string ExternalId, string Name, string? Category, string? Link,
    string? PictureUrl, bool IsActive, bool CanPost, DateTimeOffset SyncedAt);

public sealed record SocialAssignmentDto(Guid Id, Guid EmployeeId, string EmployeeName, string EmployeeCode, DateTimeOffset AssignedAt,
    string? AssignedByName, string? AssignNote, DateTimeOffset? ReturnedAt, string? ReturnedByName, string? ReturnNote);

public sealed record SocialAccountDetailDto(SocialAccountDto Account, IReadOnlyList<SocialPageDto> Pages, IReadOnlyList<SocialAssignmentDto> History);

/// <summary>Tạo / sửa BM. <c>Token</c> chỉ dùng khi tạo (sửa token: PUT /token).</summary>
public sealed record SocialAccountRequest(string? Name, string? ExternalId, string? LoginHint, Guid? OwnerDepartmentId, string? Note, string? Token = null);
public sealed record SocialTokenRequest(string? Token);
public sealed record SocialStatusRequest(SocialAccountStatus Status);

public sealed record SocialMediaUploadRequest(string? FileName, long Size);
public sealed record SocialMediaUploadDto(Guid Id, string UploadUrl, string ContentType, SocialMediaKind Kind, DateTimeOffset ExpiresAt);
public sealed record SocialMediaDto(Guid Id, SocialMediaKind Kind, string FileName, string ContentType, long Size);

/// <summary>Tạo bài (POST) và sửa bài đã hẹn (PUT /posts/{id}, TEST-208) dùng chung body. <c>MediaIds</c> theo thứ tự hiển thị.</summary>
public sealed record SocialPostRequest(string? Message, string? Link, IReadOnlyList<Guid>? PageIds, IReadOnlyList<Guid>? MediaIds, DateTimeOffset? ScheduledAt);

public sealed record SocialTargetDto(Guid Id, Guid PageId, string PageName, string? PagePictureUrl, SocialTargetStatus Status, DateTimeOffset DueAt,
    int Attempts, DateTimeOffset? PublishedAt, string? Permalink, string? Error, DateTimeOffset? CancelledAt, string? CancelledByName, bool CanRetry,
    DateTimeOffset? DeletedOnFacebookAt = null);

public sealed record SocialPostDto(Guid Id, string Message, string? Link, DateTimeOffset? ScheduledAt, DateTimeOffset CreatedAt, string AuthorName,
    SocialPostStatus Status, IReadOnlyList<SocialTargetDto> Targets, IReadOnlyList<SocialMediaDto> Media, bool CanCancel, bool CanEdit = false,
    DateTimeOffset? EditedAt = null, string? EditedByName = null);

public sealed record HeldSocialDto(Guid Id, SocialPlatform Platform, string Name, string? ExternalId, string? LoginHint, int PageCount, DateTimeOffset AssignedAt);

/// <summary>Chi tiết Fanpage (TEST-206): trang + BM + trạng thái đồng bộ bài viết. <c>CanSync</c> = trang còn trong BM và có page token.</summary>
public sealed record SocialPageDetailDto(SocialPageDto Page, SocialAccountStatus AccountStatus, SocialTokenStatus AccountTokenStatus, string? HolderName,
    DateTimeOffset? PostsSyncedAt, string? PostsSyncError, bool PostsSyncing, int PostCount, bool CanSync, int DeletedCount = 0);

/// <summary>
/// Bài viết hiện có trên trang (đồng bộ từ Facebook). <c>PostId</c> = bài OfficeHub tương ứng (nếu đăng từ OfficeHub). Ẩn / xoá (TEST-211):
/// <c>CanModerate</c> = được ẩn / hiện / xoá (trang còn trong BM, có page token, bài chưa xoá).
/// </summary>
public sealed record SocialPagePostDto(Guid Id, string ExternalPostId, string? Message, DateTimeOffset CreatedTime, string? Permalink, string? PictureUrl,
    string? StatusType, int ReactionCount, int CommentCount, int ShareCount, DateTimeOffset SyncedAt, bool FromOfficeHub, Guid? PostId,
    bool IsHidden = false, DateTimeOffset? HiddenAt = null, string? HiddenByName = null, DateTimeOffset? DeletedAt = null, string? DeletedByName = null,
    bool CanModerate = false);
