using OfficeHub.Modules.Assets.Domain;

namespace OfficeHub.Modules.Assets.Features;

// Token không bao giờ có trong DTO — chỉ trạng thái (HasToken, TokenStatus, TokenError).

public sealed record SocialAccountDto(Guid Id, SocialPlatform Platform, string Name, string? ExternalId, string? LoginHint, Guid? OwnerDepartmentId,
    string? OwnerDepartmentName, SocialAccountStatus Status, Guid? HolderEmployeeId, string? HolderName, string? HolderCode, string? Note,
    bool HasToken, SocialTokenStatus TokenStatus, string? TokenError, DateTimeOffset? TokenCheckedAt, string? TokenOwnerName,
    DateTimeOffset? PagesSyncedAt, int PageCount, DateTimeOffset CreatedAt);

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

public sealed record SocialPostRequest(string? Message, string? Link, IReadOnlyList<Guid>? PageIds, IReadOnlyList<Guid>? MediaIds, DateTimeOffset? ScheduledAt);

public sealed record SocialTargetDto(Guid Id, Guid PageId, string PageName, string? PagePictureUrl, SocialTargetStatus Status, DateTimeOffset DueAt,
    int Attempts, DateTimeOffset? PublishedAt, string? Permalink, string? Error, DateTimeOffset? CancelledAt, string? CancelledByName, bool CanRetry);

public sealed record SocialPostDto(Guid Id, string Message, string? Link, DateTimeOffset? ScheduledAt, DateTimeOffset CreatedAt, string AuthorName,
    SocialPostStatus Status, IReadOnlyList<SocialTargetDto> Targets, IReadOnlyList<SocialMediaDto> Media, bool CanCancel);

public sealed record HeldSocialDto(Guid Id, SocialPlatform Platform, string Name, string? ExternalId, string? LoginHint, int PageCount, DateTimeOffset AssignedAt);
