using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using OfficeHub.Modules.Documents.Domain;

namespace OfficeHub.Modules.Documents.Features;

public sealed record SpaceDto(SpaceKind Kind, Guid? Id, string Name, string Code, Guid? ParentId, bool CanWrite, bool CanManage, bool Closed);


public sealed record FolderDto(Guid Id, Guid? ParentId, string Name, int AssetCount);
public sealed record CreateFolderRequest(SpaceKind SpaceKind, Guid? SpaceId, Guid? ParentId, string? Name);
public sealed record RenameFolderRequest(string? Name);
/// <summary>Tạo (nếu chưa có) chuỗi thư mục "a/b/c" dưới ParentId — nhập cả thư mục từ máy.</summary>
public sealed record EnsureFolderRequest(SpaceKind SpaceKind, Guid? SpaceId, Guid? ParentId, string? Path);

public sealed record DocTypeDto(Guid Id, string Code, string Name, int? RetentionYears, int SortOrder, bool IsActive);
public sealed record DocTypeRequest(string? Code, string? Name, int? RetentionYears, int SortOrder, bool IsActive);

public sealed record UploadRequest(string? FileName, string? ContentType, long Size);
/// <summary>Trình duyệt PUT file lên <see cref="Url"/> với header Content-Type = <see cref="ContentType"/>, rồi gửi <see cref="TicketId"/> để đăng ký.</summary>
public sealed record UploadTicketDto(Guid TicketId, string Url, string ContentType, DateTimeOffset ExpiresAt);

public sealed record CreateAssetRequest(Guid TicketId, SpaceKind SpaceKind, Guid? SpaceId, Guid? FolderId, Guid? DocTypeId, string? Title,
    string? Description, List<string>? Tags);
public sealed record UpdateAssetRequest(string? Title, string? Description, List<string>? Tags, Guid DocTypeId, Guid? FolderId);
public sealed record NewVersionRequest(Guid TicketId, string? Note);
public sealed record CustodianRequest(Guid EmployeeId);
public sealed record DestroyRequest(string? Reason);
/// <summary>Đổi hạn lưu trữ: <see cref="Until"/> null = vĩnh viễn.</summary>
public sealed record RetentionRequest(DateOnly? Until);
public sealed record HandoverRequest(Guid FromEmployeeId, Guid ToEmployeeId);

public sealed record AssetRowDto(Guid Id, string Code, string Title, AssetKind Kind, AssetStatus Status, Classification Classification,
    SpaceKind SpaceKind, Guid? SpaceId, Guid? FolderId, Guid DocTypeId, string DocTypeName, int CurrentVersion, string FileName, string ContentType,
    long Size, long TotalSize, IReadOnlyList<string> Tags, string? CustodianName, string? CreatedByName, DateTimeOffset CreatedAt,
    DateTimeOffset? UpdatedAt, string? DocumentNumber, DateOnly? RetentionUntil, DateTimeOffset? DeletedAt);

public sealed record VersionDto(int Number, string FileName, string ContentType, long Size, string? Note, string? UploadedByName,
    DateTimeOffset UploadedAt, bool Available);

/// <summary>Quyền của người gọi trên tài liệu — FE chỉ dựa vào các cờ này để hiện nút.</summary>
public sealed record AssetPermissions(bool Edit, bool ChangeFile, bool Delete, bool Restore, bool Purge, bool Submit, bool Archive, bool Manage,
    bool HrAdmin);

public sealed record AssetDetailDto(AssetRowDto Asset, string? Description, string SpaceName, string? FolderPath, Guid? CustodianEmployeeId,
    DateTimeOffset? PublishedAt, Guid? ApprovalRequestId, string? RejectReason, DateTimeOffset? DestroyedAt, string? DestroyReason,
    string? DestroyedByName, string? DeletedByName, IReadOnlyList<VersionDto> Versions, AssetPermissions Can);

/// <summary>
/// Ai duyệt ban hành: <see cref="Step"/> = "Self" (chức vụ được tự ban hành) | "Manager" (quản lý trực tiếp của người gửi) | "Hr" (HR; không có HR khác người gửi → admin) | "None"
/// (không gửi được, xem <see cref="Note"/>). <see cref="Pending"/> = đang chờ những người này duyệt.
/// </summary>
public sealed record ApproverDto(string Name, string? Email, string Detail);
public sealed record ApproversDto(string Step, bool Pending, string? RequesterName, string Note, IReadOnlyList<ApproverDto> People);

public sealed record FileUrlDto(string Url, string FileName, string ContentType, AssetKind Kind, int Version, bool Inline);
public sealed record AccessLogDto(DateTimeOffset At, string? UserName, AccessAction Action, int VersionNumber, string? Ip);

public sealed record CountSize(string Key, string Label, int Count, long Size);
public sealed record StatsDto(int TotalAssets, long TotalSize, int Published, int Drafts, int Pending, int TrashCount, int OrphanCount,
    int RetentionDueCount, IReadOnlyList<CountSize> BySpace, IReadOnlyList<CountSize> ByKind, IReadOnlyList<CountSize> ByType,
    IReadOnlyList<CountSize> Monthly);
public sealed record OrphanDto(Guid EmployeeId, string? Code, string FullName, DateOnly? LeftAt, int AssetCount, long Size);

internal static class Http
{
    public static ProblemHttpResult Forbidden(string message = "Bạn không có quyền với kho tài liệu này") =>
        TypedResults.Problem(message, statusCode: StatusCodes.Status403Forbidden);

    public static ProblemHttpResult NoProfile() => TypedResults.Problem(
        "Tài khoản chưa gắn hồ sơ nhân viên nên chưa gửi duyệt được. Liên hệ HR.", statusCode: StatusCodes.Status409Conflict, title: "no_employee_profile");
}
