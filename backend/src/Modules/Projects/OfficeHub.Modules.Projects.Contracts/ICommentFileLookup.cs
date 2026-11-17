using System.Security.Claims;

namespace OfficeHub.Modules.Projects.Contracts;

/// <summary>Một tệp đính kèm bình luận việc: khoá S3 + thông tin hiển thị (không có link).</summary>
public sealed record CommentFileRef(Guid Id, string FileKey, string FileName, string ContentType, long Size, bool IsImage);

/// <summary>
/// Tra tệp đính kèm bình luận việc theo id cho module khác — Chat chuyển tiếp ảnh / tệp vào tin nhắn (TEST-156: bot ở phiên chat / họp
/// không có Bash để tải file lên, chỉ chuyển tiếp tệp đã có). Cùng quyền như xem tệp trên web / view_attachment: người xem được dự án.
/// </summary>
public interface ICommentFileLookup
{
    /// <summary>Tệp <paramref name="attachmentId"/> nếu <paramref name="user"/> xem được dự án chứa nó; không có / không quyền → null.</summary>
    Task<CommentFileRef?> FindVisibleAsync(Guid attachmentId, ClaimsPrincipal user, CancellationToken ct = default);
}
